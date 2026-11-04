/**
 * C 端购卡订单链路：下单（JSAPI 下单 + 落 unpaid）→ 查单 → 触发落账。
 *
 * 落账事务本体在 ClubCardSettlementService，本服务只做「谁在什么场景下
 * 可以触发落账」的编排（回调 / 手动确认 / 回源核对）。
 *
 * 幂等的三层保障（缺一不可）：
 * 1. 下单：`Idempotency-Key` + Redis 占位，重复提交复用同一笔订单；
 * 2. 落账：`status = unpaid` 条件更新做原子抢占，回调与手动确认双触发也只落一次；
 * 3. 兜底：`member_card_orders.transaction_id` 唯一索引，同一微信流水绑定不了第二单。
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { MemberCardOrder } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ClubOrderIdempotencyService } from '../shared/club-order-idempotency.service';
import { ClubPaymentModeService } from '../payments/club-payment-mode.service';
import type { ClubPaymentCallbackSettlementParams } from '../payments/club-payments.types';
import { ClubWechatJsapiService } from '../payments/club-wechat-jsapi.service';
import { ClubWechatOpenidService } from '../payments/club-wechat-openid.service';
import { ClubWechatVerifyService } from '../payments/club-wechat-verify.service';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import { ClubCardContextService } from './club-card-context.service';
import { buildCardOrderNo, parseCardId } from './club-card-code.utils';
import { ClubCardImmediateSettlementService } from './club-card-immediate-settlement.service';
import { ClubCardSettlementService } from './club-card-settlement.service';
import {
  CLUB_CARD_MANUAL_CONFIRM_DISABLED_MESSAGE,
  CLUB_CARD_ORDER_IDEMPOTENCY_SCOPE,
  CLUB_CARD_ORDER_NOT_FOUND_MESSAGE,
  CLUB_CARD_PAY_WINDOW_MINUTES,
  CLUB_CARD_PURCHASE_LIMIT_MESSAGE_PREFIX,
  buildCardBalanceInsufficientMessage,
} from './club-cards.constants';
import { toOrderView } from './club-cards.mapper';
import type {
  ClubCardPaymentMethod,
  ClubMemberCardOrderView,
  ClubMemberCardSettlementResult,
} from './club-cards.types';
import type { CreateClubCardOrderDto } from './dto/club-cards.dto';

@Injectable()
export class ClubCardOrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contextService: ClubCardContextService,
    private readonly paymentModeService: ClubPaymentModeService,
    private readonly jsapiService: ClubWechatJsapiService,
    private readonly openidService: ClubWechatOpenidService,
    private readonly idempotencyService: ClubOrderIdempotencyService,
    private readonly settlementService: ClubCardSettlementService,
    private readonly immediateSettlementService: ClubCardImmediateSettlementService,
    private readonly wechatVerifyService: ClubWechatVerifyService,
  ) {}

  /** 创建购卡订单草稿：校验模板/限购 → JSAPI 下单 → 落库 unpaid */
  async createOrder(
    currentContext: ClubCurrentContext,
    dto: CreateClubCardOrderDto,
    idempotencyKey?: string,
  ): Promise<ClubMemberCardOrderView> {
    this.contextService.assertStoreMatches(currentContext, dto.storeId);

    const idempotency = this.idempotencyService.normalizeKey(idempotencyKey);
    if (idempotency) {
      const existing = await this.findReusableOrder(
        currentContext.user.id,
        idempotency,
      );
      if (existing) {
        return existing;
      }
    }

    const planId = parseCardId(dto.planId);
    if (planId === null) {
      throw new BadRequestException('卡模板 ID 不合法');
    }

    const { plan } = await this.contextService.resolvePlan(
      currentContext,
      planId,
    );
    const customer =
      await this.contextService.resolveOwnCustomer(currentContext);
    const paymentMethod: ClubCardPaymentMethod = dto.paymentMethod ?? 'wechat';

    // 每人限购：以「已持有的未退款卡数」为准。
    // 不含未支付订单——用户在支付页反复取消不应被自己的废单拦住。
    if (plan.purchaseLimit !== null) {
      const owned = await this.contextService.countOwnedCards(this.prisma, {
        customerId: customer.id,
        planId,
      });
      if (owned >= plan.purchaseLimit) {
        throw new BadRequestException(
          `${CLUB_CARD_PURCHASE_LIMIT_MESSAGE_PREFIX} ${plan.purchaseLimit} 张`,
        );
      }
    }

    // 余额支付前置校验：余额不足直接拒绝，避免落库永远付不掉的 unpaid 脏单（比较与文案均在后端）
    if (paymentMethod === 'balance' && customer.balanceFen < plan.price) {
      throw new BadRequestException(
        buildCardBalanceInsufficientMessage(customer.balanceFen, plan.price),
      );
    }

    const orderNo = buildCardOrderNo(Date.now());
    // 测试模式不向微信预下单：订单照常落 unpaid，响应不带 paymentParams，
    // 前端据此不拉起收银台，改由 confirm-paid 直接发卡。
    // 必须在这里短路——预下单要求门店已配置微信收款，门店没配时会抛
    // STORE_PAY_CONFIG_MISSING，把本可走通的联调流程拦死在建单阶段。
    // 余额支付不需要微信预下单，同样短路（且不会被门店收款配置影响）。
    const skipWechatPrepay =
      paymentMethod === 'wechat' &&
      (await this.paymentModeService.isManualConfirmPaidAllowed());
    // openid 解析不到时不调微信下单（保持既有降级口径），前端拿不到
    // paymentParams 就不会去拉起支付；零元卡与余额支付同样不走微信。
    const openid =
      paymentMethod === 'wechat' && plan.price > 0 && !skipWechatPrepay
        ? await this.openidService.resolveOpenid(currentContext.user.id)
        : null;
    const paymentParams = openid
      ? await this.jsapiService.createJsapiPaymentParams({
          storeId: currentContext.store.id,
          orderNo,
          description: `购买${plan.name}`,
          amountFen: plan.price,
          openid,
        })
      : undefined;

    if (idempotency) {
      const occupiedOrderNo = await this.idempotencyService.reserve({
        scope: CLUB_CARD_ORDER_IDEMPOTENCY_SCOPE,
        userId: currentContext.user.id,
        key: idempotency,
        orderNo,
      });
      if (occupiedOrderNo && occupiedOrderNo !== orderNo) {
        const occupied = await this.findReusableOrder(
          currentContext.user.id,
          idempotency,
        );
        if (occupied) {
          return occupied;
        }
        throw new ConflictException('订单正在处理，请稍后在卡包或订单页查看');
      }
    }

    try {
      const created = await this.prisma.memberCardOrder.create({
        data: {
          orderNo,
          storeId: currentContext.store.id,
          planId: plan.id,
          planNameSnapshot: plan.name,
          kind: plan.kind,
          unitAmount: plan.price,
          amount: plan.price,
          quantity: 1,
          source: 'club_wechat',
          status: 'unpaid',
          customerId: customer.id,
          customerName: customer.guestName,
          customerPhone: customer.guestPhone,
          clubUserId: currentContext.user.id,
          paymentChannel: paymentMethod,
          expiresAt: new Date(
            Date.now() + CLUB_CARD_PAY_WINDOW_MINUTES * 60 * 1000,
          ),
        },
      });

      // 零元卡与余额支付都不经过微信收银台，需要在本次请求内直接落账发卡
      const immediate = await this.immediateSettlementService.settle(
        created,
        plan.price,
        paymentMethod,
      );
      if (immediate) {
        const paidOrder = await this.reloadOrder(created.id);
        return toOrderView({
          order: paidOrder,
          cardId: immediate.cardId === null ? null : String(immediate.cardId),
        });
      }

      return toOrderView({ order: created, cardId: null, paymentParams });
    } catch (error) {
      // 建单失败必须释放幂等占位，否则用户 15 分钟内重试只会被 409 拦住
      if (idempotency) {
        try {
          await this.idempotencyService.release({
            scope: CLUB_CARD_ORDER_IDEMPOTENCY_SCOPE,
            userId: currentContext.user.id,
            key: idempotency,
          });
        } catch {
          // 释放失败只会多占用一个 TTL，不影响已抛出的业务错误
        }
      }
      throw error;
    }
  }

  /**
   * 查询购卡订单状态。
   *
   * `verify=true` 时先回微信侧核对并补落账，再读本地状态：
   * 前端在拉起支付后结果未知（unknown）时必须用它确认是否已扣款。
   */
  async getOrderStatus(
    currentContext: ClubCurrentContext,
    orderId: string,
    query?: { verify?: boolean },
  ): Promise<ClubMemberCardOrderView> {
    const order = await this.findOwnedOrder(currentContext, orderId);

    if (query?.verify === true && order.status === 'unpaid') {
      const verified = await this.wechatVerifyService.confirmPaidOnWechat({
        scope: 'card',
        storeId: order.storeId,
        outTradeNo: order.orderNo,
        expectedAmountFen: order.amount,
      });
      if (verified) {
        await this.settlementService.settlePaidOrder(
          order.id,
          order.amount,
          verified,
        );
      }
    }

    const latest = await this.reloadOrder(order.id);
    const firstCard = await this.prisma.memberCard.findFirst({
      where: { orderId: latest.id },
      orderBy: { id: 'asc' },
      select: { id: true },
    });

    return toOrderView({
      order: latest,
      cardId: firstCard ? String(firstCard.id) : null,
    });
  }

  /**
   * 用户端确认支付成功（开发态兜底）。
   *
   * 生产环境恒不可用：否则任何拿到订单号的人都能把未支付订单标记成已支付，
   * 白拿一张卡。资金闸门统一由 ClubPaymentModeService 裁决。
   */
  async confirmOrderPaid(
    currentContext: ClubCurrentContext,
    orderId: string,
  ): Promise<ClubMemberCardOrderView> {
    const manualConfirmPaidAllowed =
      await this.paymentModeService.isManualConfirmPaidAllowed();
    if (!manualConfirmPaidAllowed) {
      throw new ForbiddenException(CLUB_CARD_MANUAL_CONFIRM_DISABLED_MESSAGE);
    }

    const order = await this.findOwnedOrder(currentContext, orderId);
    // 测试落账统一用 `dev-` 前缀交易号，对账侧可据此排除测试订单
    const settlement = await this.settlementService.settlePaidOrder(
      order.id,
      order.amount,
      {
        transactionId: `dev-${order.orderNo}`,
        paidAtMs: Date.now(),
        callbackReceivedAtMs: Date.now(),
      },
    );

    const latest = await this.reloadOrder(order.id);
    return toOrderView({
      order: latest,
      cardId: settlement.cardId === null ? null : String(settlement.cardId),
    });
  }

  /** 微信支付回调确认支付成功：校验金额后按订单号落账（幂等） */
  async confirmOrderPaidByCallback(
    orderNo: string,
    params: ClubPaymentCallbackSettlementParams,
  ): Promise<ClubMemberCardSettlementResult> {
    const order = await this.prisma.memberCardOrder.findUnique({
      where: { orderNo },
    });
    if (!order) {
      throw new BadRequestException(CLUB_CARD_ORDER_NOT_FOUND_MESSAGE);
    }
    if (order.amount !== params.amountFen) {
      // 金额不符绝不落账：宁可留待人工核对，也不能按错误金额发卡
      throw new BadRequestException('回调金额与订单金额不一致');
    }

    const settlement = await this.settlementService.settlePaidOrder(
      order.id,
      order.amount,
      params,
    );
    return {
      orderNo: order.orderNo,
      orderType: 'card',
      status: 'paid',
      settled: settlement.settled,
      cardId: settlement.cardId,
    };
  }

  // ─── 内部实现 ─────────────────────────────────────────────────────────────

  /**
   * 按订单标识定位**本人**订单：支持订单号（MC 开头）与数据库自增 ID。
   *
   * C 端前端把下单返回的 `id`（= orderNo）原样拼进 URL，
   * 兼容数字 ID 是为了历史深链与人工排查方便。
   */
  private async findOwnedOrder(
    currentContext: ClubCurrentContext,
    orderId: string,
  ): Promise<MemberCardOrder> {
    const trimmed = orderId.trim();
    const numericId = parseCardId(trimmed);
    const order = await this.prisma.memberCardOrder.findFirst({
      where: {
        clubUserId: currentContext.user.id,
        ...(numericId === null
          ? { orderNo: trimmed }
          : { OR: [{ id: numericId }, { orderNo: trimmed }] }),
      },
    });

    if (!order) {
      throw new NotFoundException(CLUB_CARD_ORDER_NOT_FOUND_MESSAGE);
    }
    return order;
  }

  /**
   * 幂等键命中的已建订单。
   *
   * 复用响应刻意不带 `paymentParams`：同一 out_trade_no 不能拿去第二次
   * JSAPI 下单，前端拿到旧参数会直接拉起支付并报错。
   */
  private async findReusableOrder(
    clubUserId: number,
    idempotencyKey: string,
  ): Promise<ClubMemberCardOrderView | null> {
    const orderNo = await this.idempotencyService.findOrderNo({
      scope: CLUB_CARD_ORDER_IDEMPOTENCY_SCOPE,
      userId: clubUserId,
      key: idempotencyKey,
    });
    if (!orderNo) {
      return null;
    }

    const order = await this.prisma.memberCardOrder.findFirst({
      where: { orderNo, clubUserId },
    });
    if (!order) {
      return null;
    }

    const firstCard = await this.prisma.memberCard.findFirst({
      where: { orderId: order.id },
      orderBy: { id: 'asc' },
      select: { id: true },
    });

    return toOrderView({
      order,
      cardId: firstCard ? String(firstCard.id) : null,
    });
  }

  /** 落账后重读订单（保证响应与库内状态一致） */
  private async reloadOrder(orderId: number): Promise<MemberCardOrder> {
    const order = await this.prisma.memberCardOrder.findUnique({
      where: { id: orderId },
    });
    if (!order) {
      throw new NotFoundException(CLUB_CARD_ORDER_NOT_FOUND_MESSAGE);
    }
    return order;
  }
}

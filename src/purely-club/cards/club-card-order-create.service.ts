/**
 * C 端购卡下单链路：校验模板 / 限购 / 余额 →（可选）JSAPI 预下单 → 落 unpaid → 即时落账。
 *
 * 幂等的两层在本服务内闭合：
 * 1. 下单：`Idempotency-Key` + Redis 占位，重复提交复用同一笔订单；
 * 2. 兜底：`member_card_orders.transaction_id` 唯一索引，同一微信流水绑定不了第二单。
 *
 * 订单读取（复用 / 重读 / 首张卡）交给 ClubCardOrderReaderService，
 * 落账事务本体在 ClubCardSettlementService，本服务只负责「怎么把订单建起来」。
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import type { ClubWechatPaymentParamsDto } from '../orders/dto/club-order.dto';
import { ClubPaymentModeService } from '../payments/club-payment-mode.service';
import { ClubWechatJsapiService } from '../payments/club-wechat-jsapi.service';
import { ClubWechatOpenidService } from '../payments/club-wechat-openid.service';
import { ClubOrderIdempotencyService } from '../shared/club-order-idempotency.service';
import { settleClubTasksInOrder } from '../shared/club-parallel-settle.helper';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  ClubCardCustomerSnapshot,
  ClubCardPlanContextRecord,
} from './club-card-context.service';
import { ClubCardContextService } from './club-card-context.service';
import { buildCardOrderNo, parseCardId } from './club-card-code.utils';
import { ClubCardImmediateSettlementService } from './club-card-immediate-settlement.service';
import { ClubCardOrderReaderService } from './club-card-order-reader.service';
import { CLUB_CARD_ERROR_CODE, clubCardError } from './club-cards.errors';
import {
  CLUB_CARD_ORDER_IDEMPOTENCY_SCOPE,
  CLUB_CARD_PAY_WINDOW_MINUTES,
  CLUB_CARD_PURCHASE_LIMIT_MESSAGE_PREFIX,
  buildCardBalanceInsufficientMessage,
} from './club-cards.constants';
import { toOrderView } from './club-cards.mapper';
import type {
  ClubCardPaymentMethod,
  ClubMemberCardOrderView,
} from './club-cards.types';
import type { CreateClubCardOrderDto } from './dto/club-cards.dto';

/** 下单草稿：模板 / 顾客 / 支付方式已解析，仅剩预下单与落库 */
interface ClubCardOrderDraft {
  currentContext: ClubCurrentContext;
  planId: number;
  plan: ClubCardPlanContextRecord;
  customer: ClubCardCustomerSnapshot;
  paymentMethod: ClubCardPaymentMethod;
  orderNo: string;
  /** 门店处于手动确认支付模式：不调微信预下单 */
  skipWechatPrepay: boolean;
}

@Injectable()
export class ClubCardOrderCreateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contextService: ClubCardContextService,
    private readonly paymentModeService: ClubPaymentModeService,
    private readonly jsapiService: ClubWechatJsapiService,
    private readonly openidService: ClubWechatOpenidService,
    private readonly idempotencyService: ClubOrderIdempotencyService,
    private readonly immediateSettlementService: ClubCardImmediateSettlementService,
    private readonly readerService: ClubCardOrderReaderService,
  ) {}

  /** 创建购卡订单草稿：校验模板/限购 →（可选）JSAPI 下单 → 落库 unpaid */
  async createOrder(
    currentContext: ClubCurrentContext,
    dto: CreateClubCardOrderDto,
    idempotencyKey?: string,
  ): Promise<ClubMemberCardOrderView> {
    this.contextService.assertStoreMatches(currentContext, dto.storeId);

    const idempotency = this.idempotencyService.normalizeKey(idempotencyKey);
    const reused = await this.reuseOnIdempotencyHit(
      currentContext,
      idempotency,
    );
    if (reused) {
      return reused;
    }

    const draft = await this.resolveDraft(currentContext, dto);
    // prepay=false：建单不碰微信，支付参数改由取参接口按需获取。
    // 默认 true 保持历史行为不变，老版本小程序无需同步发布。
    const paymentParams = await this.buildPaymentParams(
      draft,
      dto.prepay !== false,
    );

    const occupied = await this.reserveOrderNo(
      currentContext,
      idempotency,
      draft.orderNo,
    );
    if (occupied) {
      return occupied;
    }

    try {
      return await this.persistAndSettle(draft, paymentParams);
    } catch (error) {
      await this.releaseReservationQuietly(currentContext, idempotency);
      throw error;
    }
  }

  /** 卡模板 ID 解析：非法直接 400，不进入任何 IO */
  private parsePlanIdOrThrow(rawPlanId: string): number {
    const planId = parseCardId(rawPlanId);
    if (planId === null) {
      throw new BadRequestException(
        clubCardError(
          CLUB_CARD_ERROR_CODE.PARAM_PLAN_ID_INVALID,
          '卡模板 ID 不合法',
        ),
      );
    }

    return planId;
  }

  /** 解析下单草稿：模板 / 顾客档案 / 支付模式三读并行，随后生成订单号 */
  private async resolveDraft(
    currentContext: ClubCurrentContext,
    dto: CreateClubCardOrderDto,
  ): Promise<ClubCardOrderDraft> {
    const planId = this.parsePlanIdOrThrow(dto.planId);
    const paymentMethod: ClubCardPaymentMethod = dto.paymentMethod ?? 'wechat';
    const { plan, customer, skipWechatPrepay } = await this.resolveOrderContext(
      currentContext,
      planId,
      paymentMethod,
    );

    return {
      currentContext,
      planId,
      plan,
      customer,
      paymentMethod,
      orderNo: buildCardOrderNo(Date.now()),
      skipWechatPrepay,
    };
  }

  /**
   * 三个互不依赖的读取并行：卡模板 / 本人顾客档案 / 支付模式。
   *
   * 支付模式只在微信支付时才需要读（余额与零元卡不经过收银台），
   * 非微信路径直接给 false，保持「不读不必要的配置」。
   * 错误优先级 = 声明顺序：模板不存在 → 顾客档案不存在 → 支付模式读失败，
   * 与改前串行 await 完全一致。
   */
  private async resolveOrderContext(
    currentContext: ClubCurrentContext,
    planId: number,
    paymentMethod: ClubCardPaymentMethod,
  ): Promise<{
    plan: ClubCardPlanContextRecord;
    customer: ClubCardCustomerSnapshot;
    skipWechatPrepay: boolean;
  }> {
    const [planContext, customer, skipWechatPrepay] =
      await settleClubTasksInOrder([
        this.contextService.resolvePlan(currentContext, planId),
        this.contextService.resolveOwnCustomer(currentContext),
        paymentMethod === 'wechat'
          ? this.paymentModeService.isManualConfirmPaidAllowed()
          : Promise.resolve(false),
      ]);

    return { plan: planContext.plan, customer, skipWechatPrepay };
  }

  /**
   * 预下单（可选）：门禁与 openid 解析并行，且门禁异常优先抛出。
   *
   * openid 解析不到时不调微信下单（保持既有降级口径），前端拿不到
   * paymentParams 就不会去拉起支付；零元卡与余额支付同样不走微信。
   */
  private async buildPaymentParams(
    draft: ClubCardOrderDraft,
    prepayInline: boolean,
  ): Promise<ClubWechatPaymentParamsDto | undefined> {
    const { currentContext, plan, customer, planId, paymentMethod } = draft;
    const { orderNo, skipWechatPrepay } = draft;
    const needWechatPrepay =
      prepayInline &&
      paymentMethod === 'wechat' &&
      plan.price > 0 &&
      !skipWechatPrepay;
    const [, openid] = await settleClubTasksInOrder([
      this.assertPurchasable(planId, plan, customer, paymentMethod),
      needWechatPrepay
        ? this.openidService.resolveOpenid(currentContext.user.id)
        : Promise.resolve<string | null>(null),
    ]);
    if (!openid) {
      return undefined;
    }

    return this.jsapiService.createJsapiPaymentParams({
      storeId: currentContext.store.id,
      orderNo,
      description: `购买${plan.name}`,
      amountFen: plan.price,
      openid,
    });
  }

  /** 落 unpaid 单，并在零元卡 / 余额支付时同步落账发卡（不走微信收银台） */
  private async persistAndSettle(
    draft: ClubCardOrderDraft,
    paymentParams: ClubWechatPaymentParamsDto | undefined,
  ): Promise<ClubMemberCardOrderView> {
    const { currentContext, plan, customer, paymentMethod, orderNo } = draft;

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
    if (!immediate) {
      return toOrderView({ order: created, cardId: null, paymentParams });
    }

    const paidOrder = await this.readerService.reloadOrder(created.id);
    return toOrderView({
      order: paidOrder,
      cardId: immediate.cardId === null ? null : String(immediate.cardId),
    });
  }

  /** 幂等键命中：直接复用已建订单（复用响应刻意不带 paymentParams） */
  private async reuseOnIdempotencyHit(
    currentContext: ClubCurrentContext,
    idempotencyKey: string | null,
  ): Promise<ClubMemberCardOrderView | null> {
    if (!idempotencyKey) {
      return null;
    }

    return this.readerService.findReusableOrder(
      currentContext.user.id,
      idempotencyKey,
    );
  }

  /**
   * 幂等占位：同一幂等键在 TTL 内只允许一个订单号在途。
   *
   * 已被别的订单号占用时，优先回读那笔订单（并发下同键同单）；
   * 回读不到说明对方还在建单中，按「处理中」返回 409。
   */
  private async reserveOrderNo(
    currentContext: ClubCurrentContext,
    idempotencyKey: string | null,
    orderNo: string,
  ): Promise<ClubMemberCardOrderView | null> {
    if (!idempotencyKey) {
      return null;
    }

    const occupiedOrderNo = await this.idempotencyService.reserve({
      scope: CLUB_CARD_ORDER_IDEMPOTENCY_SCOPE,
      userId: currentContext.user.id,
      key: idempotencyKey,
      orderNo,
    });
    if (!occupiedOrderNo || occupiedOrderNo === orderNo) {
      return null;
    }

    const occupied = await this.readerService.findReusableOrder(
      currentContext.user.id,
      idempotencyKey,
    );
    if (occupied) {
      return occupied;
    }

    throw new ConflictException(
      clubCardError(
        CLUB_CARD_ERROR_CODE.STATUS_ORDER_PROCESSING,
        '订单正在处理，请稍后在卡包或订单页查看',
      ),
    );
  }

  /** 建单失败必须释放占位，否则用户 15 分钟内重试只会被 409 拦住 */
  private async releaseReservationQuietly(
    currentContext: ClubCurrentContext,
    idempotencyKey: string | null,
  ): Promise<void> {
    if (!idempotencyKey) {
      return;
    }

    try {
      await this.idempotencyService.release({
        scope: CLUB_CARD_ORDER_IDEMPOTENCY_SCOPE,
        userId: currentContext.user.id,
        key: idempotencyKey,
      });
    } catch {
      // 释放失败只会多占用一个 TTL，不影响已抛出的业务错误
    }
  }

  /**
   * 下单门禁：每人限购 + 余额支付前置校验。
   *
   * 顺序不可交换（限购先于余额），错误码是对外契约。
   */
  private async assertPurchasable(
    planId: number,
    plan: ClubCardPlanContextRecord,
    customer: ClubCardCustomerSnapshot,
    paymentMethod: ClubCardPaymentMethod,
  ): Promise<void> {
    // 每人限购：以「已持有的未退款卡数」为准。
    // 不含未支付订单——用户在支付页反复取消不应被自己的废单拦住。
    if (plan.purchaseLimit !== null) {
      const owned = await this.contextService.countOwnedCards(this.prisma, {
        customerId: customer.id,
        planId,
      });
      if (owned >= plan.purchaseLimit) {
        throw new BadRequestException(
          clubCardError(
            CLUB_CARD_ERROR_CODE.RULE_PURCHASE_LIMIT_EXCEEDED,
            `${CLUB_CARD_PURCHASE_LIMIT_MESSAGE_PREFIX} ${plan.purchaseLimit} 张`,
          ),
        );
      }
    }

    // 余额支付前置校验：余额不足直接拒绝，避免落库永远付不掉的 unpaid 脏单（比较与文案均在后端）
    if (paymentMethod === 'balance' && customer.balanceFen < plan.price) {
      throw new BadRequestException(
        clubCardError(
          CLUB_CARD_ERROR_CODE.RULE_BALANCE_INSUFFICIENT,
          buildCardBalanceInsufficientMessage(customer.balanceFen, plan.price),
        ),
      );
    }
  }
}

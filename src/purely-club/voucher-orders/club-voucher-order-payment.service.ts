// 团购券订单支付服务：创建订单草稿（JSAPI 下单 / 余额直接结算）→ 支付成功确认（生成券码 + 扣库存 + 起算有效期）
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Money } from '../../shared/money.utils';
import {
  buildClubMemberDisplayName,
  getDisplayPhone,
} from '../../purely-profit/auth/auth.utils';
import { PrismaService, TX_TIMEOUT_MEDIUM } from '../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../redis/invalidator';
import { ClubWechatJsapiService } from '../payments/club-wechat-jsapi.service';
import { ClubPaymentModeService } from '../payments/club-payment-mode.service';
import { ClubWechatOpenidService } from '../payments/club-wechat-openid.service';
import { ClubOrderPreviewBreakdownService } from '../orders/club-order-preview-breakdown.service';
import { deductPointsForSettlement } from '../orders/club-order-settlement-points.utils';
import { ScanOrderingRealtimeService } from '../scan-ordering/scan-ordering-realtime.service';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import { ClubNewCustomerQuotaService } from '../shared/club-new-customer-quota.service';
import { ClubOrderIdempotencyService } from '../shared/club-order-idempotency.service';
import { settleVoucherBalancePayment } from './club-voucher-order-balance-settlement.helper';
import { ClubVoucherOrderContextService } from './club-voucher-order-context.service';
import { buildVoucherOrderNo } from './club-voucher-order-code.utils';
import {
  buildVoucherOrderBreakdownItems,
  buildVoucherOrderCreateInput,
  generateUniqueVoucherCode,
  toVoucherOrderDraftView,
} from './club-voucher-order-payment.helper';
import type {
  ClubVoucherOrderDraftView,
  PaidVoucherOrderSnapshot,
} from './club-voucher-order-payment.types';
import {
  CLUB_VOUCHER_ORDER_NOT_FOUND_MESSAGE,
  CLUB_VOUCHER_STOCK_NOT_ENOUGH_MESSAGE,
} from './club-voucher-orders.constants';
import { CLUB_VOUCHER_DEFAULT_VALID_DAYS } from './club-voucher-orders.types';
import type {
  ClubVoucherOrderResponseDto,
  CreateClubVoucherOrderDto,
} from './dto/club-voucher-order.dto';

/** 团购券订单的幂等作用域（与服务购买订单区分开） */
const VOUCHER_ORDER_IDEMPOTENCY_SCOPE = 'club:voucher-order:create';

@Injectable()
export class ClubVoucherOrderPaymentService {
  private readonly logger = new Logger(ClubVoucherOrderPaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clubPaymentModeService: ClubPaymentModeService,
    private readonly clubVoucherOrderContextService: ClubVoucherOrderContextService,
    private readonly clubWechatJsapiService: ClubWechatJsapiService,
    private readonly breakdownService: ClubOrderPreviewBreakdownService,
    private readonly realtimeService: ScanOrderingRealtimeService,
    private readonly cacheInvalidatorService: CacheInvalidatorService,
    private readonly quotaService: ClubNewCustomerQuotaService,
    private readonly clubWechatOpenidService: ClubWechatOpenidService,
    private readonly idempotencyService: ClubOrderIdempotencyService,
  ) {}

  /** 创建团购券订单草稿：校验商品/算价 → JSAPI 下单 → 落库 unpaid */
  async createVoucherOrder(
    currentContext: ClubCurrentContext,
    dto: CreateClubVoucherOrderDto,
    idempotencyKey?: string,
  ): Promise<ClubVoucherOrderResponseDto> {
    const idempotency = this.idempotencyService.normalizeKey(idempotencyKey);

    // 重复提交（双击 / 网络重试）一律复用已建订单：团购券订单会扣库存与新客额度，
    // 同一笔意图绝不能再建一单。数据库 (user_id, idempotency_key) 唯一键是最终兜底，
    // 这里先查一次，绝大多数重复请求连算价与微信下单都不会走到。
    if (idempotency) {
      const existing = await this.findReusableOrder(
        currentContext.user.id,
        idempotency,
      );
      if (existing) {
        return existing;
      }
    }

    const context = await this.clubVoucherOrderContextService.resolveContext(
      currentContext,
      dto,
    );
    // 新客额度闸门：新客在额度耗尽时禁止下单，与扫码点餐同一口径。
    // 放在算价之前——被拦时不必白算一轮促销与积分。
    // 额度归属取本次下单所在门店（context 已校验等于当前门店）：该顾客若尚未在
    // 任何门店消耗过额度，就由这家门店承担额度；已在别家店认证过则直接放行。
    await this.quotaService.assertAvailableForOrder(
      context.store.id,
      currentContext.user.id,
    );

    const quantity = dto.quantity ?? 1;
    const personCount = dto.personCount ?? context.product.personCount ?? 1;
    const pricing = await this.clubVoucherOrderContextService.resolvePricing(
      context,
      quantity,
      dto.usePoints === true,
    );

    if (context.product.stock < quantity) {
      throw new BadRequestException(CLUB_VOUCHER_STOCK_NOT_ENOUGH_MESSAGE);
    }

    const orderNo = buildVoucherOrderNo(Date.now());
    // 顾客信息快照：静默微信登录拿不到昵称（user.name 为 null），
    // 姓名兜底为「纯利会员+标识后4位」（与营销顾客档案命名规则一致），
    // 保证商家端订单卡与开台回填都有可识别的顾客名；电话仅快照真实手机号。
    const guestSnapshot = this.resolveGuestSnapshot(currentContext.user);
    const breakdownItems = buildVoucherOrderBreakdownItems(
      this.breakdownService,
      pricing,
    );
    const paymentMethod = dto.paymentMethod ?? 'wechat';

    // 余额支付：下单即扣款，余额不足直接拒绝（避免落库 unpaid 脏单）
    if (
      paymentMethod === 'balance' &&
      context.customer.balance < pricing.paidAmountFen
    ) {
      throw new BadRequestException(
        `余额不足，当前余额 ¥${Money.fromDbCents(context.customer.balance).toFixedOutputYuan()}，需支付 ¥${Money.fromDbCents(pricing.paidAmountFen).toFixedOutputYuan()}`,
      );
    }

    // 微信 JSAPI 真实下单：openid 显式传入优先，未传则按 userId 回查。
    // 解析不到时不调起真实支付，保持既有降级口径。
    // 余额支付无需微信下单参数，直接落 unpaid 后在同一请求内完成结算。
    const wechatOpenid =
      paymentMethod === 'wechat'
        ? await this.clubWechatOpenidService.resolveOpenid(
            currentContext.user.id,
            dto.openid,
          )
        : null;
    const paymentParams = wechatOpenid
      ? await this.clubWechatJsapiService.createJsapiPaymentParams({
          storeId: context.store.id,
          orderNo,
          description: `购买${context.product.name}`,
          amountFen: pricing.paidAmountFen,
          openid: wechatOpenid,
        })
      : undefined;

    // 并发双击：同一幂等键只允许一笔真正落库
    if (idempotency) {
      const occupiedOrderNo = await this.idempotencyService.reserve({
        scope: VOUCHER_ORDER_IDEMPOTENCY_SCOPE,
        userId: currentContext.user.id,
        key: idempotency,
        orderNo,
      });
      if (occupiedOrderNo && occupiedOrderNo !== orderNo) {
        // 并发重复提交：对方已占位，优先返回对方那笔（已提交则能查到）
        const occupied = await this.findReusableOrder(
          currentContext.user.id,
          idempotency,
        );
        if (occupied) {
          return occupied;
        }
        throw new ConflictException('订单正在处理，请稍后在订单列表查看');
      }
    }

    try {
      // 落库与额度扣减必须在同一事务：扣不到额度（并发下被别人抢走最后一个）就回滚，
      // 保证「服务的新客数」严格等于「扣掉的额度」。老客在扣减处直接放行。
      // 余额结算（completePayment）刻意留在事务外——它自带事务且要发实时通知。
      const created = await this.prisma.$transaction(
        async (tx) => {
          const order = await tx.clubVoucherOrder.create({
            data: {
              ...buildVoucherOrderCreateInput({
                orderNo,
                storeId: context.store.id,
                userId: currentContext.user.id,
                customerId: context.customer.id,
                product: context.product,
                guestName: guestSnapshot.guestName,
                guestPhone: guestSnapshot.guestPhone,
                quantity,
                personCount,
                remark: dto.remark,
                pricing,
                breakdownItems,
                paymentMethod,
              }),
              // 幂等键随单落库，(user_id, idempotency_key) 唯一键是并发兜底
              idempotencyKey: idempotency,
            },
            select: { id: true },
          });

          await this.quotaService.consumeWithinOrderTransaction(
            tx,
            context.store.id,
            currentContext.user.id,
            currentContext.user.phone || null,
          );

          return order;
        },
        { timeout: TX_TIMEOUT_MEDIUM },
      );

      // 余额支付：同一请求内完成落账（扣余额 + 生成券码 + 扣库存 + 起算有效期）
      if (paymentMethod === 'balance') {
        const view = await this.completePayment(
          created.id,
          pricing.paidAmountFen,
          undefined,
        );
        return {
          id: view.id,
          orderNo: view.orderNo,
          voucherCode: view.voucherCode ?? undefined,
          status: view.status,
          amountFen: view.amountFen,
        };
      }

      return {
        id: orderNo,
        orderNo,
        status: 'unpaid',
        amountFen: pricing.paidAmountFen,
        paymentParams,
      };
    } catch (error) {
      // 唯一键兜底命中：说明并发的另一笔请求已经提交成功，直接返回它，
      // 不能把「重复提交」报成 500，也不能让用户看到两笔订单
      if (idempotency && this.isUniqueConstraintError(error)) {
        const duplicated = await this.findReusableOrder(
          currentContext.user.id,
          idempotency,
        );
        if (duplicated) {
          return duplicated;
        }
      }

      // 建单失败必须释放幂等占位，否则用户 15 分钟内用同一个键重试只会被 409 拦住
      if (idempotency) {
        try {
          await this.idempotencyService.release({
            scope: VOUCHER_ORDER_IDEMPOTENCY_SCOPE,
            userId: currentContext.user.id,
            key: idempotency,
          });
        } catch {
          // 释放失败只会让对方多等一个 TTL，不影响已抛出的业务错误
        }
      }
      throw error;
    }
  }

  /**
   * 按幂等键找已创建的订单并组装复用响应。
   *
   * 复用响应刻意不带支付参数：微信同一 out_trade_no 不能重复下单，
   * 前端拿到 reused=true 时应当引导用户去订单列表继续支付或查看，
   * 而不是再次调起收银台。
   */
  private async findReusableOrder(
    userId: number,
    idempotencyKey: string,
  ): Promise<ClubVoucherOrderResponseDto | null> {
    const order = await this.prisma.clubVoucherOrder.findFirst({
      where: { userId, idempotencyKey },
      select: {
        orderNo: true,
        status: true,
        paidAmountFen: true,
        voucherCode: true,
      },
    });

    if (!order) {
      return null;
    }

    return {
      id: order.orderNo,
      orderNo: order.orderNo,
      voucherCode: order.voucherCode ?? undefined,
      status: order.status,
      amountFen: order.paidAmountFen,
      reused: true,
    };
  }

  /** 是否命中唯一约束（P2002）：并发重复提交的唯一兜底信号 */
  private isUniqueConstraintError(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }

  /**
   * 顾客信息快照解析：
   * - 姓名：昵称非空用昵称；否则按手机号/标识派生展示名「纯利会员+后4位」，
   *   与加入门店时营销顾客档案的命名规则（buildClubMemberDisplayName）完全一致，
   *   避免静默微信注册用户（无昵称）的订单在商家端显示占位「顾客」、开台回填无名字。
   * - 电话：仅快照真实手机号；占位手机号（club_wechat:openid）不留存为空。
   */
  private resolveGuestSnapshot(user: {
    name?: string | null;
    phone?: string | null;
  }): { guestName: string | null; guestPhone: string | null } {
    const phone = user.phone ?? '';
    return {
      guestName: buildClubMemberDisplayName(phone, user.name),
      guestPhone: getDisplayPhone(phone) || null,
    };
  }

  /** 用户端确认支付成功（开发态兜底）：unpaid → pending + 生成券码 + 扣库存 */
  async confirmOrderPaid(
    currentContext: ClubCurrentContext,
    orderNo: string,
  ): Promise<ClubVoucherOrderDraftView> {
    // 资金安全闸门（统一由 ClubPaymentModeService 裁决，口径与
    // club-payment-confirmation.orchestrator 完全一致）：
    // 手动 confirm-paid 只能用于本地/联调的测试模式。生产环境强制不可用，
    // 否则任意持订单号的人都能把未支付订单标记成已支付并真实落账——
    // 直接拿到券码并扣掉库存。
    const manualConfirmPaidAllowed =
      await this.clubPaymentModeService.isManualConfirmPaidAllowed();
    if (!manualConfirmPaidAllowed) {
      throw new ForbiddenException(
        '当前环境未开启手动确认支付，请通过支付回调驱动落账',
      );
    }

    const order = await this.prisma.clubVoucherOrder.findFirst({
      where: { orderNo, userId: currentContext.user.id },
    });
    if (!order) {
      throw new BadRequestException(CLUB_VOUCHER_ORDER_NOT_FOUND_MESSAGE);
    }
    // 测试模式落账必须留下可识别标记：统一用 `dev-` 前缀的交易号，
    // 与扫码点餐 / 自助点餐两条链路同口径，对账侧可据此排除测试订单，
    // 避免「测试模式订单混进真实对账」。
    return this.completePayment(order.id, order.paidAmountFen, {
      transactionId: `dev-${order.orderNo}`,
    });
  }

  /** 微信回调确认支付成功：按订单号路由，校验金额后完成落账 */
  async confirmOrderPaidByCallback(
    orderNo: string,
    params: { amountFen: number; transactionId?: string; paidAtMs?: number },
  ): Promise<ClubVoucherOrderDraftView> {
    const order = await this.prisma.clubVoucherOrder.findUnique({
      where: { orderNo },
    });
    if (!order) {
      throw new BadRequestException(CLUB_VOUCHER_ORDER_NOT_FOUND_MESSAGE);
    }
    if (order.paidAmountFen !== params.amountFen) {
      throw new BadRequestException('回调金额与订单金额不一致');
    }
    return this.completePayment(order.id, order.paidAmountFen, params);
  }

  /**
   * 支付完成事务：unpaid → pending，生成唯一券码，扣减库存，起算有效期
   * 幂等：已 pending/used 的订单重复确认直接返回，不重复扣库存
   */
  private async completePayment(
    orderId: number,
    expectedAmountFen: number,
    params?: { transactionId?: string; paidAtMs?: number },
  ): Promise<ClubVoucherOrderDraftView> {
    const { view, paidOrder } = await this.prisma.$transaction(
      async (
        tx,
      ): Promise<{
        view: ClubVoucherOrderDraftView;
        paidOrder: PaidVoucherOrderSnapshot | null;
      }> => {
        const order = await tx.clubVoucherOrder.findUnique({
          where: { id: orderId },
        });
        if (!order) {
          throw new BadRequestException(CLUB_VOUCHER_ORDER_NOT_FOUND_MESSAGE);
        }
        if (order.paidAmountFen !== expectedAmountFen) {
          throw new BadRequestException('订单金额不一致');
        }
        // 幂等闸门：先原子抢占 unpaid → pending。
        // 这里的 updateMany 是「当前读 + 行级写锁」：并发的第二笔会阻塞到第一笔提交后
        // 重新判定 status 条件，拿不到锁到的行（count=0）即说明已被结算。
        // 微信支付回调与客户端 confirm-paid 会对同一单双触发，仅靠「先读再写」
        // 会让两笔都读到 unpaid，从而重复扣库存/扣积分并生成两个券码。
        // 后续扣减失败会随事务回滚，闸门一并释放回 unpaid。
        const claimed = await tx.clubVoucherOrder.updateMany({
          where: { id: orderId, status: 'unpaid' },
          data: { status: 'pending' },
        });
        if (claimed.count !== 1) {
          // 已被本次之外的链路结算：读取最新行返回现状（幂等）
          const settled = await tx.clubVoucherOrder.findUnique({
            where: { id: orderId },
          });
          if (!settled) {
            throw new BadRequestException(CLUB_VOUCHER_ORDER_NOT_FOUND_MESSAGE);
          }
          return { view: toVoucherOrderDraftView(settled), paidOrder: null };
        }

        const product = await tx.marketingProduct.findUnique({
          where: { id: order.productId },
          select: { stock: true, validDays: true },
        });
        if (!product || product.stock < order.quantity) {
          throw new BadRequestException(CLUB_VOUCHER_STOCK_NOT_ENOUGH_MESSAGE);
        }

        // 扣库存（行级条件更新，防止超卖）
        const decremented = await tx.marketingProduct.updateMany({
          where: { id: order.productId, stock: { gte: order.quantity } },
          data: { stock: { decrement: order.quantity } },
        });
        if (decremented.count !== 1) {
          throw new BadRequestException(CLUB_VOUCHER_STOCK_NOT_ENOUGH_MESSAGE);
        }

        // 余额支付：扣减储值余额 + 记消费流水 + 更新顾客指标 + 赠送消费积分
        if (order.paymentChannel === 'balance' && order.customerId !== null) {
          await settleVoucherBalancePayment(tx, order, order.customerId);
        }

        // BUG 修复：积分抵扣扣减在支付确认时执行（此前只在退款时返还、购买从未扣减，导致越退积分越多）
        if (order.pointsUsed > 0 && order.customerId !== null) {
          await deductPointsForSettlement(
            tx,
            {
              storeId: order.storeId,
              description: order.productName,
              paidAmountFen: order.paidAmountFen,
            },
            order.customerId,
            order.pointsUsed,
          );
        }

        // 生成唯一券码（碰撞重试）
        const voucherCode = await generateUniqueVoucherCode(tx);

        const validDays = product.validDays ?? CLUB_VOUCHER_DEFAULT_VALID_DAYS;
        const paidAt = params?.paidAtMs
          ? new Date(params.paidAtMs)
          : new Date();

        const updated = await tx.clubVoucherOrder.update({
          where: { id: orderId },
          data: {
            voucherCode,
            status: 'pending',
            transactionId: params?.transactionId ?? null,
            expiresAt: new Date(
              paidAt.getTime() + validDays * 24 * 60 * 60 * 1000,
            ),
          },
        });

        this.logger.log(
          `团购券订单支付成功: orderNo=${order.orderNo}, voucherCode=${voucherCode}, 有效期${validDays}天`,
        );
        return {
          view: toVoucherOrderDraftView(updated),
          paidOrder: {
            storeId: order.storeId,
            orderNo: order.orderNo,
            voucherCode,
            guestName: order.guestName,
            guestPhone: order.guestPhone,
            productName: order.productName,
            categoryName: order.categoryName,
            quantity: order.quantity,
            paidAmountFen: order.paidAmountFen,
            remark: order.remark,
            createdAt: order.createdAt,
          },
        };
      },
      { timeout: TX_TIMEOUT_MEDIUM },
    );

    if (paidOrder) {
      // 余额/积分已落账：失效营销衍生缓存（概览 / 顾客列表 / 顾客详情），
      // 否则商家端要等 TTL 才看得到变化
      await this.cacheInvalidatorService.invalidateMarketingCustomerDerived(
        paidOrder.storeId,
      );
      // 事务提交成功后才广播新订单事件，避免事务回滚导致商家端收到假通知
      this.realtimeService.publishVoucherOrderCreated({
        storeId: paidOrder.storeId,
        orderNo: paidOrder.orderNo,
        voucherCode: paidOrder.voucherCode,
        guestName: paidOrder.guestName,
        guestPhone: paidOrder.guestPhone,
        productName: paidOrder.productName,
        categoryName: paidOrder.categoryName,
        quantity: paidOrder.quantity,
        paidAmountFen: paidOrder.paidAmountFen,
        remark: paidOrder.remark,
        createdAt: paidOrder.createdAt.toISOString(),
      });
    }

    return view;
  }
}

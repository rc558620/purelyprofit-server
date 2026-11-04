// 团购券订单支付确认（落账）：unpaid → pending，生成券码 + 扣库存 + 余额/积分结算 + 事务后广播
//
// 从 ClubVoucherOrderPaymentService 拆出的原因：建单与落账是两条独立职责 ——
// 建单关心算价与幂等，落账关心资金与库存；混在一个类里时，任何一侧的口径改动
// 都要在 500 行的文件里同时理解另一侧的行为，回归风险远高于拆开。
// 事务边界没有变化：扣库存 / 扣余额 / 扣积分 / 生成券码仍在同一个 $transaction 内。
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { ClubVoucherOrder, Prisma } from '@prisma/client';
import { PrismaService, TX_TIMEOUT_MEDIUM } from '../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../redis/invalidator';
import { isBalancePaymentChannel } from '../payments/club-payment-channels.constants';
import { ClubPaymentModeService } from '../payments/club-payment-mode.service';
import {
  assertClubPaymentAmountMatches,
  assertClubPaymentAmountMatchesAllowZero,
} from '../payments/club-payments.utils';
import { deductPointsForSettlement } from '../orders/club-order-settlement-points.utils';
import { ScanOrderingRealtimeService } from '../scan-ordering/scan-ordering-realtime.service';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import { settleVoucherBalancePayment } from './club-voucher-order-balance-settlement.helper';
import {
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

/** 落账事务产出：视图用于响应，快照用于事务提交后的缓存失效与广播 */
interface VoucherOrderSettlementResult {
  view: ClubVoucherOrderDraftView;
  paidOrder: PaidVoucherOrderSnapshot | null;
}

/** 落账附带的外部事实（交易号 / 微信侧支付时间） */
interface VoucherOrderSettlementParams {
  transactionId?: string;
  paidAtMs?: number;
}

@Injectable()
export class ClubVoucherOrderSettlementService {
  private readonly logger = new Logger(ClubVoucherOrderSettlementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clubPaymentModeService: ClubPaymentModeService,
    private readonly cacheInvalidatorService: CacheInvalidatorService,
    private readonly realtimeService: ScanOrderingRealtimeService,
  ) {}

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
    params: { amountFen: number } & VoucherOrderSettlementParams,
  ): Promise<ClubVoucherOrderDraftView> {
    const order = await this.prisma.clubVoucherOrder.findUnique({
      where: { orderNo },
    });
    if (!order) {
      throw new BadRequestException(CLUB_VOUCHER_ORDER_NOT_FOUND_MESSAGE);
    }
    assertClubPaymentAmountMatches(order.paidAmountFen, params.amountFen);
    return this.completePayment(order.id, order.paidAmountFen, params);
  }

  /**
   * 支付完成事务：unpaid → pending，生成唯一券码，扣减库存，起算有效期。
   * 幂等：已 pending/used 的订单重复确认直接返回，不重复扣库存。
   */
  async completePayment(
    orderId: number,
    expectedAmountFen: number,
    params?: VoucherOrderSettlementParams,
  ): Promise<ClubVoucherOrderDraftView> {
    const { view, paidOrder } = await this.prisma.$transaction(
      async (tx) =>
        this.settleWithinTransaction(tx, orderId, expectedAmountFen, params),
      { timeout: TX_TIMEOUT_MEDIUM },
    );

    await this.publishSettledOrder(paidOrder);
    return view;
  }

  // ─── 事务内步骤 ───────────────────────────────────────────────────────────

  private async settleWithinTransaction(
    tx: Prisma.TransactionClient,
    orderId: number,
    expectedAmountFen: number,
    params?: VoucherOrderSettlementParams,
  ): Promise<VoucherOrderSettlementResult> {
    const order = await tx.clubVoucherOrder.findUnique({
      where: { id: orderId },
    });
    if (!order) {
      throw new BadRequestException(CLUB_VOUCHER_ORDER_NOT_FOUND_MESSAGE);
    }
    // 允许 0 元：全额积分抵扣的免费券不经过微信收银台，但金额仍须完全一致
    assertClubPaymentAmountMatchesAllowZero(
      order.paidAmountFen,
      expectedAmountFen,
    );

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
      return { view: await this.readSettledView(tx, orderId), paidOrder: null };
    }

    const validDays = await this.consumeStock(tx, order);
    await this.applyBalanceAndPoints(tx, order);
    return this.finalizeSettlement(tx, order, validDays, params);
  }

  /** 已被本次之外的链路结算：读取最新行返回现状（幂等） */
  private async readSettledView(
    tx: Prisma.TransactionClient,
    orderId: number,
  ): Promise<ClubVoucherOrderDraftView> {
    const settled = await tx.clubVoucherOrder.findUnique({
      where: { id: orderId },
    });
    if (!settled) {
      throw new BadRequestException(CLUB_VOUCHER_ORDER_NOT_FOUND_MESSAGE);
    }
    return toVoucherOrderDraftView(settled);
  }

  /** 扣库存（行级条件更新，防止超卖），返回商品有效天数供有效期计算 */
  private async consumeStock(
    tx: Prisma.TransactionClient,
    order: ClubVoucherOrder,
  ): Promise<number | null> {
    const product = await tx.marketingProduct.findUnique({
      where: { id: order.productId },
      select: { stock: true, validDays: true },
    });
    if (!product || product.stock < order.quantity) {
      throw new BadRequestException(CLUB_VOUCHER_STOCK_NOT_ENOUGH_MESSAGE);
    }

    const decremented = await tx.marketingProduct.updateMany({
      where: { id: order.productId, stock: { gte: order.quantity } },
      data: { stock: { decrement: order.quantity } },
    });
    if (decremented.count !== 1) {
      throw new BadRequestException(CLUB_VOUCHER_STOCK_NOT_ENOUGH_MESSAGE);
    }
    return product.validDays;
  }

  /** 余额支付扣款与积分抵扣扣减：两者都以「顾客档案」为归属，缺失时跳过 */
  private async applyBalanceAndPoints(
    tx: Prisma.TransactionClient,
    order: ClubVoucherOrder,
  ): Promise<void> {
    if (
      isBalancePaymentChannel(order.paymentChannel) &&
      order.customerId !== null
    ) {
      await settleVoucherBalancePayment(tx, order, order.customerId);
    }

    // BUG 修复：积分抵扣扣减在支付确认时执行
    //（此前只在退款时返还、购买从未扣减，导致越退积分越多）
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
  }

  /** 生成券码 + 起算有效期 + 回写订单，并产出事务后广播所需的快照 */
  private async finalizeSettlement(
    tx: Prisma.TransactionClient,
    order: ClubVoucherOrder,
    validDays: number | null,
    params?: VoucherOrderSettlementParams,
  ): Promise<VoucherOrderSettlementResult> {
    // 生成唯一券码（碰撞重试）
    const voucherCode = await generateUniqueVoucherCode(tx);
    const effectiveValidDays = validDays ?? CLUB_VOUCHER_DEFAULT_VALID_DAYS;
    const paidAt = params?.paidAtMs ? new Date(params.paidAtMs) : new Date();

    const updated = await tx.clubVoucherOrder.update({
      where: { id: order.id },
      data: {
        voucherCode,
        status: 'pending',
        transactionId: params?.transactionId ?? null,
        expiresAt: new Date(
          paidAt.getTime() + effectiveValidDays * 24 * 60 * 60 * 1000,
        ),
      },
    });

    this.logger.log(
      `团购券订单支付成功: orderNo=${order.orderNo}, voucherCode=${voucherCode}, 有效期${effectiveValidDays}天`,
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
  }

  // ─── 事务提交后的副作用 ───────────────────────────────────────────────────

  /**
   * 只有本次真正落账（paidOrder 非空）才触发副作用：
   * 幂等命中已结算订单时重复广播会让商家端收到假的新订单通知。
   */
  private async publishSettledOrder(
    paidOrder: PaidVoucherOrderSnapshot | null,
  ): Promise<void> {
    if (!paidOrder) {
      return;
    }

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
}

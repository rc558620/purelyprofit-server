// 扫码点餐「储值余额支付」链路：同一事务内扣余额 + 积分落账 + 状态推进
//
// 从 ClubScanOrderingCheckoutService 拆出的原因：微信 JSAPI 发起只产生支付参数，
// 而余额支付会**当场扣真实款项**，失败语义完全不同。开发态手动确认（跳过扣款）
// 见 ClubScanOrderingDevelopmentCheckoutService，两条链路刻意不放在一起。
import { ConflictException, Injectable } from '@nestjs/common';
import {
  CLUB_SCAN_ORDERING_ERROR_CODE,
  clubScanOrderingError,
} from './club-scan-ordering.errors';
import type { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../redis/invalidator';
import { debitCustomerBalance } from '../payments/club-balance-settlement.utils';
import { CLUB_CHANNEL_MARKETING_BALANCE } from '../payments/club-payment-channels.constants';
import {
  loadOwnedScanOrder,
  publishScanOrderPaid,
  readScanOrderPointsSnapshot,
} from './club-scan-ordering-checkout.shared';
import type {
  PaidScanOrder,
  ScanOrderPointsSnapshot,
} from './club-scan-ordering-checkout.shared';
import { ClubScanOrderingMarketingCustomerService } from './club-scan-ordering-marketing-customer.service';
import { ScanOrderingPickupNumberService } from './scan-ordering-pickup-number.service';
import { ScanOrderingRealtimeService } from './scan-ordering-realtime.service';

/** 余额落账事务所需的全部事实（一次带齐，避免事务内再回查订单） */
interface ScanBalanceSettlementContext {
  order: {
    id: number;
    storeId: number;
    orderNo: string;
    payableAmount: number;
    version: number;
    marketingSnapshot: unknown;
  };
  customerId: number;
  userId: number;
  paidAt: Date;
  points: ScanOrderPointsSnapshot;
}

@Injectable()
export class ClubScanOrderingBalanceCheckoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly marketingCustomerService: ClubScanOrderingMarketingCustomerService,
    private readonly pickupNumberService: ScanOrderingPickupNumberService,
    private readonly cacheInvalidatorService: CacheInvalidatorService,
    private readonly realtimeService: ScanOrderingRealtimeService,
  ) {}

  /** 储值余额支付：同一事务内扣余额 + 积分落账 + 状态推进 */
  async createBalancePayment(
    user: AuthenticatedUser,
    orderId: number,
    _version: number,
  ): Promise<unknown> {
    const order = await this.prisma.scanOrders.findFirst({
      where: {
        id: orderId,
        clubUserId: user.id,
        status: 'pending_payment',
        paymentStatus: 'unpaid',
        deletedAt: null,
      },
      select: {
        id: true,
        storeId: true,
        orderNo: true,
        payableAmount: true,
        sessionId: true,
        version: true,
        marketingSnapshot: true,
      },
    });
    if (!order)
      throw new ConflictException(
        clubScanOrderingError(
          CLUB_SCAN_ORDERING_ERROR_CODE.STATUS_ORDER_STATE_CHANGED,
          '订单状态已变化，请刷新后重试',
        ),
      );

    const customer = await this.marketingCustomerService.resolveActiveCustomer(
      order.storeId,
      user.id,
    );
    const paidAt = new Date();
    const points = readScanOrderPointsSnapshot(order.marketingSnapshot);

    const result = await this.prisma.$transaction(async (tx) =>
      this.settleWithinTransaction(tx, {
        order,
        customerId: customer.id,
        userId: user.id,
        paidAt,
        points,
      }),
    );

    await publishScanOrderPaid(
      {
        cacheInvalidatorService: this.cacheInvalidatorService,
        realtimeService: this.realtimeService,
        pickupNumberService: this.pickupNumberService,
      },
      result,
    );
    return loadOwnedScanOrder(this.prisma, user, result.id);
  }

  // ─── 事务内落账 ───────────────────────────────────────────────────────────

  private async settleWithinTransaction(
    tx: Prisma.TransactionClient,
    ctx: ScanBalanceSettlementContext,
  ): Promise<PaidScanOrder> {
    const { order, paidAt } = ctx;

    const earnedPoints = await this.debitBalanceAndSettlePoints(tx, ctx);

    // 乐观锁推进：并发下第二笔（如同时点了微信支付）会被 version 条件挡住
    const updated = await tx.scanOrders.updateMany({
      where: {
        id: order.id,
        version: order.version,
        status: 'pending_payment',
        paymentStatus: 'unpaid',
      },
      data: {
        status: 'pending_acceptance',
        paymentStatus: 'paid',
        paidAmount: order.payableAmount,
        paidAt,
        marketingSnapshot: {
          ...(order.marketingSnapshot as object),
          pointsSettlementStatus: 'settled',
          earnedPoints,
        },
        version: { increment: 1 },
      },
    });
    if (updated.count === 0) {
      throw new ConflictException(
        clubScanOrderingError(
          CLUB_SCAN_ORDERING_ERROR_CODE.STATUS_ORDER_STATE_CHANGED,
          '订单状态已变化，请刷新后重试',
        ),
      );
    }

    // 余额支付成功分配取餐号（幂等：已分配时直接跳过）
    await this.pickupNumberService.assignForPaidOrder(
      tx,
      order.id,
      order.storeId,
      paidAt.getTime(),
    );
    await this.recordBalanceSettlement(tx, ctx);

    // 销售记录不在支付成功时创建：交班页须在商家出餐/拒绝后再展示订单
    return tx.scanOrders.findUniqueOrThrow({ where: { id: order.id } });
  }

  /**
   * 扣储值余额 + 积分落账（同事务，缺任一步都会造成账实偏差）。
   *
   * 积分扣减 / 消费送积分 / 消费记录统一在此落账：应付金额已是积分抵扣后的值，
   * 不扣 pointsUsed 就等于让顾客白拿抵扣。三条支付路径都必须走这里。
   *
   * @returns 本次消费赠送的积分，需回写到订单快照
   */
  private async debitBalanceAndSettlePoints(
    tx: Prisma.TransactionClient,
    ctx: ScanBalanceSettlementContext,
  ): Promise<number> {
    const { order } = ctx;

    await debitCustomerBalance(tx, {
      customerId: ctx.customerId,
      storeId: order.storeId,
      balancePaidFen: order.payableAmount,
      requireActive: true,
      buildInsufficientError: () => new ConflictException('储值余额不足'),
    });

    const { earnedPoints } =
      await this.marketingCustomerService.settlePaidOrder(tx, {
        storeId: order.storeId,
        orderId: order.id,
        orderNo: order.orderNo,
        customerId: ctx.customerId,
        paidAmountFen: order.payableAmount,
        pointsUsed: ctx.points.pointsUsed,
        pointsDeductAmount: ctx.points.pointsDeductAmount,
        payType: 'balance',
      });
    return earnedPoints;
  }

  /** 余额支付的支付尝试 / 余额流水 / 状态历史三笔留痕（与扣款同事务） */
  private async recordBalanceSettlement(
    tx: Prisma.TransactionClient,
    ctx: Pick<
      ScanBalanceSettlementContext,
      'order' | 'customerId' | 'userId' | 'paidAt'
    >,
  ): Promise<void> {
    const { order, paidAt } = ctx;

    await tx.scanOrderPaymentAttempt.create({
      data: {
        orderId: order.id,
        storeId: order.storeId,
        paymentChannel: CLUB_CHANNEL_MARKETING_BALANCE,
        merchantPaymentNo: `BAL-${order.orderNo}`,
        amount: order.payableAmount,
        status: 'succeeded',
        paidAt,
        providerTransactionId: `marketing-balance-${order.id}`,
      },
    });
    await tx.scanOrderBalanceTransaction.create({
      data: {
        orderId: order.id,
        customerId: ctx.customerId,
        amount: order.payableAmount,
        type: 'payment',
      },
    });
    await tx.scanOrderStatusHistory.create({
      data: {
        orderId: order.id,
        storeId: order.storeId,
        fromStatus: 'pending_payment',
        toStatus: 'pending_acceptance',
        operatorType: 'club_user',
        operatorId: ctx.userId,
        reason: '储值余额支付成功',
      },
    });
  }
}

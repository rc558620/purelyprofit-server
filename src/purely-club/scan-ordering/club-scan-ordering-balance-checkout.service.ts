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
import { ScanOrderPaymentAttemptStatus } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../redis/invalidator';
import { debitCustomerBalance } from '../payments/club-balance-settlement.utils';
import {
  CLUB_CHANNEL_MARKETING_BALANCE,
  CLUB_CHANNEL_WECHAT_JSAPI,
} from '../payments/club-payment-channels.constants';
import { ClubPaymentLockService } from '../payments/club-payment-lock.service';
import { ClubScanOrderingWechatVerifyService } from './club-scan-ordering-wechat-verify.service';
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

/**
 * 订单落账锁前缀：与微信回调（ClubScanOrderingPaymentService）共用同一把锁。
 *
 * 余额支付与微信回调如果各自独立落账，同一订单可能被收两次款；共用锁之后，
 * 后到的一方读到的必然是「已支付」，从而走异常支付退款分支而不是重复收款。
 */
const ORDER_LOCK_KEY_PREFIX = 'scan-order:';

/** 可发起余额支付的订单快照 */
interface PayableBalanceOrder {
  id: number;
  storeId: number;
  orderNo: string;
  payableAmount: number;
  version: number;
  sessionId: number | null;
  marketingSnapshot: unknown;
  paymentExpiresAt: Date | null;
}

/** 余额落账事务所需的全部事实（一次带齐，避免事务内再回查订单） */
interface ScanBalanceSettlementContext {
  order: PayableBalanceOrder;
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
    private readonly paymentLockService: ClubPaymentLockService,
    private readonly wechatVerifyService: ClubScanOrderingWechatVerifyService,
  ) {}

  /**
   * 储值余额支付：同一事务内扣余额 + 积分落账 + 状态推进。
   *
   * 三道闸门缺一不可：
   * 1. 微信结果未确认时先查单（查单确认已收款则拒绝改道余额，避免重复扣款）；
   * 2. 与微信回调共用同一把订单锁，保证「同一订单只有一笔收款落账」；
   * 3. 落账条件包含支付截止时间，避免关单任务延迟时余额仍能扣款。
   */
  async createBalancePayment(
    user: AuthenticatedUser,
    orderId: number,
    version: number,
  ): Promise<unknown> {
    const order = await this.loadPayableOrder(user.id, orderId);
    this.assertClientVersion(order.version, version);
    this.assertNotExpired(order.paymentExpiresAt);
    await this.settlePendingWechatIfPaid(user.id, order.id);

    const lockKey = `${ORDER_LOCK_KEY_PREFIX}${order.id}`;
    const lockToken = await this.paymentLockService.acquireLock(lockKey);
    if (!lockToken) {
      throw new ConflictException(
        clubScanOrderingError(
          CLUB_SCAN_ORDERING_ERROR_CODE.STATUS_PAYMENT_IN_FLIGHT,
          '订单支付处理中，请稍后重试',
        ),
      );
    }
    try {
      // 锁内重读：查单 / 加锁之间订单可能已被微信回调落账或已过期
      const latest = await this.loadPayableOrder(user.id, orderId);
      const result = await this.settleOrder(user, latest);
      await publishScanOrderPaid(
        {
          cacheInvalidatorService: this.cacheInvalidatorService,
          realtimeService: this.realtimeService,
          pickupNumberService: this.pickupNumberService,
        },
        result,
      );
      return loadOwnedScanOrder(this.prisma, user, result.id);
    } finally {
      await this.paymentLockService.releaseLock(lockKey, lockToken);
    }
  }

  /** 读取可支付订单；不可支付统一抛状态冲突。 */
  private async loadPayableOrder(
    userId: number,
    orderId: number,
  ): Promise<PayableBalanceOrder> {
    const order = await this.prisma.scanOrders.findFirst({
      where: {
        id: orderId,
        clubUserId: userId,
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
        paymentExpiresAt: true,
      },
    });
    if (!order)
      throw new ConflictException(
        clubScanOrderingError(
          CLUB_SCAN_ORDERING_ERROR_CODE.STATUS_ORDER_STATE_CHANGED,
          '订单状态已变化，请刷新后重试',
        ),
      );
    return order;
  }

  /** 客户端版本必须与库内一致：过期页面不允许直接扣款。 */
  private assertClientVersion(
    currentVersion: number,
    clientVersion: number,
  ): void {
    if (!Number.isInteger(clientVersion) || clientVersion === currentVersion)
      return;
    throw new ConflictException(
      clubScanOrderingError(
        CLUB_SCAN_ORDERING_ERROR_CODE.STATUS_ORDER_STATE_CHANGED,
        '订单状态已变化，请刷新后重试',
      ),
    );
  }

  /** 支付截止时间已过：后台关单任务延迟时也不能再扣款。 */
  private assertNotExpired(paymentExpiresAt: Date | null): void {
    if (!paymentExpiresAt || paymentExpiresAt.getTime() > Date.now()) return;
    throw new ConflictException(
      clubScanOrderingError(
        CLUB_SCAN_ORDERING_ERROR_CODE.STATUS_ORDER_NOT_PAYABLE,
        '订单支付已超时，请重新下单',
      ),
    );
  }

  /**
   * 存在未确认结果的微信支付时先回微信查单。
   *
   * 查单确认已收款 → 抛状态冲突让客户端刷新（此时收款已由微信落账，
   * 再走余额就是同一订单收两次钱）；确认未收款 → 允许改道余额。
   */
  private async settlePendingWechatIfPaid(
    userId: number,
    orderId: number,
  ): Promise<void> {
    const pendingAttempt = await this.prisma.scanOrderPaymentAttempt.findFirst({
      where: {
        orderId,
        paymentChannel: CLUB_CHANNEL_WECHAT_JSAPI,
        status: {
          in: [
            ScanOrderPaymentAttemptStatus.created,
            ScanOrderPaymentAttemptStatus.paying,
          ],
        },
      },
      select: { id: true },
    });
    if (!pendingAttempt) return;

    // force：跳过查单节流，避免「刚被前端轮询过」时拿不到微信侧真实结果
    const settled = await this.wechatVerifyService.verifyAndSettle(
      userId,
      orderId,
      { force: true },
    );
    if (!settled) return;
    throw new ConflictException(
      clubScanOrderingError(
        CLUB_SCAN_ORDERING_ERROR_CODE.STATUS_ORDER_STATE_CHANGED,
        '微信支付已完成，请刷新订单状态',
      ),
    );
  }

  /** 事务外准备事实、事务内一次性落账（扣余额 / 积分 / 状态推进同成同败）。 */
  private async settleOrder(
    user: AuthenticatedUser,
    order: PayableBalanceOrder,
  ): Promise<PaidScanOrder> {
    const customer = await this.marketingCustomerService.resolveActiveCustomer(
      order.storeId,
      user.id,
    );
    const ctx: ScanBalanceSettlementContext = {
      order,
      customerId: customer.id,
      userId: user.id,
      paidAt: new Date(),
      points: readScanOrderPointsSnapshot(order.marketingSnapshot),
    };
    return this.prisma.$transaction(async (tx) =>
      this.settleWithinTransaction(tx, ctx),
    );
  }

  // ─── 事务内落账 ───────────────────────────────────────────────────────────

  private async settleWithinTransaction(
    tx: Prisma.TransactionClient,
    ctx: ScanBalanceSettlementContext,
  ): Promise<PaidScanOrder> {
    const { order, paidAt } = ctx;

    const earnedPoints = await this.debitBalanceAndSettlePoints(tx, ctx);

    // 乐观锁推进：并发下第二笔（如同时点了微信支付）会被 version 条件挡住；
    // 支付截止时间同样进原子条件——后台关单任务延迟时余额也不能再扣款
    const updated = await tx.scanOrders.updateMany({
      where: {
        id: order.id,
        version: order.version,
        status: 'pending_payment',
        paymentStatus: 'unpaid',
        OR: [{ paymentExpiresAt: null }, { paymentExpiresAt: { gt: paidAt } }],
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

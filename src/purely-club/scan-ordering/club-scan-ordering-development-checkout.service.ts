// 扫码点餐「开发态手动确认支付」链路
//
// 从 ClubScanOrderingBalanceCheckoutService 拆出的原因：这条链路**不扣任何真实款项**，
// 只在测试模式把订单推到已支付。它和余额支付共享「积分落账 + 取餐号」的写法，
// 但资金语义完全相反 —— 混在一起时，任何一次「顺手改余额支付」都可能把
// 跳过扣款的分支一并改动，属于最危险的一类回归。
import {
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import {
  CLUB_SCAN_ORDERING_ERROR_CODE,
  clubScanOrderingError,
} from './club-scan-ordering.errors';
import type { Prisma } from '@prisma/client';
import { ScanOrderPaymentAttemptStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../redis/invalidator';
import { ClubPaymentModeService } from '../payments/club-payment-mode.service';
import { ClubScanOrderingMarketingCustomerService } from './club-scan-ordering-marketing-customer.service';
import {
  loadOwnedScanOrder,
  publishScanOrderPaid,
  readScanOrderPointsSnapshot,
} from './club-scan-ordering-checkout.shared';
import type {
  PaidScanOrder,
  ScanOrderPointsSnapshot,
} from './club-scan-ordering-checkout.shared';
import { ScanOrderingPickupNumberService } from './scan-ordering-pickup-number.service';
import { ScanOrderingRealtimeService } from './scan-ordering-realtime.service';

/** 开发态确认时读取的订单行（已完成「本人 + 待支付」校验） */
type DevelopmentConfirmOrder = NonNullable<
  Awaited<ReturnType<Prisma.TransactionClient['scanOrders']['findFirst']>>
>;

@Injectable()
export class ClubScanOrderingDevelopmentCheckoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly marketingCustomerService: ClubScanOrderingMarketingCustomerService,
    private readonly pickupNumberService: ScanOrderingPickupNumberService,
    private readonly cacheInvalidatorService: CacheInvalidatorService,
    private readonly realtimeService: ScanOrderingRealtimeService,
    private readonly clubPaymentModeService: ClubPaymentModeService,
  ) {}

  /** 开发态手动确认支付：仅测试模式可用，落账口径与余额支付一致 */
  async confirmPaidForDevelopment(
    user: AuthenticatedUser,
    orderId: number,
  ): Promise<unknown> {
    // 资金安全闸门：与通用 confirm-paid 同口径，只有测试模式才允许跳过真实扣款。
    // 生产环境恒为 false，切到真实模式后同样不可用。
    const manualConfirmPaidAllowed =
      await this.clubPaymentModeService.isManualConfirmPaidAllowed();
    if (!manualConfirmPaidAllowed) {
      throw new ForbiddenException(
        clubScanOrderingError(
          CLUB_SCAN_ORDERING_ERROR_CODE.RULE_MANUAL_CONFIRM_DISABLED,
          '当前环境未开启手动确认支付，请通过支付回调驱动落账',
        ),
      );
    }

    const updated = await this.prisma.$transaction(async (tx) =>
      this.settleWithinTransaction(tx, user.id, orderId),
    );

    await publishScanOrderPaid(
      {
        cacheInvalidatorService: this.cacheInvalidatorService,
        realtimeService: this.realtimeService,
        pickupNumberService: this.pickupNumberService,
      },
      updated,
    );
    return loadOwnedScanOrder(this.prisma, user, updated.id);
  }

  private async settleWithinTransaction(
    tx: Prisma.TransactionClient,
    userId: number,
    orderId: number,
  ): Promise<PaidScanOrder> {
    const order = await this.loadDevelopmentOrder(tx, userId, orderId);

    const customer = await this.marketingCustomerService.resolveActiveCustomer(
      order.storeId,
      userId,
    );
    const points = readScanOrderPointsSnapshot(order.marketingSnapshot);

    await this.closeWechatAttemptForDevelopment(tx, orderId, order.orderNo);

    const paidAt = new Date();
    await this.markOrderPaid(tx, {
      order,
      customerId: customer.id,
      points,
      paidAt,
    });

    // 开发环境确认支付成功分配取餐号（幂等：已分配时直接跳过）
    await this.pickupNumberService.assignForPaidOrder(
      tx,
      order.id,
      order.storeId,
      paidAt.getTime(),
    );
    await tx.scanOrderStatusHistory.create({
      data: {
        orderId: order.id,
        storeId: order.storeId,
        fromStatus: 'pending_payment',
        toStatus: 'pending_acceptance',
        operatorType: 'development_payment',
        operatorId: userId,
        reason: '开发环境 H5 支付确认',
      },
    });

    // 销售记录不在支付成功时创建：交班页须在商家出餐/拒绝后再展示订单
    // 事务内重新读取，保证发布事件携带最新取餐号字段
    return tx.scanOrders.findUniqueOrThrow({ where: { id: order.id } });
  }

  /**
   * 积分落账 + 订单推进为已支付（同事务）。
   *
   * 与余额支付同口径落账：openid 缺省时微信链路会 fallback 到本接口，
   * 不补这一步就会出现「用了积分抵扣但积分没扣、也没有消费记录」。
   */
  private async markOrderPaid(
    tx: Prisma.TransactionClient,
    params: {
      order: DevelopmentConfirmOrder;
      customerId: number;
      points: ScanOrderPointsSnapshot;
      paidAt: Date;
    },
  ): Promise<void> {
    const { order, paidAt } = params;

    const { earnedPoints } =
      await this.marketingCustomerService.settlePaidOrder(tx, {
        storeId: order.storeId,
        orderId: order.id,
        orderNo: order.orderNo,
        customerId: params.customerId,
        paidAmountFen: order.payableAmount,
        pointsUsed: params.points.pointsUsed,
        pointsDeductAmount: params.points.pointsDeductAmount,
        payType: 'wechat',
      });

    await tx.scanOrders.update({
      where: { id: order.id },
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
  }

  /** 开发态确认只接受「本人 + 待支付」的订单 */
  private async loadDevelopmentOrder(
    tx: Prisma.TransactionClient,
    userId: number,
    orderId: number,
  ): Promise<DevelopmentConfirmOrder> {
    const order = await tx.scanOrders.findFirst({
      where: {
        id: orderId,
        clubUserId: userId,
        status: 'pending_payment',
        paymentStatus: 'unpaid',
        deletedAt: null,
      },
    });
    if (!order)
      throw new ConflictException(
        clubScanOrderingError(
          CLUB_SCAN_ORDERING_ERROR_CODE.STATUS_ORDER_NOT_CONFIRMABLE,
          '订单不可确认支付',
        ),
      );
    return order;
  }

  /**
   * 在途的微信支付尝试直接标记成功：否则同订单会一直停在「支付中」而无法再发起。
   * 交易号统一打 `dev-` 前缀，与扫码 / 自助两条链路的测试单口径一致。
   */
  private async closeWechatAttemptForDevelopment(
    tx: Prisma.TransactionClient,
    orderId: number,
    orderNo: string,
  ): Promise<void> {
    const paymentAttempt = await tx.scanOrderPaymentAttempt.findFirst({
      where: { orderId, status: { in: ['created', 'paying'] } },
      orderBy: { createdAt: 'desc' },
    });
    if (!paymentAttempt) {
      return;
    }

    await tx.scanOrderPaymentAttempt.update({
      where: { id: paymentAttempt.id },
      data: {
        status: ScanOrderPaymentAttemptStatus.succeeded,
        providerTransactionId: `dev-${orderNo}`,
        paidAt: new Date(),
      },
    });
  }
}

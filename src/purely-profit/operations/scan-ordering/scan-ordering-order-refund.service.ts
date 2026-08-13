import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ScanOrderCouponUsageStatus,
  ScanOrderFulfillmentStatus,
  ScanOrderPaymentAttemptStatus,
  ScanOrderPaymentStatus,
  ScanOrderStatus,
  type Prisma,
} from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { ScanOrderingRealtimeService } from '../../../purely-club/scan-ordering/scan-ordering-realtime.service';
import { ScanOrderingRefundService } from '../../../purely-club/scan-ordering/scan-ordering-refund.service';
import { ScanOrderingOrderRefundBalanceService } from './scan-ordering-order-refund-balance.service';
import { ScanOrderingRefundStockRestoreService } from './scan-ordering-refund-stock-restore.service';
import { ORDER_STATUS_SELECT } from './scan-ordering-refund.types';
import type {
  MerchantRejectContext,
  MerchantRefundFlowContext,
  OrderStatusHistoryInput,
  OrderStatusSnapshot,
  RefundFinalizeInput,
  RefundOrderTarget,
  RefundProviderInfo,
  RefundedOrderSnapshot,
  RefundTransitionTarget,
} from './scan-ordering-refund.types';

/** 商家扫码点餐订单退款处理服务：拒单分流、退款完成闭环并推送实时事件。 */
@Injectable()
export class ScanOrderingOrderRefundHandlingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly realtimeService: ScanOrderingRealtimeService,
    private readonly refundService: ScanOrderingRefundService,
    private readonly balanceRefundService: ScanOrderingOrderRefundBalanceService,
    private readonly stockRestoreService: ScanOrderingRefundStockRestoreService,
    private readonly configService: ConfigService,
  ) {}

  /** 拒绝待接单订单：已支付订单进入退款流程，未支付订单直接关闭。 */
  async rejectOrder(
    user: AuthenticatedUser,
    orderId: number,
    version: number,
    reason: string,
  ): Promise<void> {
    const storeId = await this.resolveRefundStoreId(user);
    await this.dispatchRejectFlow({ user, orderId, storeId, version, reason });
  }

  /** 确认拒单退款完成：置状态、归还库存、冲销销售单并推送事件。 */
  async completeRefund(
    user: AuthenticatedUser,
    orderId: number,
    version: number,
    provider?: RefundProviderInfo,
  ): Promise<void> {
    const storeId = await this.resolveRefundStoreId(user);
    const target = { orderId, storeId, version };
    const updated = await this.prisma.$transaction(async (tx) => {
      await this.markRefundCompleted(tx, target);
      await this.restoreOrderAfterRefund(tx, orderId);
      await this.finalizeRefundTask(tx, {
        ...target,
        operatorId: user.id,
        provider,
      });
      return this.loadRefundedOrder(tx, orderId);
    });
    if (updated) this.publishRefundCompleted(updated);
  }

  /** 按支付状态与渠道分流拒单：余额原路退款 / 退款任务 / 直接关闭。 */
  private async dispatchRejectFlow(
    context: MerchantRejectContext,
  ): Promise<void> {
    const order = await this.findRejectableOrder(context);
    if (!order) throw new NotFoundException('扫码点餐订单不存在');
    if (order.paymentStatus !== 'paid') {
      await this.rejectUnpaidOrder(context);
      return;
    }
    const attempt = order.paymentAttempts[0] ?? null;
    const isProduction =
      this.configService.get<string>('nodeEnv') === 'production';
    if (attempt?.paymentChannel === 'marketing_balance' || !isProduction) {
      await this.refundMarketingBalanceOrder(context);
      return;
    }
    await this.initiateRefundFlow({
      ...context,
      paidAmount: order.paidAmount,
      paymentAttempt: attempt,
    });
  }

  /** 营销余额订单原路退款：委托余额退款服务并推送完成事件。 */
  private async refundMarketingBalanceOrder(
    context: MerchantRejectContext,
  ): Promise<void> {
    const { user, ...input } = context;
    const updated = await this.balanceRefundService.refund(input, user.id);
    this.publishRefundCompleted(updated);
  }

  /** 普通支付订单发起拒单退款：置退款中、记录历史、创建退款任务并推送。 */
  private async initiateRefundFlow(
    input: MerchantRefundFlowContext,
  ): Promise<void> {
    await this.markOrderRefunding(input);
    await this.createMerchantRefundTask(input);
    await this.publishOrderStatusAfterChange(input.orderId);
  }

  /** 拒绝未支付订单：置关闭状态、记录历史并推送。 */
  private async rejectUnpaidOrder(
    context: MerchantRejectContext,
  ): Promise<void> {
    const result = await this.prisma.scanOrders.updateMany({
      where: this.pendingAcceptanceWhere(context),
      data: {
        status: ScanOrderStatus.rejected,
        fulfillmentStatus: ScanOrderFulfillmentStatus.closed,
        version: { increment: 1 },
        rejectReason: context.reason,
      },
    });
    if (result.count === 0)
      throw new ConflictException('订单状态已变化，请刷新后重试');
    await this.createOrderStatusHistory({
      orderId: context.orderId,
      storeId: context.storeId,
      version: context.version,
      fromStatus: ScanOrderStatus.pending_acceptance,
      toStatus: ScanOrderStatus.rejected,
      reason: context.reason,
    });
    await this.publishOrderStatusAfterChange(context.orderId);
  }

  /** 乐观锁置订单为退款中并记录状态历史，冲突时抛异常。 */
  private async markOrderRefunding(
    input: RefundTransitionTarget,
  ): Promise<void> {
    const result = await this.prisma.scanOrders.updateMany({
      where: this.pendingAcceptanceWhere(input),
      data: {
        status: ScanOrderStatus.refunding,
        paymentStatus: 'refunding',
        rejectReason: input.reason,
        version: { increment: 1 },
      },
    });
    if (result.count === 0)
      throw new ConflictException('订单状态已变化，请刷新后重试');
    await this.createOrderStatusHistory({
      orderId: input.orderId,
      storeId: input.storeId,
      version: input.version,
      fromStatus: ScanOrderStatus.pending_acceptance,
      toStatus: ScanOrderStatus.refunding,
      reason: input.reason,
    });
  }

  /** 创建商家拒单退款任务。 */
  private async createMerchantRefundTask(
    input: MerchantRefundFlowContext,
  ): Promise<void> {
    const attempt = input.paymentAttempt;
    await this.refundService.createRefundTask({
      orderId: input.orderId,
      storeId: input.storeId,
      paymentAttemptId: attempt?.id ?? null,
      triggerType: 'merchant_reject',
      refundAmount: input.paidAmount,
      merchantPaymentNo: attempt?.merchantPaymentNo ?? null,
      providerTransactionId: attempt?.providerTransactionId ?? null,
      operatorType: 'merchant',
      operatorId: input.user.id,
      failureReason: `商家拒单：${input.reason}`,
    });
  }

  /** 查询订单最新状态并推送状态变更事件。 */
  private async publishOrderStatusAfterChange(orderId: number): Promise<void> {
    const order = await this.prisma.scanOrders.findUnique({
      where: { id: orderId },
      select: ORDER_STATUS_SELECT,
    });
    if (order) this.publishOrderStatusChanged(order);
  }

  /** 事务内乐观锁更新订单为拒绝/已退款，冲突时给出幂等或状态变更提示。 */
  private async markRefundCompleted(
    tx: Prisma.TransactionClient,
    input: RefundOrderTarget,
  ): Promise<void> {
    const result = await tx.scanOrders.updateMany({
      where: {
        id: input.orderId,
        storeId: input.storeId,
        version: input.version,
        status: ScanOrderStatus.refunding,
        paymentStatus: ScanOrderPaymentStatus.refunding,
      },
      data: {
        status: ScanOrderStatus.rejected,
        paymentStatus: ScanOrderPaymentStatus.refunded,
        fulfillmentStatus: ScanOrderFulfillmentStatus.closed,
        version: { increment: 1 },
      },
    });
    if (result.count !== 0) return;
    const existing = await tx.scanOrders.findFirst({
      where: { id: input.orderId, storeId: input.storeId },
      select: { id: true, status: true, paymentStatus: true },
    });
    if (!existing) throw new NotFoundException('扫码点餐订单不存在');
    if (
      existing.status === ScanOrderStatus.rejected &&
      existing.paymentStatus === ScanOrderPaymentStatus.refunded
    ) {
      throw new ConflictException('订单退款已完成，请勿重复操作');
    }
    throw new ConflictException('订单状态已变化，请刷新后重试');
  }

  /** 事务内归还库存、冲销销售单并关闭支付尝试与优惠券占用。 */
  private async restoreOrderAfterRefund(
    tx: Prisma.TransactionClient,
    orderId: number,
  ): Promise<void> {
    await this.stockRestoreService.restoreReservedStock(tx, orderId);
    await this.stockRestoreService.refundSaleOrder(tx, orderId);
    await tx.scanOrderPaymentAttempt.updateMany({
      where: { orderId, status: ScanOrderPaymentAttemptStatus.succeeded },
      data: { status: ScanOrderPaymentAttemptStatus.refunded },
    });
    await tx.scanOrderCouponUsage.updateMany({
      where: {
        orderId,
        status: {
          in: [
            ScanOrderCouponUsageStatus.locked,
            ScanOrderCouponUsageStatus.consumed,
          ],
        },
      },
      data: { status: ScanOrderCouponUsageStatus.refunded },
    });
  }

  /** 事务内标记退款任务成功并写入状态历史。 */
  private async finalizeRefundTask(
    tx: Prisma.TransactionClient,
    input: RefundFinalizeInput,
  ): Promise<void> {
    await this.refundService.markRefundTaskSucceededInTransaction(tx, {
      orderId: input.orderId,
      providerRefundNo: input.provider?.refundNo ?? null,
      providerRefundId: input.provider?.refundId ?? null,
    });
    await this.createOrderStatusHistory({
      orderId: input.orderId,
      storeId: input.storeId,
      version: input.version,
      fromStatus: ScanOrderStatus.refunding,
      toStatus: ScanOrderStatus.rejected,
      operatorId: input.operatorId,
      reason: '退款完成，订单已关闭',
    });
  }

  /** 查询退款完成后的订单快照（用于实时推送）。 */
  private loadRefundedOrder(
    tx: Prisma.TransactionClient,
    orderId: number,
  ): Promise<RefundedOrderSnapshot | null> {
    return tx.scanOrders.findUnique({
      where: { id: orderId },
      select: {
        ...ORDER_STATUS_SELECT,
        pickupNumber: true,
        refundTasks: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            refundSucceededAt: true,
            processedAt: true,
            triggeredAt: true,
          },
        },
      },
    });
  }

  /** 推送退款完成事件（含取餐号与退款完成时间）。 */
  private publishRefundCompleted(updated: RefundedOrderSnapshot): void {
    this.realtimeService.publishOrderStatusChanged({
      orderId: updated.id,
      storeId: updated.storeId,
      sessionId: updated.sessionId,
      status: updated.status,
      paymentStatus: updated.paymentStatus,
      fulfillmentStatus: updated.fulfillmentStatus,
      pickupNumber: updated.pickupNumber,
      pickupNumberLabel:
        updated.pickupNumber == null
          ? null
          : String(updated.pickupNumber).padStart(3, '0'),
      refundSucceededAt:
        updated.refundTasks[0]?.refundSucceededAt?.toISOString() ??
        updated.refundTasks[0]?.processedAt?.toISOString() ??
        updated.refundTasks[0]?.triggeredAt?.toISOString() ??
        null,
    });
  }

  /** 推送简单状态变更事件。 */
  private publishOrderStatusChanged(order: OrderStatusSnapshot): void {
    this.realtimeService.publishOrderStatusChanged({
      orderId: order.id,
      storeId: order.storeId,
      sessionId: order.sessionId,
      status: order.status,
      paymentStatus: order.paymentStatus,
      fulfillmentStatus: order.fulfillmentStatus,
    });
  }

  /** 查询待拒单订单（含最近一次成功支付尝试）。 */
  private findRejectableOrder(context: MerchantRejectContext) {
    return this.prisma.scanOrders.findFirst({
      where: { id: context.orderId, storeId: context.storeId },
      select: {
        id: true,
        paymentStatus: true,
        paidAmount: true,
        paymentAttempts: {
          where: { status: 'succeeded' },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            paymentChannel: true,
            merchantPaymentNo: true,
            providerTransactionId: true,
          },
        },
      },
    });
  }

  /** 待接单订单乐观锁查询条件。 */
  private pendingAcceptanceWhere(input: RefundOrderTarget) {
    return {
      id: input.orderId,
      storeId: input.storeId,
      version: input.version,
      status: ScanOrderStatus.pending_acceptance,
    };
  }

  /** 解析当前商家门店并校验拒单退款权限。 */
  private resolveRefundStoreId(user: AuthenticatedUser): Promise<number> {
    return this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      'scan-ordering:order-process',
      '无权操作扫码点餐订单',
    );
  }

  /** 写入商家操作订单状态历史。 */
  private createOrderStatusHistory(
    input: OrderStatusHistoryInput,
  ): Promise<unknown> {
    return this.prisma.scanOrderStatusHistory.create({
      data: {
        ...input,
        operatorType: 'merchant',
      },
    });
  }
}

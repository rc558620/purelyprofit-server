import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ScanOrderCouponUsageStatus,
  ScanOrderFulfillmentStatus,
  ScanOrderPaymentAttemptStatus,
  ScanOrderPaymentStatus,
  ScanOrderStatus,
  type Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { ScanOrderingRefundService } from '../../../purely-club/scan-ordering/scan-ordering-refund.service';
import { ScanOrderingRefundStockRestoreService } from './scan-ordering-refund-stock-restore.service';
import { ScanOrderingRefundRealtimeService } from './scan-ordering-refund-realtime.service';
import type {
  OrderStatusHistoryInput,
  RefundFinalizeInput,
  RefundOrderTarget,
  RefundTransitionTarget,
  RefundedOrderSnapshot,
} from './scan-ordering-refund.types';

/**
 * 扫码点餐退款订单状态流转服务。
 *
 * 收敛订单乐观锁状态流转（置退款中 / 置已退款）、库存与销售冲销、
 * 退款任务收尾与状态历史写入，供商家确认、系统超时与微信重试共用。
 */
@Injectable()
export class ScanOrderingRefundTransitionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly refundService: ScanOrderingRefundService,
    private readonly stockRestoreService: ScanOrderingRefundStockRestoreService,
    private readonly realtimeService: ScanOrderingRefundRealtimeService,
  ) {}

  /**
   * 事务内完成退款闭环：置已退款 → 归还库存并冲销销售单 →
   * 标记退款任务成功并写状态历史 → 返回推送快照。
   */
  async completeRefund(
    tx: Prisma.TransactionClient,
    input: RefundFinalizeInput,
  ): Promise<RefundedOrderSnapshot | null> {
    await this.markRefundCompleted(tx, input);
    await this.restoreOrderAfterRefund(tx, input.orderId);
    await this.finalizeRefundTask(tx, input);
    return this.realtimeService.loadRefundedOrder(tx, input.orderId);
  }

  /** 乐观锁置订单为退款中并记录状态历史，冲突时抛异常。
   * @param fromStatus 订单当前状态（商家拒单为 pending_acceptance，系统超时可传 preparing）。 */
  async markOrderRefunding(
    input: RefundTransitionTarget,
    fromStatus: ScanOrderStatus = ScanOrderStatus.pending_acceptance,
  ): Promise<void> {
    const result = await this.prisma.scanOrders.updateMany({
      where: this.pendingAcceptanceWhere(input, fromStatus),
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
      fromStatus,
      toStatus: ScanOrderStatus.refunding,
      reason: input.reason,
    });
  }

  /** 事务内写入操作订单状态历史。
   * @param operatorType 操作类型：merchant=商家 / system=系统超时自动退款 */
  createOrderStatusHistoryInTransaction(
    tx: Prisma.TransactionClient,
    input: OrderStatusHistoryInput,
    operatorType = 'merchant',
  ): Promise<unknown> {
    // version 仅用于乐观锁校验，ScanOrderStatusHistory 无该字段，写入前剥离
    const { version: _version, ...historyInput } = input;
    return tx.scanOrderStatusHistory.create({
      data: {
        ...historyInput,
        operatorType,
      },
    });
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
    await this.createOrderStatusHistoryInTransaction(
      tx,
      {
        orderId: input.orderId,
        storeId: input.storeId,
        version: input.version,
        fromStatus: ScanOrderStatus.refunding,
        toStatus: ScanOrderStatus.rejected,
        operatorId: input.operatorId,
        reason: '退款完成，订单已关闭',
      },
      input.operatorType ?? 'merchant',
    );
  }

  /** 待接单订单乐观锁查询条件（fromStatus 支持系统超时的 preparing 场景）。 */
  private pendingAcceptanceWhere(
    input: RefundOrderTarget,
    fromStatus: ScanOrderStatus = ScanOrderStatus.pending_acceptance,
  ) {
    return {
      id: input.orderId,
      storeId: input.storeId,
      version: input.version,
      status: fromStatus,
    };
  }

  /** 写入操作订单状态历史。
   * @param operatorType 操作类型：merchant=商家 / system=系统超时自动退款 */
  private createOrderStatusHistory(
    input: OrderStatusHistoryInput,
    operatorType = 'merchant',
  ): Promise<unknown> {
    // version 仅用于乐观锁校验，ScanOrderStatusHistory 无该字段，写入前剥离
    const { version: _version, ...historyInput } = input;
    return this.prisma.scanOrderStatusHistory.create({
      data: {
        ...historyInput,
        operatorType,
      },
    });
  }
}

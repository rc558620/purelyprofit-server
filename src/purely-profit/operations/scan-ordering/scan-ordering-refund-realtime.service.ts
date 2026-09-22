import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { ScanOrderingRealtimeService } from '../../../purely-club/scan-ordering/scan-ordering-realtime.service';
import { ORDER_STATUS_SELECT } from './scan-ordering-refund.types';
import type {
  OrderStatusSnapshot,
  RefundedOrderSnapshot,
} from './scan-ordering-refund.types';

/**
 * 扫码点餐退款实时推送服务。
 *
 * 收敛订单快照查询与实时事件推送（状态变更 / 退款完成），
 * 供退款处理、商家拒单、微信自动退款等流程复用。
 */
@Injectable()
export class ScanOrderingRefundRealtimeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtimeService: ScanOrderingRealtimeService,
  ) {}

  /** 查询订单最新状态并推送状态变更事件。 */
  async publishOrderStatusAfterChange(orderId: number): Promise<void> {
    const order = await this.prisma.scanOrders.findUnique({
      where: { id: orderId },
      select: ORDER_STATUS_SELECT,
    });
    if (order) this.publishOrderStatusChanged(order);
  }

  /** 查询退款完成后的订单快照（用于实时推送）。 */
  loadRefundedOrder(
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
  publishRefundCompleted(updated: RefundedOrderSnapshot): void {
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
  publishOrderStatusChanged(order: OrderStatusSnapshot): void {
    this.realtimeService.publishOrderStatusChanged({
      orderId: order.id,
      storeId: order.storeId,
      sessionId: order.sessionId,
      status: order.status,
      paymentStatus: order.paymentStatus,
      fulfillmentStatus: order.fulfillmentStatus,
    });
  }
}

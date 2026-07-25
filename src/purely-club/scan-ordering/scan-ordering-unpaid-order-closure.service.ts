import { Injectable } from '@nestjs/common';
import {
  Prisma,
  ScanOrderPaymentAttemptStatus,
  ScanOrderStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ScanOrderingRealtimeService } from './scan-ordering-realtime.service';

export interface CloseUnpaidScanOrderInput {
  orderId: number;
  expectedVersion?: number;
  operatorType: string;
  operatorId?: number;
  reason: string;
}

export interface ClosedUnpaidScanOrder {
  orderId: number;
  storeId: number;
  sessionId: number | null;
  status: 'cancelled';
  paymentStatus: 'unpaid';
  fulfillmentStatus: 'closed';
}

@Injectable()
export class ScanOrderingUnpaidOrderClosureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtimeService: ScanOrderingRealtimeService,
  ) {}

  async close(
    input: CloseUnpaidScanOrderInput,
  ): Promise<ClosedUnpaidScanOrder | null> {
    const closed = await this.prisma.$transaction((tx) =>
      this.closeInTransaction(tx, input),
    );
    if (closed) {
      this.realtimeService.publishOrderStatusChanged(closed);
    }
    return closed;
  }

  async closeInTransaction(
    tx: Prisma.TransactionClient,
    input: CloseUnpaidScanOrderInput,
  ): Promise<ClosedUnpaidScanOrder | null> {
    const order = await tx.scanOrders.findUnique({
      where: { id: input.orderId },
      select: { id: true, storeId: true, sessionId: true, version: true },
    });
    if (!order) return null;

    const updated = await tx.scanOrders.updateMany({
      where: {
        id: order.id,
        version: input.expectedVersion ?? order.version,
        status: ScanOrderStatus.pending_payment,
        paymentStatus: 'unpaid',
      },
      data: {
        status: ScanOrderStatus.cancelled,
        fulfillmentStatus: 'closed',
        cancelledAt: new Date(),
        cancelReason: input.reason,
        version: { increment: 1 },
      },
    });
    if (updated.count === 0) return null;

    const items = await tx.scanOrderItem.findMany({
      where: { orderId: order.id },
      select: {
        menuProductId: true,
        quantity: true,
        specs: { select: { specOptionId: true } },
      },
    });
    await this.restoreProductStock(tx, order.storeId, items);
    await this.restoreSpecStock(tx, items);
    await tx.scanOrderPaymentAttempt.updateMany({
      where: {
        orderId: order.id,
        status: {
          in: [
            ScanOrderPaymentAttemptStatus.created,
            ScanOrderPaymentAttemptStatus.paying,
          ],
        },
      },
      data: { status: ScanOrderPaymentAttemptStatus.closed },
    });
    await tx.scanOrderCouponUsage.updateMany({
      where: { orderId: order.id, status: 'locked' },
      data: { status: 'released', releasedAt: new Date() },
    });
    await tx.scanOrderStatusHistory.create({
      data: {
        orderId: order.id,
        storeId: order.storeId,
        fromStatus: ScanOrderStatus.pending_payment,
        toStatus: ScanOrderStatus.cancelled,
        operatorType: input.operatorType,
        operatorId: input.operatorId,
        reason: input.reason,
      },
    });
    return {
      orderId: order.id,
      storeId: order.storeId,
      sessionId: order.sessionId,
      status: ScanOrderStatus.cancelled,
      paymentStatus: 'unpaid',
      fulfillmentStatus: 'closed',
    };
  }

  private async restoreProductStock(
    tx: Prisma.TransactionClient,
    storeId: number,
    items: Array<{ menuProductId: number; quantity: number }>,
  ): Promise<void> {
    await Promise.all(
      items.map((item) =>
        tx.scanOrderingMenuProduct.updateMany({
          where: { id: item.menuProductId, storeId, stockMode: 'finite' },
          data: {
            stockQuantity: { increment: item.quantity },
            salesCount: { decrement: item.quantity },
            version: { increment: 1 },
          },
        }),
      ),
    );
  }

  private async restoreSpecStock(
    tx: Prisma.TransactionClient,
    items: Array<{
      quantity: number;
      specs: Array<{ specOptionId: number }>;
    }>,
  ): Promise<void> {
    const quantities = new Map<number, number>();
    for (const item of items) {
      for (const spec of item.specs) {
        quantities.set(
          spec.specOptionId,
          (quantities.get(spec.specOptionId) ?? 0) + item.quantity,
        );
      }
    }
    await Promise.all(
      Array.from(quantities.entries()).map(([id, quantity]) =>
        tx.scanOrderingSpecOption.updateMany({
          where: { id, stockQuantity: { not: null } },
          data: {
            stockQuantity: { increment: quantity },
            version: { increment: 1 },
          },
        }),
      ),
    );
  }
}

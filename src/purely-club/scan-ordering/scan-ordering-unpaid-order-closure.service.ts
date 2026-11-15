import { Injectable } from '@nestjs/common';
import {
  Prisma,
  ScanOrderPaymentAttemptStatus,
  ScanOrderStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ScanOrderingRealtimeService } from './scan-ordering-realtime.service';
import {
  aggregateStockRelease,
  applyStockRelease,
} from './scan-ordering-stock-release.helper';

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

    await this.restoreReservedStockInTransaction(tx, order.id);
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

  async restoreReservedStockInTransaction(
    tx: Prisma.TransactionClient,
    orderId: number,
  ): Promise<void> {
    const order = await tx.scanOrders.findUniqueOrThrow({
      where: { id: orderId },
      select: { storeId: true },
    });
    const items = await tx.scanOrderItem.findMany({
      where: { orderId },
      select: {
        menuProductId: true,
        quantity: true,
        menuProduct: { select: { productId: true } },
        specs: { select: { specOptionId: true } },
      },
    });
    const plan = aggregateStockRelease(
      items.map((item) => ({
        menuProductId: item.menuProductId,
        quantity: item.quantity,
        productId: item.menuProduct.productId,
        specOptionIds: item.specs.map((spec) => spec.specOptionId),
      })),
    );
    await applyStockRelease(tx, order.storeId, plan);
  }
}

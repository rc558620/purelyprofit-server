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
        menuProduct: { select: { productId: true, stockMode: true } },
        specs: { select: { specOptionId: true } },
      },
    });
    await this.releaseProductStock(tx, order.storeId, items);
    await this.releaseSpecStock(tx, items);
  }

  /**
   * 释放菜单商品预留：新订单（有预留记录）只释放 reservedQuantity；
   * 历史订单（无预留记录，下单时已按旧逻辑扣减）则恢复已扣减库存。
   */
  private async releaseProductStock(
    tx: Prisma.TransactionClient,
    storeId: number,
    items: Array<{
      menuProductId: number;
      quantity: number;
      menuProduct: {
        productId: number | null;
        stockMode: 'unlimited' | 'finite' | 'sold_out';
      };
    }>,
  ): Promise<void> {
    await Promise.all(
      items.map(async (item) => {
        // 新订单：释放预留量（不恢复 stockQuantity/salesCount，因从未扣减）
        const released = await tx.scanOrderingMenuProduct.updateMany({
          where: {
            id: item.menuProductId,
            storeId,
            reservedQuantity: { gte: item.quantity },
          },
          data: {
            reservedQuantity: { decrement: item.quantity },
            version: { increment: 1 },
          },
        });
        if (released.count !== 0) return;

        // 历史订单或已接单订单：恢复已扣减库存
        await tx.scanOrderingMenuProduct.updateMany({
          where: { id: item.menuProductId, storeId, stockMode: 'finite' },
          data: {
            stockQuantity: { increment: item.quantity },
            salesCount: { decrement: item.quantity },
            version: { increment: 1 },
          },
        });
        if (item.menuProduct.productId !== null) {
          await tx.product.updateMany({
            where: {
              id: item.menuProduct.productId,
              storeId,
              deletedAt: null,
            },
            data: { stock: { increment: item.quantity } },
          });
        }
      }),
    );
  }

  /** 释放规格预留：新订单释放预留量，历史/已接单订单恢复已扣减库存。 */
  private async releaseSpecStock(
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
      Array.from(quantities.entries()).map(async ([id, quantity]) => {
        const released = await tx.scanOrderingSpecOption.updateMany({
          where: { id, reservedQuantity: { gte: quantity } },
          data: {
            reservedQuantity: { decrement: quantity },
            version: { increment: 1 },
          },
        });
        if (released.count !== 0) return;
        await tx.scanOrderingSpecOption.updateMany({
          where: { id, stockQuantity: { not: null } },
          data: {
            stockQuantity: { increment: quantity },
            version: { increment: 1 },
          },
        });
      }),
    );
  }
}

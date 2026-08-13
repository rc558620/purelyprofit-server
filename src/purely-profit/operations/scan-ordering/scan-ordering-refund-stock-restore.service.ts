import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { SalesRecordRefundService } from '../sales-record/sales-record-refund.service';

/**
 * 扫码点餐退款库存与销售记录恢复服务。
 *
 * 普通支付退款（ScanOrderingOrderRefundHandlingService）与营销余额退款
 * （ScanOrderingOrderRefundBalanceService）共用同一套库存归还与销售冲销逻辑，
 * 由本服务统一收敛，避免两个退款服务各自维护一份重复实现。
 */
@Injectable()
export class ScanOrderingRefundStockRestoreService {
  constructor(
    private readonly salesRecordRefundService: SalesRecordRefundService,
  ) {}

  /** 退款时归还预留库存：菜单商品、共用 Product.stock 与规格库存。 */
  async restoreReservedStock(
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
    await Promise.all(
      items.map(async (item) => {
        await tx.scanOrderingMenuProduct.updateMany({
          where: {
            id: item.menuProductId,
            storeId: order.storeId,
            stockMode: 'finite',
          },
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
              storeId: order.storeId,
              deletedAt: null,
            },
            data: { stock: { increment: item.quantity } },
          });
        }
      }),
    );
    const specQuantities = new Map<number, number>();
    for (const item of items) {
      for (const spec of item.specs) {
        specQuantities.set(
          spec.specOptionId,
          (specQuantities.get(spec.specOptionId) ?? 0) + item.quantity,
        );
      }
    }
    await Promise.all(
      Array.from(specQuantities.entries()).map(([id, quantity]) =>
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

  /** 退款时冲销标准销售单（销售退款记录与财务流水）。 */
  async refundSaleOrder(
    tx: Prisma.TransactionClient,
    orderId: number,
  ): Promise<void> {
    const saleOrder = await tx.saleOrder.findUnique({
      where: { scanOrderId: orderId },
      select: { id: true },
    });
    if (!saleOrder) return;
    await this.salesRecordRefundService.refundInTransaction(tx, {
      saleOrderId: saleOrder.id,
      refundedAt: new Date(),
    });
  }
}

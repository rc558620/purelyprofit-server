import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { SalesRecordRefundService } from '../sales-record/sales-record-refund.service';
import { ScanOrderingSaleOrderBridgeService } from '../../../purely-club/scan-ordering/scan-ordering-sale-order-bridge.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';

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
    private readonly saleOrderBridgeService: ScanOrderingSaleOrderBridgeService,
  ) {}

  /**
   * 退款/拒单时释放预留库存：
   * - 新订单（未接单被拒）：仅释放 reservedQuantity（下单时未扣减实际库存）；
   * - 已接单订单或历史订单：恢复已扣减的菜单商品库存、共用 Product.stock 与规格库存。
   * 由预留量是否充足自动区分两种路径，保证不重复释放/恢复。
   */
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
        menuProduct: {
          select: { productId: true, stockMode: true },
        },
        specs: { select: { specOptionId: true } },
      },
    });
    await Promise.all(
      items.map(async (item) => {
        // 新订单：仅释放预留量（下单时未扣减 stockQuantity/salesCount）
        const released = await tx.scanOrderingMenuProduct.updateMany({
          where: {
            id: item.menuProductId,
            storeId: order.storeId,
            reservedQuantity: { gte: item.quantity },
          },
          data: {
            reservedQuantity: { decrement: item.quantity },
            version: { increment: 1 },
          },
        });
        if (released.count !== 0) return;

        // 已接单/历史订单：恢复已扣减库存
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
      Array.from(specQuantities.entries()).map(async ([id, quantity]) => {
        // 新订单：释放规格预留量
        const released = await tx.scanOrderingSpecOption.updateMany({
          where: { id, reservedQuantity: { gte: quantity } },
          data: {
            reservedQuantity: { decrement: quantity },
            version: { increment: 1 },
          },
        });
        if (released.count !== 0) return;
        // 已接单/历史订单：恢复已扣减规格库存
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

  /** 退款时冲销标准销售单（销售退款记录与财务流水）。
   * 若 SaleOrder 尚未创建（订单在出餐前被拒绝），先创建再退款。
   * operator：拒绝操作的商家账号，用于销售单记录操作员。 */
  async refundSaleOrder(
    tx: Prisma.TransactionClient,
    orderId: number,
    operator: AuthenticatedUser | null = null,
  ): Promise<void> {
    const saleOrder = await tx.saleOrder.findUnique({
      where: { scanOrderId: orderId },
      select: { id: true },
    });
    if (saleOrder) {
      await this.salesRecordRefundService.refundInTransaction(tx, {
        saleOrderId: saleOrder.id,
        refundedAt: new Date(),
      });
      return;
    }
    // 无 SaleOrder：订单出餐前被拒绝 —— 先创建销售记录再退款
    const order = await tx.scanOrders.findUnique({
      where: { id: orderId },
      select: {
        paymentAttempts: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { paymentChannel: true },
        },
      },
    });
    const paymentMethod =
      order?.paymentAttempts[0]?.paymentChannel === 'wechat'
        ? ('wechat' as const)
        : ('other' as const);
    await this.saleOrderBridgeService.createForPaidOrder(
      tx,
      orderId,
      paymentMethod,
      operator ?? undefined,
    );
    const created = await tx.saleOrder.findUnique({
      where: { scanOrderId: orderId },
      select: { id: true },
    });
    if (!created) return; // 安全兜底（不应发生）
    await this.salesRecordRefundService.refundInTransaction(tx, {
      saleOrderId: created.id,
      refundedAt: new Date(),
    });
  }
}

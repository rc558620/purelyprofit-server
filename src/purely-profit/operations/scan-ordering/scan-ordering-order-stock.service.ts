import { ConflictException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

/**
 * 扫码点餐接单库存扣减服务。
 *
 * 库存只在商家接单时扣减，取消/拒单时释放预留（见 ScanOrderingRefundStockRestoreService），
 * 出餐与退款不再重复操作库存。本服务由状态转换引擎在接单事务内调用。
 */
@Injectable()
export class ScanOrderingOrderStockService {
  /**
   * 事务内确认扣减预留库存（接单专用）：
   * - 菜单商品：reservedQuantity 扣减、stockQuantity 扣减、salesCount 累计；
   * - 关联共用商品（productId 非空）：此时才扣减 product.stock；
   * - 规格选项：reservedQuantity 转扣减、stockQuantity 扣减。
   * 历史订单（无预留记录）跳过扣减，避免重复扣库存。
   */
  async confirmDeductionInTransaction(
    tx: Prisma.TransactionClient,
    storeId: number,
    orderId: number,
  ): Promise<void> {
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
        // 菜单商品：仅当存在预留时才扣减（新订单），历史订单（reserved=0）跳过
        const menuUpdated = await tx.scanOrderingMenuProduct.updateMany({
          where: {
            id: item.menuProductId,
            storeId,
            reservedQuantity: { gte: item.quantity },
          },
          data: {
            reservedQuantity: { decrement: item.quantity },
            ...(item.menuProduct.stockMode === 'finite'
              ? { stockQuantity: { decrement: item.quantity } }
              : {}),
            salesCount: { increment: item.quantity },
            version: { increment: 1 },
          },
        });
        if (menuUpdated.count === 0) return;

        // 共用商品库存：仅在接单时扣减（Q1 决策），不足时阻止接单
        if (item.menuProduct.productId !== null) {
          const productUpdated = await tx.product.updateMany({
            where: {
              id: item.menuProduct.productId,
              storeId,
              deletedAt: null,
              stock: { gte: item.quantity },
            },
            data: { stock: { decrement: item.quantity } },
          });
          if (productUpdated.count === 0) {
            throw new ConflictException('商品库存不足，无法接单');
          }
        }
      }),
    );

    await this.deductSpecReservedStock(tx, items);
  }

  /** 规格预留转扣减（仅当存在预留时）：按规格选项聚合数量后一次性扣减。 */
  private async deductSpecReservedStock(
    tx: Prisma.TransactionClient,
    items: Array<{
      quantity: number;
      specs: Array<{ specOptionId: number }>;
    }>,
  ): Promise<void> {
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
      Array.from(specQuantities.entries()).map(
        async ([specOptionId, quantity]) => {
          await tx.scanOrderingSpecOption.updateMany({
            where: {
              id: specOptionId,
              reservedQuantity: { gte: quantity },
            },
            data: {
              reservedQuantity: { decrement: quantity },
              stockQuantity: { decrement: quantity },
              version: { increment: 1 },
            },
          });
        },
      ),
    );
  }
}

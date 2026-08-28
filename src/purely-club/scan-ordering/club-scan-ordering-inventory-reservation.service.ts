import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * 扫码点餐库存预留服务
 *
 * 职责：
 * - 菜单商品库存批量读取与聚合预留
 * - 共享商品库存（product.stock）与菜单商品库存（menuProduct.stockQuantity）的统一处理
 * - 保证同一订单内重复商品只预留一次
 */
@Injectable()
export class ClubScanOrderingInventoryReservationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 为订单项预留菜单商品库存（按 productId 聚合后一次性预留）。
   *
   * 处理逻辑：
   * 1. 按 productId 聚合数量（同一商品多行合并为一行）
   * 2. 批量读取菜单商品与共享商品库存
   * 3. 按商品逐项校验可用库存并乐观锁预留
   * 4. 失败时整体回滚，确保不超卖
   */
  async reserveMenuProductStock(
    tx: Prisma.TransactionClient,
    items: Array<{
      productId: number;
      inventoryProductId: number | null;
      quantity: number;
    }>,
    storeId: number,
  ): Promise<void> {
    const groupedItems = new Map<
      number,
      {
        productId: number;
        inventoryProductId: number | null;
        quantity: number;
      }
    >();
    for (const item of items) {
      const existing = groupedItems.get(item.productId);
      if (existing) {
        existing.quantity += item.quantity;
        continue;
      }
      groupedItems.set(item.productId, {
        productId: item.productId,
        inventoryProductId: item.inventoryProductId,
        quantity: item.quantity,
      });
    }

    const productIds = [...groupedItems.keys()];
    const currentProducts = await tx.scanOrderingMenuProduct.findMany({
      where: { id: { in: productIds }, storeId, deletedAt: null },
      select: {
        id: true,
        stockMode: true,
        stockQuantity: true,
        reservedQuantity: true,
        version: true,
        productId: true,
      },
    });
    const productMap = new Map(
      currentProducts.map((product) => [product.id, product]),
    );
    const inventoryIds = [
      ...new Set(
        currentProducts
          .map((product) => product.productId)
          .filter((id): id is number => id !== null),
      ),
    ];
    const inventoryProducts = await tx.product.findMany({
      where: { id: { in: inventoryIds }, storeId, deletedAt: null },
      select: { id: true, stock: true },
    });
    const inventoryMap = new Map(
      inventoryProducts.map((product) => [product.id, product.stock]),
    );
    for (const item of groupedItems.values()) {
      const current = productMap.get(item.productId);
      if (!current) throw new ConflictException('商品库存不足');
      const baseStock = current.productId
        ? (inventoryMap.get(current.productId) ?? 0)
        : (current.stockQuantity ?? 0);
      const availableStock = baseStock - current.reservedQuantity;
      if (current.stockMode !== 'unlimited' && availableStock < item.quantity) {
        throw new ConflictException('商品库存不足');
      }
      const updated = await tx.scanOrderingMenuProduct.updateMany({
        where: {
          id: item.productId,
          storeId,
          isActive: true,
          deletedAt: null,
          version: current.version,
        },
        data: {
          reservedQuantity: { increment: item.quantity },
          version: { increment: 1 },
        },
      });
      if (updated.count === 0) throw new ConflictException('商品库存不足');
    }
  }
}

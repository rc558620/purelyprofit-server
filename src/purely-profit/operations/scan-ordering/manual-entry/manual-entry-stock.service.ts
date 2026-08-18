// 录入订单库存预留服务：建单事务内对菜单商品与规格选项做预留（reservedQuantity increment），
// 与 C 端扫码点餐「两阶段库存预留」口径一致，接单时由状态机转扣减。

import { ConflictException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { ManualEntryPricedItem } from './manual-entry-pricing.service';

/**
 * 录入订单库存预留服务。
 *
 * 改为预留（reservedQuantity increment）而非直接扣减：
 * - 菜单商品：有限库存模式时校验可用库存 ≥ 数量，预留之并累计销量；
 * - 规格选项：有独立库存时校验并预留；
 * - 商品库（products.stock）：不预留，由接单时状态机统一扣减。
 * 拒单时由状态机释放预留。
 */
@Injectable()
export class ManualEntryStockService {
  /** 事务内校验并预留全部库存；任一步失败抛 ConflictException 由事务回滚。 */
  async reserveStock(
    tx: Prisma.TransactionClient,
    storeId: number,
    pricedItems: ManualEntryPricedItem[],
  ): Promise<void> {
    // 同商品多行合并数量；同规格选项跨行合并数量
    const productQuantities = new Map<number, number>();
    const specQuantities = new Map<number, number>();
    for (const item of pricedItems) {
      productQuantities.set(
        item.menuProductId,
        (productQuantities.get(item.menuProductId) ?? 0) + item.quantity,
      );
      for (const specOptionId of item.specOptionIds) {
        specQuantities.set(
          specOptionId,
          (specQuantities.get(specOptionId) ?? 0) + item.quantity,
        );
      }
    }

    for (const [menuProductId, quantity] of productQuantities) {
      await this.reserveMenuProductStock(tx, storeId, menuProductId, quantity);
    }
    for (const [specOptionId, quantity] of specQuantities) {
      await this.reserveSpecOptionStock(tx, specOptionId, quantity);
    }
    // 商品库（products.stock）在接单时由 confirmStockDeductionInTransaction 统一扣减
  }

  /** 菜单商品库存预留：有限库存时校验可用库存 → reservedQuantity 递增 → salesCount 累计。 */
  private async reserveMenuProductStock(
    tx: Prisma.TransactionClient,
    storeId: number,
    menuProductId: number,
    quantity: number,
  ): Promise<void> {
    const product = await tx.scanOrderingMenuProduct.findFirst({
      where: { id: menuProductId, storeId, deletedAt: null },
      select: {
        id: true,
        name: true,
        stockMode: true,
        stockQuantity: true,
        reservedQuantity: true,
        version: true,
      },
    });
    if (!product) {
      throw new ConflictException('菜单商品不存在或已删除，请刷新菜单');
    }
    if (product.stockMode === 'sold_out') {
      throw new ConflictException(`商品【${product.name}】已售罄`);
    }

    const needsStockCheck =
      product.stockMode === 'finite' && product.stockQuantity !== null;
    if (needsStockCheck) {
      const available =
        (product.stockQuantity ?? 0) - (product.reservedQuantity ?? 0);
      if (available < quantity) {
        throw new ConflictException(`商品【${product.name}】库存不足`);
      }
    }

    // 乐观锁：version 条件更新，并发时要求刷新重试
    // 有限库存：reservedQuantity increment + salesCount 累计
    // 无限库存：仅累计 salesCount
    const updated = await tx.scanOrderingMenuProduct.updateMany({
      where: needsStockCheck
        ? { id: product.id, version: product.version }
        : { id: product.id },
      data: {
        ...(needsStockCheck
          ? {
              reservedQuantity: { increment: quantity },
              version: { increment: 1 },
            }
          : {}),
        salesCount: { increment: quantity },
      },
    });
    if (updated.count === 0) {
      throw new ConflictException(
        `商品【${product.name}】库存已变化，请刷新后重试`,
      );
    }
  }

  /** 规格选项库存预留：有独立库存时校验并预留。 */
  private async reserveSpecOptionStock(
    tx: Prisma.TransactionClient,
    specOptionId: number,
    quantity: number,
  ): Promise<void> {
    const option = await tx.scanOrderingSpecOption.findUnique({
      where: { id: specOptionId },
      select: {
        id: true,
        name: true,
        stockQuantity: true,
        reservedQuantity: true,
        version: true,
      },
    });
    if (!option) {
      throw new ConflictException('规格选项不存在或已更新，请重新选择');
    }
    if (option.stockQuantity === null) return;

    const available = option.stockQuantity - (option.reservedQuantity ?? 0);
    if (available < quantity) {
      throw new ConflictException(`规格【${option.name}】库存不足`);
    }
    const updated = await tx.scanOrderingSpecOption.updateMany({
      where: { id: option.id, version: option.version },
      data: {
        reservedQuantity: { increment: quantity },
        version: { increment: 1 },
      },
    });
    if (updated.count === 0) {
      throw new ConflictException(
        `规格【${option.name}】库存已变化，请刷新后重试`,
      );
    }
  }
}

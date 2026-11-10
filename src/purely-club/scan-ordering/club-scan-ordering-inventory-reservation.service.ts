import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

interface ReservationItem {
  productId: number;
  inventoryProductId: number | null;
  quantity: number;
}

interface ReservationUpdate {
  id: number;
  version: number;
  quantity: number;
}

interface MenuProductStockRow {
  id: number;
  stockMode: string;
  stockQuantity: number | null;
  reservedQuantity: number;
  version: number;
  productId: number | null;
}

/** 同一订单内重复商品合并数量，保证每个菜单商品只预留一次 */
function groupItemsByProductId(
  items: ReservationItem[],
): Map<number, ReservationItem> {
  const grouped = new Map<number, ReservationItem>();
  for (const item of items) {
    const existing = grouped.get(item.productId);
    if (existing) {
      existing.quantity += item.quantity;
      continue;
    }
    grouped.set(item.productId, {
      productId: item.productId,
      inventoryProductId: item.inventoryProductId,
      quantity: item.quantity,
    });
  }
  return grouped;
}

/** 校验可用库存并收集乐观锁更新参数，此处不发起任何写操作 */
function buildReservationUpdates(
  groupedItems: Map<number, ReservationItem>,
  productMap: Map<number, MenuProductStockRow>,
  inventoryMap: Map<number, number>,
): ReservationUpdate[] {
  const updates: ReservationUpdate[] = [];
  for (const item of groupedItems.values()) {
    const current = productMap.get(item.productId);
    if (!current) {
      throw new ConflictException('商品库存不足');
    }
    const baseStock = current.productId
      ? (inventoryMap.get(current.productId) ?? 0)
      : (current.stockQuantity ?? 0);
    const availableStock = baseStock - current.reservedQuantity;
    if (current.stockMode !== 'unlimited' && availableStock < item.quantity) {
      throw new ConflictException('商品库存不足');
    }
    updates.push({
      id: item.productId,
      version: current.version,
      quantity: item.quantity,
    });
  }
  return updates;
}

/**
 * 一条 UPDATE ... FROM (VALUES) 完成 N 个商品的乐观锁预留。
 *
 * 原实现在事务内逐商品 updateMany：购物车 N 个商品就是 N 次 DB 往返，
 * 事务持有期间还会阻塞同店其他建单。合并后只 1 次往返，每条 delta 仍由
 * 数据库侧在行上做加法，与逐个 increment 的并发语义完全一致。
 *
 * WHERE 里依然带 storeId / isActive / deletedAt / version 前置条件：
 * 任一行被并发抢占时影响行数会少于预期，抛异常由调用方事务整体回滚，
 * 不会出现部分商品预留成功。
 *
 * 显式写 updated_at：绕过 Prisma 的 @updatedAt（raw SQL 不会自动维护），
 * 用 UTC 墙钟与 Prisma 写入口径保持一致（项目 SQL 时区规范 R1）。
 */
async function applyReservationUpdates(
  tx: Prisma.TransactionClient,
  storeId: number,
  updates: ReservationUpdate[],
): Promise<void> {
  if (updates.length === 0) {
    return;
  }

  const valueRows = Prisma.join(
    updates.map(
      (update) =>
        Prisma.sql`(${update.id}::int, ${update.version}::int, ${update.quantity}::int)`,
    ),
  );

  const affected = await tx.$executeRaw`
    UPDATE scan_ordering_menu_products AS m
    SET reserved_quantity = m.reserved_quantity + v.quantity,
        version = m.version + 1,
        updated_at = NOW() AT TIME ZONE 'UTC'
    FROM (VALUES ${valueRows}) AS v(id, expected_version, quantity)
    WHERE m.id = v.id
      AND m.store_id = ${storeId}
      AND m.is_active = true
      AND m.deleted_at IS NULL
      AND m.version = v.expected_version
  `;

  if (affected !== updates.length) {
    throw new ConflictException('商品库存不足');
  }
}

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
   * 2. 批量读取菜单商品与共享商品库存（固定 2 次往返）
   * 3. 校验可用库存，收集乐观锁更新参数
   * 4. 一次批量 UPDATE 完成预留，失败时由调用方事务整体回滚
   */
  async reserveMenuProductStock(
    tx: Prisma.TransactionClient,
    items: ReservationItem[],
    storeId: number,
  ): Promise<void> {
    const groupedItems = groupItemsByProductId(items);
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
    const productMap = new Map<number, MenuProductStockRow>(
      currentProducts.map((product) => [product.id, product] as const),
    );

    const inventoryIds = [
      ...new Set(
        currentProducts
          .map((product) => product.productId)
          .filter((id): id is number => id !== null),
      ),
    ];
    const inventoryProducts: Array<{ id: number; stock: number }> =
      inventoryIds.length > 0
        ? await tx.product.findMany({
            where: { id: { in: inventoryIds }, storeId, deletedAt: null },
            select: { id: true, stock: true },
          })
        : [];
    const inventoryMap = new Map(
      inventoryProducts.map((product) => [product.id, product.stock] as const),
    );

    const updates = buildReservationUpdates(
      groupedItems,
      productMap,
      inventoryMap,
    );
    await applyReservationUpdates(tx, storeId, updates);
  }
}

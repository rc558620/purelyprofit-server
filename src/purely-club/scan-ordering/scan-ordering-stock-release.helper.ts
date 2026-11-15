/**
 * 未支付订单关闭时的库存回补（事务内批量写）。
 *
 * 从 ScanOrderingUnpaidOrderClosureService 抽出的原因：原实现按订单项逐行
 * updateMany，而 Prisma 交互式事务是单连接，Promise.all 只会排队串行，
 * 一行最多 3 次往返；这里改成「释放预留 / 恢复已扣减库存」两阶段各一条 SQL，
 * 往返次数与订单项数无关。
 *
 * 分支语义与改造前一致：
 * - 新订单（预留量足够）：只释放 reserved_quantity，不动 stock_quantity / sales_count；
 * - 历史订单（无预留）：恢复 stock_quantity / sales_count，绑定商品且 finite 时回补 Product.stock；
 * - 规格同理，stock_quantity 为 null 的行不参与恢复。
 * `stock_mode = 'finite'` 一律留在 SQL 条件里判断，与改造前的 updateMany where 一致，
 * 不依赖调用方是否把该字段带进内存。
 *
 * 用 UPDATE ... RETURNING 精确拿到「释放预留成功」的行，未返回的才进入恢复分支，
 * 不依赖预读快照，避免并发下分组过时；所有条件仍写在 SQL 里兜底。
 */
import { Prisma } from '@prisma/client';

export interface StockReleaseItem {
  menuProductId: number;
  quantity: number;
  productId: number | null;
  specOptionIds: number[];
}

interface QuantityRow {
  id: number;
  quantity: number;
}

interface MenuProductRow extends QuantityRow {
  productId: number | null;
}

export interface StockReleasePlan {
  menuProducts: MenuProductRow[];
  specOptions: QuantityRow[];
}

/**
 * 按菜单商品 / 规格选项聚合数量。
 *
 * 同一 ID 必须只出现在 VALUES 里一次：Postgres 的 UPDATE ... FROM (VALUES)
 * 对同一目标行只会采用其中一行，重复 ID 会静默丢失数量。
 */
export function aggregateStockRelease(
  items: StockReleaseItem[],
): StockReleasePlan {
  const menuMap = new Map<number, MenuProductRow>();
  const specMap = new Map<number, number>();

  for (const item of items) {
    const menu = menuMap.get(item.menuProductId);
    if (menu) {
      menu.quantity += item.quantity;
    } else {
      menuMap.set(item.menuProductId, {
        id: item.menuProductId,
        quantity: item.quantity,
        productId: item.productId,
      });
    }
    for (const specOptionId of item.specOptionIds) {
      specMap.set(
        specOptionId,
        (specMap.get(specOptionId) ?? 0) + item.quantity,
      );
    }
  }

  return {
    menuProducts: [...menuMap.values()],
    specOptions: [...specMap].map(([id, quantity]) => ({ id, quantity })),
  };
}

const toValueRows = (rows: QuantityRow[]): Prisma.Sql =>
  Prisma.join(
    rows.map((row) => Prisma.sql`(${row.id}::int, ${row.quantity}::int)`),
  );

/** 释放菜单商品预留；RETURNING 只返回预留量足够、确实被扣减的行。 */
async function releaseMenuReservations(
  tx: Prisma.TransactionClient,
  storeId: number,
  rows: MenuProductRow[],
): Promise<number[]> {
  if (rows.length === 0) return [];
  const released = await tx.$queryRaw<Array<{ id: number }>>`
    UPDATE scan_ordering_menu_products AS m
    SET reserved_quantity = m.reserved_quantity - v.quantity,
        version = m.version + 1,
        updated_at = NOW() AT TIME ZONE 'UTC'
    FROM (VALUES ${toValueRows(rows)}) AS v(id, quantity)
    WHERE m.id = v.id
      AND m.store_id = ${storeId}
      AND m.reserved_quantity >= v.quantity
    RETURNING m.id
  `;
  return released.map((row) => Number(row.id));
}

/** 历史订单：恢复已扣减库存与销量，仅 finite 商品参与（SQL 条件）。 */
async function restoreMenuStock(
  tx: Prisma.TransactionClient,
  storeId: number,
  rows: MenuProductRow[],
): Promise<void> {
  if (rows.length === 0) return;
  await tx.$executeRaw`
    UPDATE scan_ordering_menu_products AS m
    SET stock_quantity = m.stock_quantity + v.quantity,
        sales_count = m.sales_count - v.quantity,
        version = m.version + 1,
        updated_at = NOW() AT TIME ZONE 'UTC'
    FROM (VALUES ${toValueRows(rows)}) AS v(id, quantity)
    WHERE m.id = v.id
      AND m.store_id = ${storeId}
      AND m.stock_mode = 'finite'
  `;
}

/**
 * 恢复绑定商品库的共享库存。
 *
 * 多个菜单商品可指向同一 Product，需按 product_id 再聚合一次；
 * `stock_mode = 'finite'` 由子查询在库内判断，避免把判断挪到应用层。
 */
async function restoreBoundProductStock(
  tx: Prisma.TransactionClient,
  storeId: number,
  rows: MenuProductRow[],
): Promise<void> {
  const bound = rows.filter((row) => row.productId !== null);
  if (bound.length === 0) return;

  await tx.$executeRaw`
    UPDATE products AS p
    SET stock = p.stock + v.quantity,
        updated_at = NOW() AT TIME ZONE 'UTC'
    FROM (
      SELECT m.product_id AS id, SUM(input.quantity)::int AS quantity
      FROM scan_ordering_menu_products AS m
      JOIN (VALUES ${toValueRows(bound)}) AS input(id, quantity)
        ON input.id = m.id
      WHERE m.store_id = ${storeId}
        AND m.stock_mode = 'finite'
        AND m.product_id IS NOT NULL
      GROUP BY m.product_id
    ) AS v
    WHERE p.id = v.id
      AND p.store_id = ${storeId}
      AND p.deleted_at IS NULL
  `;
}

/** 释放规格选项预留；规格表无 store_id，与原实现口径一致。 */
async function releaseSpecReservations(
  tx: Prisma.TransactionClient,
  rows: QuantityRow[],
): Promise<number[]> {
  if (rows.length === 0) return [];
  const released = await tx.$queryRaw<Array<{ id: number }>>`
    UPDATE scan_ordering_spec_options AS o
    SET reserved_quantity = o.reserved_quantity - v.quantity,
        version = o.version + 1,
        updated_at = NOW() AT TIME ZONE 'UTC'
    FROM (VALUES ${toValueRows(rows)}) AS v(id, quantity)
    WHERE o.id = v.id
      AND o.reserved_quantity >= v.quantity
    RETURNING o.id
  `;
  return released.map((row) => Number(row.id));
}

/** 历史订单：恢复规格已扣减库存；stock_quantity 为 null 表示不限，跳过。 */
async function restoreSpecStock(
  tx: Prisma.TransactionClient,
  rows: QuantityRow[],
): Promise<void> {
  if (rows.length === 0) return;
  await tx.$executeRaw`
    UPDATE scan_ordering_spec_options AS o
    SET stock_quantity = o.stock_quantity + v.quantity,
        version = o.version + 1,
        updated_at = NOW() AT TIME ZONE 'UTC'
    FROM (VALUES ${toValueRows(rows)}) AS v(id, quantity)
    WHERE o.id = v.id
      AND o.stock_quantity IS NOT NULL
  `;
}

/** 按计划执行两阶段回补；调用方保证已处于同一事务内。 */
export async function applyStockRelease(
  tx: Prisma.TransactionClient,
  storeId: number,
  plan: StockReleasePlan,
): Promise<void> {
  const releasedMenuIds = new Set(
    await releaseMenuReservations(tx, storeId, plan.menuProducts),
  );
  const unreleasedMenu = plan.menuProducts.filter(
    (row) => !releasedMenuIds.has(row.id),
  );
  await restoreMenuStock(tx, storeId, unreleasedMenu);
  await restoreBoundProductStock(tx, storeId, unreleasedMenu);

  const releasedSpecIds = new Set(
    await releaseSpecReservations(tx, plan.specOptions),
  );
  const unreleasedSpecs = plan.specOptions.filter(
    (row) => !releasedSpecIds.has(row.id),
  );
  await restoreSpecStock(tx, unreleasedSpecs);
}

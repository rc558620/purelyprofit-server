import { SpaceSessionStatus } from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { ShiftDateRange } from './handover.shared';
import { sumShiftRevenueYuan } from './handover-page-payment';

/** raw SQL 聚合结果：idx 与 shiftRanges 下标按 ORDER BY idx 对齐 */
type RevenueBatchRow = { idx: number; total: bigint | null };

/**
 * 三个批量聚合的公共 CTE：把 N 个班次区间下推成一张临时区间表，
 * 后续 LATERAL 子查询按区间聚合，DB 往返从 3N 降为 3。
 */
const loadAdditionalRevenueRows = (
  prisma: PrismaService,
  storeId: number,
  startAtArray: Date[],
  endAtArray: Date[],
): Promise<RevenueBatchRow[]> =>
  // additionalRevenue: 非空间销售 + 非扫码点餐订单的 total_revenue 之和
  prisma.$queryRaw<RevenueBatchRow[]>`
    WITH ranges AS (
      SELECT idx, start_at, end_at
      FROM UNNEST(
        ${startAtArray}::timestamptz[],
        ${endAtArray}::timestamptz[]
      ) WITH ORDINALITY AS t(start_at, end_at, idx)
    )
    SELECT r.idx,
      COALESCE(SUM(so.total_revenue), 0)::bigint AS total
    FROM ranges r
    LEFT JOIN LATERAL (
      SELECT total_revenue
      FROM sale_orders
      WHERE store_id = ${storeId}
        AND date >= r.start_at
        AND date <= r.end_at
        AND scan_order_id IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM space_sessions ss WHERE ss.sale_order_id = sale_orders.id
        )
    ) so ON true
    GROUP BY r.idx
    ORDER BY r.idx
  `;

const loadSpaceRevenueRows = (
  prisma: PrismaService,
  storeId: number,
  startAtArray: Date[],
  endAtArray: Date[],
): Promise<RevenueBatchRow[]> =>
  // spaceRevenue: 空间会话 time_cost + items_cost 之和
  prisma.$queryRaw<RevenueBatchRow[]>`
    WITH ranges AS (
      SELECT idx, start_at, end_at
      FROM UNNEST(
        ${startAtArray}::timestamptz[],
        ${endAtArray}::timestamptz[]
      ) WITH ORDINALITY AS t(start_at, end_at, idx)
    )
    SELECT r.idx,
      (COALESCE(SUM(ss.time_cost), 0) + COALESCE(SUM(ss.items_cost), 0))::bigint AS total
    FROM ranges r
    LEFT JOIN LATERAL (
      SELECT time_cost, items_cost
      FROM space_sessions
      WHERE store_id = ${storeId}
        -- status 是 PG 枚举类型 SpaceSessionStatus，枚举与 text 之间无隐式运算符，
        -- 必须两侧同时转 text 比较，否则报 operator does not exist 导致接口 500
        AND status::text = ${SpaceSessionStatus.settled}::text
        AND end_time IS NOT NULL
        AND end_time >= r.start_at
        AND end_time <= r.end_at
    ) ss ON true
    GROUP BY r.idx
    ORDER BY r.idx
  `;

const loadScanOrderingRevenueRows = (
  prisma: PrismaService,
  storeId: number,
  startAtArray: Date[],
  endAtArray: Date[],
): Promise<RevenueBatchRow[]> =>
  // scanOrderingRevenue: 扫码点餐订单（scan_order_id 非空）的 total_revenue 之和
  prisma.$queryRaw<RevenueBatchRow[]>`
    WITH ranges AS (
      SELECT idx, start_at, end_at
      FROM UNNEST(
        ${startAtArray}::timestamptz[],
        ${endAtArray}::timestamptz[]
      ) WITH ORDINALITY AS t(start_at, end_at, idx)
    )
    SELECT r.idx,
      COALESCE(SUM(so.total_revenue), 0)::bigint AS total
    FROM ranges r
    LEFT JOIN LATERAL (
      SELECT total_revenue
      FROM sale_orders
      WHERE store_id = ${storeId}
        AND date >= r.start_at
        AND date <= r.end_at
        AND scan_order_id IS NOT NULL
        AND total_revenue > 0
    ) so ON true
    GROUP BY r.idx
    ORDER BY r.idx
  `;

/**
 * 批量计算交班记录本班营业额（元）。
 *
 * 口径与 countRecordRevenue 完全一致：
 * totalRevenue = additionalRevenue + spaceRevenue(timeCost + itemsCost) + scanOrderingRevenue
 * 退款不在此处扣减（由详情 / 页面作为独立字段展示）。
 */
export const countRecordRevenueBatchYuan = async (
  prisma: PrismaService,
  storeId: number,
  shiftRanges: readonly ShiftDateRange[],
): Promise<number[]> => {
  if (shiftRanges.length === 0) {
    return [];
  }

  const startAtArray = shiftRanges.map((range) => range.startAt);
  const endAtArray = shiftRanges.map((range) => range.endAt);

  const [additionalRows, spaceRows, scanOrderingRows] = await Promise.all([
    loadAdditionalRevenueRows(prisma, storeId, startAtArray, endAtArray),
    loadSpaceRevenueRows(prisma, storeId, startAtArray, endAtArray),
    loadScanOrderingRevenueRows(prisma, storeId, startAtArray, endAtArray),
  ]);

  return shiftRanges.map((_, index) => {
    const additionalCents = Number(additionalRows[index]?.total ?? 0);
    const spaceCents =
      Number(spaceRows[index]?.total ?? 0) +
      Number(scanOrderingRows[index]?.total ?? 0);

    return sumShiftRevenueYuan(additionalCents, spaceCents);
  });
};

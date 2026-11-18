/**
 * 商家端订单列表的查询条件与状态分桶。
 *
 * 从 `ScanOrderingOrderService` 抽出：这里只做「条件拼装 + 分页取数」，
 * 不涉及权限、昵称、加餐序号等响应组装，主服务因此只保留编排职责。
 *
 * 分桶动机：前端工作台只消费第一页（未接游标），若「待商家处理」与已出餐
 * 历史混在同一个 id 倒序窗口里，高峰期旧的待接单/制作中订单会被新单挤出列表。
 */
import type { Prisma, ScanOrderStatus } from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { ListScanOrderingOrdersDto } from './dto/scan-ordering-order-query.dto';
import type { ScanOrderListItemSource } from './scan-ordering-order.mapper';

/** 默认列表状态（无显式状态筛选时）：进行中未完结订单，跨天仍可见。 */
const DEFAULT_LIST_STATUSES = [
  'pending_payment',
  'pending_acceptance',
  'preparing',
  'served',
  'refunding',
] as const;

/**
 * 「待商家处理」状态集合。
 *
 * 前端工作台只消费第一页，这些订单必须优先占满名额，
 * 否则会被源源不断的新单与已出餐历史挤出可见范围。
 */
const ACTIONABLE_ORDER_STATUSES = new Set<string>([
  'pending_acceptance',
  'preparing',
  'refunding',
]);

/**
 * 解析列表时间范围：优先使用自定义时间范围；
 * 未传时间时返回 null（不过滤创建时间），保证跨天进行中订单（如夜宵店
 * 跨零点接单/制作中的订单）在列表中持续可见，避免「桌台可见、列表不可见」。
 */
export const resolveListTimeRange = (
  query: ListScanOrderingOrdersDto,
): { startOfDay: Date | null; endOfDay: Date | null } => {
  if (query.startTime && query.endTime) {
    return {
      startOfDay: new Date(query.startTime),
      endOfDay: new Date(query.endTime),
    };
  }
  return { startOfDay: null, endOfDay: null };
};

/** 解析本次查询的状态集合：显式状态优先，缺省为进行中未完结订单。 */
export const resolveListStatuses = (
  query: ListScanOrderingOrdersDto,
): string[] => {
  if (query.status) return [query.status as unknown as string];
  return [...DEFAULT_LIST_STATUSES];
};

/**
 * 构建订单列表查询条件（门店、时间、桌台、游标；状态由 resolveListStatuses 单独解析）。
 *
 * 时间范围仅在调用方显式传入 startTime/endTime 时生效，
 * 默认返回所有进行中未完结订单（跨天可见）。
 */
export const buildListWhere = (
  storeId: number,
  query: ListScanOrderingOrdersDto,
  startOfDay: Date | null,
  endOfDay: Date | null,
): Record<string, unknown> => {
  const where: Record<string, unknown> = {
    storeId,
    // 软删订单不进入订单队列；同时让 scan_orders 上以 deleted_at IS NULL
    // 为条件的 partial 索引（store_status_created / table_active）可被命中
    deletedAt: null,
    ...(startOfDay !== null && endOfDay !== null
      ? {
          createdAt: {
            gte: startOfDay,
            lt: endOfDay,
          },
        }
      : {}),
    ...(query.tableId ? { tableId: query.tableId } : {}),
    ...(query.cursor ? { id: { lt: query.cursor } } : {}),
  };
  // 桌号模糊匹配
  if (query.tableKeyword) {
    where.table = {
      name: {
        contains: query.tableKeyword,
        mode: 'insensitive',
      },
    };
  }
  return where;
};

/**
 * 取一页订单：待处理状态优先占位。
 *
 * 两次查询分别取「待商家处理」与其余进行中状态：待处理先占满名额，
 * 剩余名额再按 id 倒序补历史。展示顺序仍是 id 倒序（与前端卡片排序一致），
 * 但「待处理一定在第一页」由名额分配保证，不再取决于新单涌进来的速度。
 */
export const fetchPriorityPage = async (
  prisma: PrismaService,
  where: Record<string, unknown>,
  statuses: string[],
  limit: number,
): Promise<{ pageOrders: ScanOrderListItemSource[]; hasMore: boolean }> => {
  const actionable = statuses.filter((status) =>
    ACTIONABLE_ORDER_STATUSES.has(status),
  );
  const others = statuses.filter(
    (status) => !ACTIONABLE_ORDER_STATUSES.has(status),
  );
  if (actionable.length === 0 || others.length === 0) {
    const rows = await fetchOrdersOfStatuses(
      prisma,
      where,
      actionable.length > 0 ? actionable : others,
      limit + 1,
    );
    return { pageOrders: rows.slice(0, limit), hasMore: rows.length > limit };
  }
  const [actionableRows, otherRows] = await Promise.all([
    fetchOrdersOfStatuses(prisma, where, actionable, limit + 1),
    fetchOrdersOfStatuses(prisma, where, others, limit + 1),
  ]);
  const selected = actionableRows.slice(0, limit);
  const remaining = limit - selected.length;
  if (remaining > 0) selected.push(...otherRows.slice(0, remaining));
  // 两组状态互斥、id 不重叠，合并后按 id 倒序即前端展示顺序
  const pageOrders = selected.sort((a, b) => b.id - a.id);
  return {
    pageOrders,
    hasMore: actionableRows.length + otherRows.length > pageOrders.length,
  };
};

/** 按状态集合查询一页订单（多取一条用于判断是否有下一页）。 */
const fetchOrdersOfStatuses = (
  prisma: PrismaService,
  where: Record<string, unknown>,
  statuses: string[],
  take: number,
): Promise<ScanOrderListItemSource[]> => {
  const pageWhere = {
    ...where,
    status: { in: statuses as ScanOrderStatus[] },
  } as Prisma.ScanOrdersWhereInput;
  return prisma.scanOrders.findMany({
    where: pageWhere,
    orderBy: { id: 'desc' },
    take,
    select: {
      id: true,
      orderNo: true,
      status: true,
      createdAt: true,
      version: true,
      clubUserId: true,
      sessionId: true,
      diningRoundId: true,
      remark: true,
      table: { select: { name: true } },
      manualEntry: true,
      manualEntryMetadata: true,
      items: {
        select: {
          productNameSnapshot: true,
          productImageUrlSnapshot: true,
          quantity: true,
          unitPriceAmount: true,
          lineTotalAmount: true,
          payableLineAmount: true,
          specs: {
            select: { specOptionNameSnapshot: true },
            orderBy: { id: 'asc' },
          },
        },
        orderBy: { id: 'asc' },
      },
      itemOriginalAmount: true,
      specificationExtraAmount: true,
      productDiscountAmount: true,
      orderDiscountAmount: true,
      taxAmount: true,
      serviceFeeAmount: true,
      paidAmount: true,
      payableAmount: true,
      marketingSnapshot: true,
      pickupNumber: true,
      pickupNumberStatus: true,
      pickupCalledAt: true,
    },
  });
};

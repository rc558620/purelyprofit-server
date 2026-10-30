// Pulse / 管理端会员列表排序：排序指标取数 + 全量排序。
//
// 为什么排序不下推到 `store.findMany` 的 orderBy：
// 列表的分片建立在**内存过滤后的全量结果**之上（封禁状态存 Redis，无法下推数据库），
// 数据库层排序只能排到当前页，会把「全量 Top N」排成「当前页 Top N」。
// 因此这里统一在切片前对全量结果排序。
import type { PrismaExecutor } from '../../purely-profit/member/platform-membership/platform-membership.types';
import type {
  PulseMemberSortByValue,
  PulseMemberSortOrderValue,
} from './dto/pulse-membership-admin-members.constants';
import type { PulseMemberListItemDto } from './dto/pulse-membership-admin-members.response.dto';

/** 单个门店的排序指标。 */
export interface PulseAdminMemberSortMetric {
  /** 门店累计营业额（分）：`sale_orders.total_revenue` 求和。 */
  revenueFen: number;
  /** 门店在 purelyClub 的 C 端会员数：`marketing_customers` 计数。 */
  memberCount: number;
}

/** 门店 id → 排序指标（未命中的门店按 0 参与排序）。 */
export type PulseAdminMemberSortMetrics = Map<
  number,
  PulseAdminMemberSortMetric
>;

/**
 * 按排序字段取对应指标。
 *
 * 只查当前排序需要的那一份聚合：营业额与客户数是两张表，
 * 一次列表请求不会同时用两个字段排序。
 */
export async function fetchAdminMemberListSortMetrics(
  prisma: PrismaExecutor,
  storeIds: number[],
  sortBy: PulseMemberSortByValue,
): Promise<PulseAdminMemberSortMetrics> {
  if (sortBy === 'default' || storeIds.length === 0) {
    // 每次返回新 Map：EMPTY_SORT_METRICS 若被写会污染后续所有 default 请求
    return new Map();
  }

  const metrics: PulseAdminMemberSortMetrics = new Map();

  // 累计营业额：与会员详情「营业详情统计」同源（sale_orders.total_revenue）
  if (sortBy === 'revenue') {
    const rows = await prisma.saleOrder.groupBy({
      by: ['storeId'],
      where: { storeId: { in: storeIds } },
      _sum: { totalRevenue: true },
    });

    for (const row of rows) {
      metrics.set(row.storeId, {
        revenueFen: Number(row._sum.totalRevenue ?? 0),
        memberCount: 0,
      });
    }

    return metrics;
  }

  // C 端会员数：与会员详情「会员运营统计」同源（marketing_customers）
  //
  // deletedAt: null —— 已软删除的客户不算会员，与商家端会员列表口径一致
  //（marketing.domain.ts / marketing-customer-list.service.ts 同样排除软删除）
  const rows = await prisma.marketingCustomer.groupBy({
    by: ['storeId'],
    where: { storeId: { in: storeIds }, deletedAt: null },
    _count: { id: true },
  });

  for (const row of rows) {
    metrics.set(row.storeId, {
      revenueFen: 0,
      memberCount: row._count.id,
    });
  }

  return metrics;
}

/**
 * 对过滤后的全量会员列表排序。
 *
 * 同指标时用门店 id 升序兜底：分页切片要求顺序确定，
 * 否则同值项的相对位置每次请求都可能变，翻页会出现漏项 / 重复。
 */
export function sortAdminMemberListItems(
  items: PulseMemberListItemDto[],
  metrics: PulseAdminMemberSortMetrics,
  sortBy: PulseMemberSortByValue,
  sortOrder: PulseMemberSortOrderValue,
): PulseMemberListItemDto[] {
  if (sortBy === 'default' || items.length <= 1) {
    return items;
  }

  const direction = sortOrder === 'asc' ? 1 : -1;
  const readMetric = (item: PulseMemberListItemDto): number => {
    const metric = metrics.get(Number(item.id));
    return sortBy === 'revenue'
      ? (metric?.revenueFen ?? 0)
      : (metric?.memberCount ?? 0);
  };

  return [...items].sort((left, right) => {
    const diff = readMetric(left) - readMetric(right);
    return diff !== 0 ? diff * direction : Number(left.id) - Number(right.id);
  });
}

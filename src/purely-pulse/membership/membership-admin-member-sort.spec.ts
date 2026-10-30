// 会员列表排序单测：覆盖默认顺序、营业额 / 会员数排序方向与同值兜底顺序，
// 并固化「会员数排除软删除客户」的取数口径。
import { PrismaService } from '../../prisma/prisma.service';
import {
  fetchAdminMemberListSortMetrics,
  sortAdminMemberListItems,
} from './membership-admin-member-sort';
import type {
  PulseMemberSortByValue,
  PulseMemberSortOrderValue,
} from './dto/pulse-membership-admin-members.constants';
import type { PulseMemberListItemDto } from './dto/pulse-membership-admin-members.response.dto';

/** 排序只依赖 id，其余字段与本次断言无关，用最小对象构造。 */
const buildItem = (id: string): PulseMemberListItemDto =>
  ({ id }) as unknown as PulseMemberListItemDto;

const buildIds = (items: PulseMemberListItemDto[]): string[] =>
  items.map((item) => item.id);

const sort = (
  ids: string[],
  metrics: Array<[number, { revenueFen: number; memberCount: number }]>,
  sortBy: PulseMemberSortByValue,
  sortOrder: PulseMemberSortOrderValue = 'desc',
): string[] =>
  buildIds(
    sortAdminMemberListItems(
      ids.map(buildItem),
      new Map(metrics),
      sortBy,
      sortOrder,
    ),
  );

describe('sortAdminMemberListItems', () => {
  it('default 排序原样返回，不产生新数组', () => {
    const items = ['1', '2', '3'].map(buildItem);

    const result = sortAdminMemberListItems(
      items,
      new Map(),
      'default',
      'desc',
    );

    expect(result).toBe(items);
  });

  it('按营业额降序，指标取不到的门店按 0 排在最后', () => {
    const ids = sort(
      ['10', '20', '30'],
      [
        [10, { revenueFen: 100, memberCount: 0 }],
        [20, { revenueFen: 900, memberCount: 0 }],
      ],
      'revenue',
    );

    expect(ids).toEqual(['20', '10', '30']);
  });

  it('按会员数升序时指标小的在前', () => {
    const ids = sort(
      ['10', '20', '30'],
      [
        [10, { revenueFen: 0, memberCount: 5 }],
        [20, { revenueFen: 0, memberCount: 1 }],
        [30, { revenueFen: 0, memberCount: 9 }],
      ],
      'memberCount',
      'asc',
    );

    expect(ids).toEqual(['20', '10', '30']);
  });

  it('会员数取数排除软删除客户（deletedAt: null）', async () => {
    const groupBy = jest
      .fn()
      .mockResolvedValue([{ storeId: 10, _count: { id: 4 } }]);
    const prisma = {
      marketingCustomer: { groupBy },
    } as unknown as PrismaService;

    const metrics = await fetchAdminMemberListSortMetrics(
      prisma,
      [10],
      'memberCount',
    );

    expect(groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { storeId: { in: [10] }, deletedAt: null },
      }),
    );
    expect(metrics.get(10)?.memberCount).toBe(4);
  });

  it('营业额取数按门店聚合累计销售额', async () => {
    const groupBy = jest
      .fn()
      .mockResolvedValue([{ storeId: 10, _sum: { totalRevenue: 128_00 } }]);
    const prisma = {
      saleOrder: { groupBy },
    } as unknown as PrismaService;

    const metrics = await fetchAdminMemberListSortMetrics(
      prisma,
      [10],
      'revenue',
    );

    expect(groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { storeId: { in: [10] } },
        _sum: { totalRevenue: true },
      }),
    );
    expect(metrics.get(10)?.revenueFen).toBe(128_00);
  });

  it('默认排序不下发任何聚合查询', async () => {
    const groupBy = jest.fn();
    const prisma = {
      saleOrder: { groupBy },
      marketingCustomer: { groupBy },
    } as unknown as PrismaService;

    const metrics = await fetchAdminMemberListSortMetrics(
      prisma,
      [10],
      'default',
    );

    expect(groupBy).not.toHaveBeenCalled();
    expect(metrics.size).toBe(0);
  });

  it('指标相同时按门店 id 升序兜底，保证分页顺序稳定', () => {
    const ids = sort(
      ['30', '10', '20'],
      [
        [10, { revenueFen: 500, memberCount: 0 }],
        [20, { revenueFen: 500, memberCount: 0 }],
        [30, { revenueFen: 500, memberCount: 0 }],
      ],
      'revenue',
    );

    expect(ids).toEqual(['10', '20', '30']);
  });
});

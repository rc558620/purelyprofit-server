// 成本记录列表游标分页回归：双路径形状、同值行不漏不重、非法游标 400
import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { CostsReadRecordsService } from './costs-read-records.service';
import {
  createCostsCommerceAccessServiceMock,
  createCostsPlatformMembershipAccessServiceMock,
  createCostsPrismaMock,
  createCostsReadProviders,
  createCostsSpecUser,
} from './costs.spec-helpers';
import {
  decodeCursor,
  encodeCursor,
} from '../../../shared/cursor-pagination.utils';

/** 成本记录行样本：字段与 CostRecordResponseSource 对齐 */
interface FakeCostRow {
  id: number;
  title: string;
  type: string;
  category: string;
  sourceType: string;
  amount: number;
  note: string | null;
  date: Date;
  createdAt: Date;
}

const buildCostRow = (
  id: number,
  date: Date,
  createdAt: Date,
): FakeCostRow => ({
  id,
  title: `成本-${id}`,
  type: 'fixed',
  category: 'rent',
  sourceType: 'manual',
  amount: 100000,
  note: null,
  date,
  createdAt,
});

/** 时间区间条件守卫（游标 where 的分支形态不同，需要区分） */
const isRange = (value: unknown): value is { lt: Date } =>
  typeof value === 'object' && value !== null && 'lt' in value;

/** 判断行是否严格排在游标之后：三级排序键逐级比较 */
const isAfterCursor = (
  row: FakeCostRow,
  cursorWhere: { OR?: Array<Record<string, unknown>> },
): boolean =>
  (cursorWhere.OR ?? []).some((branch) => {
    const dateCondition = branch.date;
    if (isRange(dateCondition)) {
      return row.date.getTime() < dateCondition.lt.getTime();
    }
    if (
      !(dateCondition instanceof Date) ||
      dateCondition.getTime() !== row.date.getTime()
    ) {
      return false;
    }

    const createdAtCondition = branch.createdAt;
    if (isRange(createdAtCondition)) {
      return row.createdAt.getTime() < createdAtCondition.lt.getTime();
    }
    if (
      !(createdAtCondition instanceof Date) ||
      createdAtCondition.getTime() !== row.createdAt.getTime()
    ) {
      return false;
    }

    const idCondition = branch.id as { lt: number };
    return row.id < idCondition.lt;
  });

interface FakeListArgs {
  where: { AND?: Array<{ OR?: Array<Record<string, unknown>> }> };
  take: number;
  skip?: number;
}

/** 内存模拟列表查询：只实现游标条件 + 三级排序 + skip/take */
const emulateListQuery = (
  dataset: FakeCostRow[],
  args: FakeListArgs,
): FakeCostRow[] => {
  const cursorWhere = args.where.AND?.[1];
  const rows = cursorWhere
    ? dataset.filter((row) => isAfterCursor(row, cursorWhere))
    : [...dataset];
  rows.sort(
    (left, right) =>
      right.date.getTime() - left.date.getTime() ||
      right.createdAt.getTime() - left.createdAt.getTime() ||
      right.id - left.id,
  );
  return rows.slice(args.skip ?? 0, (args.skip ?? 0) + args.take);
};

describe('CostsReadRecordsService 游标分页', () => {
  let service: CostsReadRecordsService;
  let prismaService: ReturnType<typeof createCostsPrismaMock>;
  let commerceAccessService: ReturnType<
    typeof createCostsCommerceAccessServiceMock
  >;
  const user = createCostsSpecUser();
  const bookDate = new Date('2026-05-01T00:00:00.000Z');
  const createdSame = new Date('2026-05-14T10:00:00.000Z');

  beforeEach(async () => {
    prismaService = createCostsPrismaMock();
    commerceAccessService = createCostsCommerceAccessServiceMock();
    commerceAccessService.resolveViewStoreId.mockResolvedValue(18);

    const platformMembershipAccessService =
      createCostsPlatformMembershipAccessServiceMock();
    platformMembershipAccessService.clampHistoryRange.mockImplementation(
      (_storeId: number, range: { start: number; end: number }) =>
        Promise.resolve({
          start: range.start,
          end: range.end,
          clamped: false,
          empty: false,
        }),
    );
    platformMembershipAccessService.getHistoryWindowStart.mockResolvedValue(
      null,
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: createCostsReadProviders(
        prismaService,
        commerceAccessService,
        platformMembershipAccessService,
      ),
    }).compile();

    service = module.get(CostsReadRecordsService);
  });

  it('offset 兼容路径：保留 skip，用 total 推导 hasMore 并产出 nextCursor', async () => {
    prismaService.costRecord.findMany.mockResolvedValue([
      buildCostRow(9, bookDate, createdSame),
    ]);
    prismaService.costRecord.count.mockResolvedValue(5);

    const result = await service.listRecords(user, {
      period: 'month',
      page: 2,
      pageSize: 1,
    });

    const listArgs = prismaService.costRecord.findMany.mock.calls[0][0] as {
      skip?: number;
      take: number;
      orderBy: unknown;
    };
    expect(listArgs.skip).toBe(1);
    expect(listArgs.take).toBe(1);
    expect(listArgs.orderBy).toEqual([
      { date: 'desc' },
      { createdAt: 'desc' },
      { id: 'desc' },
    ]);
    // 2 + 1 < 5
    expect(result.hasMore).toBe(true);
    expect(decodeCursor(result.nextCursor)?.id).toBe(9);
  });

  it('游标路径：不传 skip、多取一行探测、游标条件按三级排序键展开', async () => {
    const cursor = { date: bookDate, createdAt: createdSame, id: 9 };
    prismaService.costRecord.findMany.mockResolvedValue([
      buildCostRow(4, bookDate, createdSame),
      buildCostRow(3, bookDate, createdSame),
    ]);
    prismaService.costRecord.count.mockResolvedValue(6);

    const result = await service.listRecords(user, {
      period: 'month',
      pageSize: 1,
      cursor: encodeCursor({
        keys: [cursor.date.getTime(), cursor.createdAt.getTime()],
        id: cursor.id,
      }),
    });

    const listArgs = prismaService.costRecord.findMany.mock.calls[0][0] as {
      where: { AND: Array<Record<string, unknown>> };
      skip?: number;
      take: number;
    };
    expect(listArgs.skip).toBeUndefined();
    expect(listArgs.take).toBe(2);
    expect(listArgs.where.AND[1]).toEqual({
      OR: [
        { date: { lt: bookDate } },
        { date: bookDate, createdAt: { lt: createdSame } },
        { date: bookDate, createdAt: createdSame, id: { lt: 9 } },
      ],
    });

    // total 是全量口径：count 不带游标条件
    const countArgs = prismaService.costRecord.count.mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(countArgs.where.AND).toBeUndefined();
    expect(result.meta.total).toBe(6);
    expect(result.items).toHaveLength(1);
    expect(result.hasMore).toBe(true);
    expect(decodeCursor(result.nextCursor)?.id).toBe(4);
  });

  it('游标页不再进缓存：同样参数第二次请求仍会回源查库', async () => {
    prismaService.costRecord.findMany.mockResolvedValue([]);
    prismaService.costRecord.count.mockResolvedValue(3);
    const query = {
      period: 'month' as const,
      cursor: encodeCursor({
        keys: [bookDate.getTime(), createdSame.getTime()],
        id: 9,
      }),
    };

    await service.listRecords(user, query);
    await service.listRecords(user, query);

    expect(prismaService.costRecord.findMany).toHaveBeenCalledTimes(2);
  });

  it('非法 cursor 抛 400，且不查库', async () => {
    await expect(
      service.listRecords(user, { period: 'month', cursor: 'v1:broken' }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prismaService.costRecord.findMany).not.toHaveBeenCalled();
    expect(prismaService.costRecord.count).not.toHaveBeenCalled();
  });

  it('相同 date + createdAt 的多条记录按 id 兜底翻页：不漏不重', async () => {
    // 3 条完全同值的记录 + 2 条更早的记录，共 5 条
    const dataset = [
      buildCostRow(3, bookDate, createdSame),
      buildCostRow(2, bookDate, createdSame),
      buildCostRow(1, bookDate, createdSame),
      buildCostRow(8, new Date('2026-04-30T00:00:00.000Z'), createdSame),
      buildCostRow(7, new Date('2026-04-29T00:00:00.000Z'), createdSame),
    ];
    prismaService.costRecord.findMany.mockImplementation((args: FakeListArgs) =>
      Promise.resolve(emulateListQuery(dataset, args)),
    );
    prismaService.costRecord.count.mockResolvedValue(dataset.length);

    const first = await service.listRecords(user, {
      period: 'month',
      pageSize: 2,
    });
    const second = await service.listRecords(user, {
      period: 'month',
      pageSize: 2,
      cursor: first.nextCursor ?? undefined,
    });
    const third = await service.listRecords(user, {
      period: 'month',
      pageSize: 2,
      cursor: second.nextCursor ?? undefined,
    });

    expect(
      [...first.items, ...second.items, ...third.items].map((item) => item.id),
    ).toEqual(['3', '2', '1', '8', '7']);
    expect(third.hasMore).toBe(false);
    expect(third.nextCursor).toBeNull();
  });
});

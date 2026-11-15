// 现金流水游标分页回归：双路径形状、同值行不漏不重、游标页不进缓存、非法游标 400
import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { FinanceCashFlowService } from './finance-cash-flow.service';
import {
  createFinanceCashFlowPrismaMock,
  createFinanceCashFlowProviders,
  createFinanceSpecUser,
  createPlatformMembershipAccessServiceMock,
  useFinanceSpecFakeTimers,
} from './finance.spec-helpers';
import {
  decodeCursor,
  encodeCursor,
} from '../../shared/cursor-pagination.utils';

/** 现金流水分页测试行：与 FinanceCashFlowRecordWithAmount 对齐 */
interface FakeCashFlowRow {
  id: number;
  direction: string;
  category: string;
  title: string;
  amount: number;
  payment: string;
  note: string | null;
  date: Date;
  createdAt: Date;
}

const buildRow = (
  id: number,
  date: Date,
  createdAt: Date,
): FakeCashFlowRow => ({
  id,
  direction: 'income',
  category: 'other_income',
  title: `流水-${id}`,
  amount: 12800,
  payment: 'cash',
  note: null,
  date,
  createdAt,
});

/** 时间区间条件（`{ lt }`）与等值条件（Date）形态不同，必须先区分 */
const isRange = (value: unknown): value is { lt: Date } =>
  typeof value === 'object' && value !== null && 'lt' in value;

/** 判断行是否严格排在游标之后：三级排序键逐级比较 */
const isAfterCursor = (
  row: FakeCashFlowRow,
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
  skip?: number;
  take: number;
}

/** 内存模拟列表查询：游标条件 + 三级排序 + skip/take */
const emulateListQuery = (
  dataset: FakeCashFlowRow[],
  args: FakeListArgs,
): FakeCashFlowRow[] => {
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
  const skip = args.skip ?? 0;
  return rows.slice(skip, skip + args.take);
};

describe('FinanceCashFlowService 游标分页', () => {
  let service: FinanceCashFlowService;
  let prismaService: ReturnType<typeof createFinanceCashFlowPrismaMock>;
  const user = createFinanceSpecUser();
  const bookDate = new Date('2026-05-01T00:00:00.000Z');
  const createdSame = new Date('2026-05-14T10:00:00.000Z');
  const olderDate = new Date('2026-04-30T00:00:00.000Z');

  beforeEach(async () => {
    useFinanceSpecFakeTimers();
    prismaService = createFinanceCashFlowPrismaMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: createFinanceCashFlowProviders(
        prismaService,
        createPlatformMembershipAccessServiceMock(),
      ),
    }).compile();

    service = module.get(FinanceCashFlowService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('offset 兼容路径：保留 skip、用 total 推导 hasMore 并产出 nextCursor', async () => {
    prismaService.financeCashFlowRecord.findMany.mockResolvedValue([
      buildRow(9, bookDate, createdSame),
    ]);
    prismaService.financeCashFlowRecord.count.mockResolvedValue(5);

    const result = await service.listCashFlowRecords(user, {
      period: 'month',
      page: 2,
      pageSize: 1,
    });

    const listArgs = prismaService.financeCashFlowRecord.findMany.mock
      .calls[0][0] as {
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
    // 1 + 1 < 5
    expect(result.hasMore).toBe(true);
    expect(decodeCursor(result.nextCursor)?.id).toBe(9);
  });

  it('游标路径：不传 skip、多取一行探测、游标条件按三级排序键展开', async () => {
    prismaService.financeCashFlowRecord.findMany.mockResolvedValue([
      buildRow(4, bookDate, createdSame),
      buildRow(3, bookDate, createdSame),
    ]);
    prismaService.financeCashFlowRecord.count.mockResolvedValue(6);

    const result = await service.listCashFlowRecords(user, {
      period: 'month',
      pageSize: 1,
      cursor: encodeCursor({
        keys: [bookDate.getTime(), createdSame.getTime()],
        id: 9,
      }),
    });

    const listArgs = prismaService.financeCashFlowRecord.findMany.mock
      .calls[0][0] as {
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

    // total 必须是全量口径：COUNT 不带游标条件
    const countArgs = prismaService.financeCashFlowRecord.count.mock
      .calls[0][0] as { where: Record<string, unknown> };
    expect(countArgs.where.AND).toBeUndefined();
    expect(result.meta.total).toBe(6);
    expect(result.items).toHaveLength(1);
    expect(result.hasMore).toBe(true);
    expect(decodeCursor(result.nextCursor)?.id).toBe(4);
  });

  it('游标页不进缓存：相同游标第二次请求仍回源查库', async () => {
    prismaService.financeCashFlowRecord.findMany.mockResolvedValue([]);
    prismaService.financeCashFlowRecord.count.mockResolvedValue(3);
    const cursor = encodeCursor({
      keys: [bookDate.getTime(), createdSame.getTime()],
      id: 9,
    });

    await service.listCashFlowRecords(user, { period: 'month', cursor });
    await service.listCashFlowRecords(user, { period: 'month', cursor });

    expect(prismaService.financeCashFlowRecord.findMany).toHaveBeenCalledTimes(
      2,
    );
  });

  it('非法 cursor 抛 400，且不查库', async () => {
    await expect(
      service.listCashFlowRecords(user, {
        period: 'month',
        cursor: 'v1:broken',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prismaService.financeCashFlowRecord.findMany).not.toHaveBeenCalled();
    expect(prismaService.financeCashFlowRecord.count).not.toHaveBeenCalled();
  });

  it('相同 date + createdAt 的多条流水按 id 兜底翻页：不漏不重且末页到底', async () => {
    // 3 条完全同值 + 2 条更早，共 5 条；pageSize=2 => 3 页
    const dataset = [
      buildRow(3, bookDate, createdSame),
      buildRow(2, bookDate, createdSame),
      buildRow(1, bookDate, createdSame),
      buildRow(8, olderDate, createdSame),
      buildRow(7, olderDate, createdSame),
    ];
    prismaService.financeCashFlowRecord.findMany.mockImplementation(
      (args: FakeListArgs) => Promise.resolve(emulateListQuery(dataset, args)),
    );
    prismaService.financeCashFlowRecord.count.mockResolvedValue(dataset.length);

    const first = await service.listCashFlowRecords(user, {
      period: 'month',
      pageSize: 2,
    });
    const second = await service.listCashFlowRecords(user, {
      period: 'month',
      pageSize: 2,
      cursor: first.nextCursor ?? undefined,
    });
    const third = await service.listCashFlowRecords(user, {
      period: 'month',
      pageSize: 2,
      cursor: second.nextCursor ?? undefined,
    });

    expect(
      [...first.items, ...second.items, ...third.items].map((item) => item.id),
    ).toEqual(['3', '2', '1', '8', '7']);
    expect(third.hasMore).toBe(false);
    expect(third.nextCursor).toBeNull();
    expect(third.meta.total).toBe(5);
  });
});

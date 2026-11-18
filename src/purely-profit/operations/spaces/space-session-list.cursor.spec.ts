// 空间会话列表（空间维度）游标分页回归：双路径形状、同值行不漏不重、非法游标 400
import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import type { CommerceAccessService } from '../../commerce/commerce-access.service';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { RefreshableCacheService } from '../../../redis/refreshable-cache.service';
import type { RefreshableCacheLoadOptions } from '../../../redis/refreshable-cache.types';
import {
  decodeCursor,
  encodeCursor,
} from '../../../shared/cursor-pagination.utils';
import { SpaceSessionReadService } from './space-session-read.service';
import type { SpaceSessionReadStateService } from './space-session-read-state.service';

const user = {} as AuthenticatedUser;
const startedAt = new Date('2026-11-14T02:00:00.000Z');
const earlierAt = new Date('2026-11-13T02:00:00.000Z');

/**
 * 会话行样本：映射层对可空字段做 `!== null` 判断，
 * 因此所有可空列都必须显式给 null，不能留 undefined（否则会被当成有值继续换算金额）。
 */
const buildSessionRow = (id: number, startTime: Date) => ({
  id,
  storeId: 18,
  spaceId: 7,
  guestName: null,
  guestPhone: null,
  guestCount: null,
  startTime,
  endTime: null,
  billingMode: 'timed',
  hourlyRate: null,
  timeCost: null,
  countdownMinutes: null,
  autoCheckout: null,
  prepaidPaymentMethod: null,
  prepaidCustomerPaymentMethod: null,
  prepaidSettlementChannel: null,
  prepaidGrouponCode: null,
  prepaidGrouponPlatform: null,
  prepaidVoucherCode: null,
  prepaidVoucherPlatform: null,
  prepaidNote: null,
  prepaidAmount: null,
  prepaidVoucherFaceAmount: null,
  settlementStatus: null,
  platformReceivable: null,
  platformSettledAmount: null,
  platformFee: null,
  timeFeeMode: null,
  itemsCost: 0,
  commissionAssignments: null,
  status: 'active',
  saleOrderId: null,
  createdAt: startTime,
  space: { id: 7, name: '包厢 A', type: { name: '包厢' } },
  sessionItems: [],
  sessionRenewRecords: [],
});

type FakeSessionRow = ReturnType<typeof buildSessionRow>;

/** 时间区间条件（`{ lt }`）与等值条件（Date）形态不同，必须先区分 */
const isRange = (value: unknown): value is { lt: Date } =>
  typeof value === 'object' && value !== null && 'lt' in value;

/** 判断行是否严格排在游标之后：startTime 相同必须再比 id */
const isAfterCursor = (
  row: FakeSessionRow,
  cursorWhere: { OR?: Array<Record<string, unknown>> },
): boolean =>
  (cursorWhere.OR ?? []).some((branch) => {
    const startTimeCondition = branch.startTime;
    if (isRange(startTimeCondition)) {
      return row.startTime.getTime() < startTimeCondition.lt.getTime();
    }
    if (
      !(startTimeCondition instanceof Date) ||
      startTimeCondition.getTime() !== row.startTime.getTime()
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

/**
 * 识别游标条件：本域的筛选 where 自身也是 `{ AND: [...] }`，
 * 不能按固定下标取，只能按「带 OR 分支数组」的形态识别。
 */
const isCursorCondition = (
  value: unknown,
): value is { OR: Array<Record<string, unknown>> } =>
  typeof value === 'object' &&
  value !== null &&
  Array.isArray((value as { OR?: unknown }).OR);

/** 内存模拟列表查询：游标条件 + 两级排序 + skip/take */
const emulateListQuery = (
  dataset: FakeSessionRow[],
  args: FakeListArgs,
): FakeSessionRow[] => {
  const cursorWhere = args.where.AND?.find((branch) =>
    isCursorCondition(branch),
  );
  const rows = cursorWhere
    ? dataset.filter((row) => isAfterCursor(row, cursorWhere))
    : [...dataset];
  rows.sort(
    (left, right) =>
      right.startTime.getTime() - left.startTime.getTime() ||
      right.id - left.id,
  );
  const skip = args.skip ?? 0;
  return rows.slice(skip, skip + args.take);
};

function buildService(dataset: FakeSessionRow[]) {
  const spaceSession = {
    findMany: jest.fn((args: FakeListArgs) =>
      Promise.resolve(emulateListQuery(dataset, args)),
    ),
    count: jest.fn().mockResolvedValue(dataset.length),
  };
  const prisma = {
    space: {
      findFirst: jest.fn().mockResolvedValue({ id: 7, storeId: 18 }),
    },
    spaceSession,
  } as unknown as PrismaService;
  const commerceAccess = {
    ensureCanAccessStore: jest.fn().mockResolvedValue(undefined),
  } as unknown as CommerceAccessService;
  const configService = {
    get: jest.fn((key: string) => {
      if (key === 'app.defaultPageSize') return 20;
      if (key === 'app.maxPageSize') return 100;
      return undefined;
    }),
  } as unknown as ConfigService;
  const readState = {} as unknown as SpaceSessionReadStateService;
  // 本用例只覆盖分页路径，缓存层直通 loadValue（不命中即回源）
  const refreshableCache = {
    getOrLoadRefreshableJson: jest.fn(
      (options: RefreshableCacheLoadOptions<unknown>) => options.loadValue(),
    ),
  } as unknown as RefreshableCacheService;

  return {
    service: new SpaceSessionReadService(
      prisma,
      commerceAccess,
      configService,
      readState,
      refreshableCache,
    ),
    spaceSession,
  };
}

describe('SpaceSessionReadService.listSpaceSessions 游标分页', () => {
  it('offset 兼容路径：保留 skip、用 total 推导 hasMore 并产出 nextCursor', async () => {
    const dataset = [
      buildSessionRow(9, startedAt),
      buildSessionRow(8, startedAt),
      buildSessionRow(7, earlierAt),
    ];
    const { service, spaceSession } = buildService(dataset);

    const result = await service.listSpaceSessions(user, 7, {
      status: 'active',
      page: 2,
      pageSize: 2,
    });

    const listArgs = spaceSession.findMany.mock.calls[0][0] as FakeListArgs;
    expect(listArgs.skip).toBe(2);
    expect(listArgs.take).toBe(2);
    expect(result.items.map((item) => item.id)).toEqual(['7']);
    // 2 + 1 >= 3
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
  });

  it('游标路径：不传 skip、多取一行探测、COUNT 不带游标条件', async () => {
    const dataset = [
      buildSessionRow(9, startedAt),
      buildSessionRow(8, startedAt),
      buildSessionRow(7, earlierAt),
    ];
    const { service, spaceSession } = buildService(dataset);

    const result = await service.listSpaceSessions(user, 7, {
      status: 'active',
      pageSize: 1,
      cursor: encodeCursor({ keys: [startedAt.getTime()], id: 9 }),
    });

    const listArgs = spaceSession.findMany.mock.calls[0][0] as FakeListArgs;
    expect(listArgs.skip).toBeUndefined();
    expect(listArgs.take).toBe(2);
    expect(listArgs.where.AND?.[1]).toEqual({
      OR: [
        { startTime: { lt: startedAt } },
        { startTime: startedAt, id: { lt: 9 } },
      ],
    });
    // total 恒为全量口径：COUNT 的 where 与列表的筛选条件完全一致，且不含游标分支
    const countArgs = spaceSession.count.mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(countArgs.where).toEqual(listArgs.where.AND?.[0]);
    expect(JSON.stringify(countArgs.where)).not.toContain('"lt"');
    expect(result.meta.total).toBe(3);
    expect(result.items).toHaveLength(1);
    expect(result.hasMore).toBe(true);
    expect(decodeCursor(result.nextCursor)?.id).toBe(8);
  });

  it('相同 startTime 的多条会话按 id 兜底翻页：不漏不重且末页到底', async () => {
    // 3 条同 startTime + 2 条更早，共 5 条；pageSize=2 => 3 页
    const dataset = [
      buildSessionRow(3, startedAt),
      buildSessionRow(2, startedAt),
      buildSessionRow(1, startedAt),
      buildSessionRow(8, earlierAt),
      buildSessionRow(7, earlierAt),
    ];
    const { service } = buildService(dataset);

    const first = await service.listSpaceSessions(user, 7, {
      status: 'active',
      pageSize: 2,
    });
    const second = await service.listSpaceSessions(user, 7, {
      status: 'active',
      pageSize: 2,
      cursor: first.nextCursor ?? undefined,
    });
    const third = await service.listSpaceSessions(user, 7, {
      status: 'active',
      pageSize: 2,
      cursor: second.nextCursor ?? undefined,
    });

    expect(
      [...first.items, ...second.items, ...third.items].map((item) => item.id),
    ).toEqual(['3', '2', '1', '8', '7']);
    expect(first.hasMore).toBe(true);
    expect(second.hasMore).toBe(true);
    expect(third.hasMore).toBe(false);
    expect(third.nextCursor).toBeNull();
    // total 不随翻页变化
    expect(third.meta.total).toBe(5);
  });

  it('非法 cursor 抛 400，且不查会话列表', async () => {
    const { service, spaceSession } = buildService([]);

    await expect(
      service.listSpaceSessions(user, 7, {
        status: 'active',
        cursor: 'v1:bad',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(spaceSession.findMany).not.toHaveBeenCalled();
    expect(spaceSession.count).not.toHaveBeenCalled();
  });
});

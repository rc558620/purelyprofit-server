// 会员列表游标分页回归：双路径 SQL 形态、缓存边界、非法游标容错
import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { RefreshableCacheService } from '../../../redis/refreshable-cache.service';
import { MembersReadService } from './members-read.service';
import type { MembersAccessService } from './members-access.service';
import {
  decodeCursor,
  encodeCursor,
} from '../../../shared/cursor-pagination.utils';
import { encodeMemberListCursor } from './members.cursor';

const user = {} as AuthenticatedUser;
const createdAt = new Date('2026-11-11T02:00:00.000Z');

/** 合法游标：走真实编码器，保证与实现同源（createdAt + 排序键语义版本） */
const validCursor = (id: number): string =>
  encodeMemberListCursor({ createdAt, id });

/** 原生 SQL 的模板字符串片段（插值参数不在其中） */
const sqlOf = (queryRaw: jest.Mock, callIndex = 0): string =>
  (queryRaw.mock.calls[callIndex][0] as unknown as string[]).join(' ');

/** 作为插值参数传入的 Prisma.Sql 片段（select / join / where 条件都在这里） */
const fragmentsOf = (queryRaw: jest.Mock, callIndex = 0): string =>
  (queryRaw.mock.calls[callIndex].slice(1) as unknown[])
    .filter(
      (value): value is { sql: string } =>
        typeof value === 'object' && value !== null && 'sql' in value,
    )
    .map((value) => value.sql)
    .join(' | ');

const buildMemberRow = (id: number) => ({
  id,
  storeId: 18,
  customerId: null,
  name: `会员-${id}`,
  phone: null,
  gender: null,
  note: null,
  birthday: null,
  beanBalance: 0,
  isPartner: false,
  partnerLevel: null,
  bannedReason: null,
  status: 'active',
  createdAt,
  updatedAt: createdAt,
  customer: null,
});

const buildService = (): {
  service: MembersReadService;
  queryRaw: jest.Mock;
  cache: { getOrLoadRefreshableJson: jest.Mock };
} => {
  const queryRaw = jest.fn();
  const cache = {
    getOrLoadRefreshableJson: jest.fn(
      (options: { loadValue: () => Promise<unknown> }) => options.loadValue(),
    ),
  };
  const configService = {
    get: jest.fn((key: string) => {
      if (key === 'app.defaultPageSize') return 20;
      if (key === 'app.maxPageSize') return 100;
      return undefined;
    }),
  };
  const commerceAccess = {
    resolveMembersViewStoreId: jest.fn().mockResolvedValue(18),
  };

  const service = new MembersReadService(
    { $queryRaw: queryRaw } as unknown as PrismaService,
    commerceAccess as unknown as MembersAccessService,
    configService as unknown as ConfigService,
    cache as unknown as RefreshableCacheService,
  );

  return { service, queryRaw, cache };
};

describe('MembersReadService 游标分页', () => {
  it('offset 兼容路径：单趟窗口计数，hasMore 由 total 推导并产出 nextCursor', async () => {
    const { service, queryRaw, cache } = buildService();
    queryRaw
      .mockResolvedValueOnce([{ ...buildMemberRow(9), _total: 5 }])
      .mockResolvedValueOnce([]);

    const result = await service.list(user, { page: 2, pageSize: 1 });

    expect(sqlOf(queryRaw, 0)).toContain('COUNT(*) OVER()');
    expect(sqlOf(queryRaw, 0)).toContain('OFFSET');
    expect(cache.getOrLoadRefreshableJson).toHaveBeenCalledTimes(1);
    expect(result.meta).toEqual({
      page: 2,
      pageSize: 1,
      total: 5,
      totalPages: 5,
    });
    // 1 + 1 < 5
    expect(result.hasMore).toBe(true);
    expect(decodeCursor(result.nextCursor)?.id).toBe(9);
  });

  it('游标路径：不带窗口计数、多取一行探测、游标条件按 created_at + id 行比较展开', async () => {
    const { service, queryRaw } = buildService();
    const cursor = validCursor(9);
    queryRaw
      .mockResolvedValueOnce([buildMemberRow(4), buildMemberRow(3)])
      .mockResolvedValueOnce([{ total: 7 }])
      .mockResolvedValueOnce([]);

    const result = await service.list(user, { pageSize: 1, cursor });

    // 游标条件会把窗口计数收窄成「剩余条数」，因此游标路径不能用 COUNT(*) OVER()
    expect(sqlOf(queryRaw, 0)).not.toContain('COUNT(*) OVER()');
    expect(sqlOf(queryRaw, 0)).not.toContain('OFFSET');
    const fragments = fragmentsOf(queryRaw, 0);
    // 排序链必须是不可变的 created_at：updated_at 会被 @updatedAt 自动刷新，
    // 一旦回到 updated_at，翻页期间任何编辑都会破坏「不漏不重」
    expect(fragments).toContain('ORDER BY m.created_at DESC, m.id DESC');
    expect(fragments).not.toContain('ORDER BY m.updated_at');
    // 行比较写法：能进索引条件；改回 OR 展开会让深页退化为逐行 Filter
    expect(fragments).toMatch(/\(\s*m\.created_at,\s*m\.id\s*\)\s*</);
    expect(fragments).not.toContain('m.updated_at <');

    // total 取独立 count（全量口径），不受游标影响
    expect(result.meta.total).toBe(7);
    expect(result.items).toHaveLength(1);
    expect(result.hasMore).toBe(true);
    expect(decodeCursor(result.nextCursor)?.id).toBe(4);
  });

  it('游标页不进缓存：同样参数第二次请求仍回源查库', async () => {
    const { service, queryRaw, cache } = buildService();
    const cursor = validCursor(9);
    queryRaw.mockResolvedValue([]);

    await service.list(user, { pageSize: 1, cursor });
    await service.list(user, { pageSize: 1, cursor });

    expect(cache.getOrLoadRefreshableJson).not.toHaveBeenCalled();
    // 每次两趟：列表 + 独立 count；充值记录在空列表时不查
    expect(queryRaw).toHaveBeenCalledTimes(4);
  });

  it('末页探测不足时 nextCursor 为 null', async () => {
    const { service, queryRaw } = buildService();
    const cursor = validCursor(9);
    queryRaw
      .mockResolvedValueOnce([buildMemberRow(1)])
      .mockResolvedValueOnce([{ total: 6 }])
      .mockResolvedValueOnce([]);

    const result = await service.list(user, { pageSize: 2, cursor });

    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
  });

  it('非法 cursor 抛 400，且不查库也不进缓存', async () => {
    const { service, queryRaw, cache } = buildService();

    await expect(
      service.list(user, { cursor: 'v1:broken' }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(queryRaw).not.toHaveBeenCalled();
    expect(cache.getOrLoadRefreshableJson).not.toHaveBeenCalled();
  });

  it('旧语义游标（排序键仍是 updated_at 的单键载荷）一律 400，不静默降级', async () => {
    const { service, queryRaw, cache } = buildService();
    // 排序键换成 created_at 之前，载荷只有 1 个键；把它当 createdAt 用会跳页
    const legacyCursor = encodeCursor({ keys: [createdAt.getTime()], id: 9 });

    await expect(
      service.list(user, { cursor: legacyCursor }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(queryRaw).not.toHaveBeenCalled();
    expect(cache.getOrLoadRefreshableJson).not.toHaveBeenCalled();
  });

  it('排序键语义版本不符的游标一律 400', async () => {
    const { service } = buildService();
    const wrongVersion = encodeCursor({
      keys: [createdAt.getTime(), 1],
      id: 9,
    });

    await expect(
      service.list(user, { cursor: wrongVersion }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('nextCursor 携带 2 个键（createdAt + 语义版本），且能被自身解码', async () => {
    const { service, queryRaw } = buildService();
    const cursor = validCursor(9);
    queryRaw
      .mockResolvedValueOnce([buildMemberRow(4), buildMemberRow(3)])
      .mockResolvedValueOnce([{ total: 7 }])
      .mockResolvedValueOnce([]);

    const result = await service.list(user, { pageSize: 1, cursor });

    const payload = decodeCursor(result.nextCursor);
    expect(payload?.keys).toEqual([createdAt.getTime(), 2]);
    expect(payload?.id).toBe(4);
  });
});

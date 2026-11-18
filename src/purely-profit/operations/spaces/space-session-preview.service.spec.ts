import { NotFoundException } from '@nestjs/common';
import { SpaceBillingMode } from '@prisma/client';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { RefreshableCacheService } from '../../../redis/refreshable-cache.service';
import { buildSpaceLivePreviewCacheKey } from '../../../redis/cache-keys';
import { SpaceSessionPreviewService } from './space-session-preview.service';
import {
  createSpaceSessionRecord,
  createSpaceTestUser,
} from './space-session.spec-helpers';

/** 预览一次调用的缓存契约（只取被测 service 实际使用的字段） */
interface PreviewCacheLoadOptions {
  cacheKey: string;
  ttlSeconds: number;
  refreshAfterMs: number;
  loadValue: () => Promise<Record<string, unknown>>;
}

describe('SpaceSessionPreviewService.getLivePreview（elapsed 分钟桶缓存）', () => {
  const user = createSpaceTestUser();
  const at = (hour: number, minute: number, second: number): number =>
    new Date(2026, 5, 4, hour, minute, second).getTime();

  let service: SpaceSessionPreviewService;
  let nowMs: number;
  let nowSpy: jest.SpyInstance;
  let fullRow: Record<string, unknown>;
  let sessionStatus: string;
  const cacheStore = new Map<string, unknown>();

  const prismaService = {
    spaceSession: { findFirst: jest.fn() },
    clubVoucherOrder: { findFirst: jest.fn() },
  };
  const commerceAccessService = { ensureCanAccessStore: jest.fn() };
  const refreshableCache = {
    getOrLoadRefreshableJson: jest.fn(
      async (options: PreviewCacheLoadOptions): Promise<unknown> => {
        const cached = cacheStore.get(options.cacheKey);
        if (cached !== undefined) {
          return cached;
        }
        const value = await options.loadValue();
        cacheStore.set(options.cacheKey, value);
        return value;
      },
    ),
  };

  /** 计时模式：台位费 60 元/小时 ⇒ 每分钟 1 元，便于断言分钟跳变 */
  const makeTimedRow = (overrides: Record<string, unknown> = {}) => ({
    ...createSpaceSessionRecord(),
    // 默认 10:00 整开台，桶号 = 已过分钟数
    startTime: new Date(2026, 5, 4, 10, 0, 0),
    billingMode: SpaceBillingMode.timed,
    hourlyRate: 6000,
    ...overrides,
  });

  const buildService = (): SpaceSessionPreviewService =>
    new SpaceSessionPreviewService(
      prismaService as unknown as PrismaService,
      commerceAccessService as unknown as CommerceAccessService,
      refreshableCache as unknown as RefreshableCacheService,
    );

  /** 完整查询（含 items / renewRecords）次数 = 实际回源次数 */
  const fullQueryCount = (): number =>
    prismaService.spaceSession.findFirst.mock.calls.filter(
      (call) => !(call[0] as { select?: unknown }).select,
    ).length;

  const setNow = (ms: number): void => {
    nowMs = ms;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    cacheStore.clear();
    nowMs = at(10, 0, 0);
    nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => nowMs);
    sessionStatus = 'active';
    fullRow = makeTimedRow();

    // 轻量前置查询（带 select）返回投影，完整查询返回整行
    prismaService.spaceSession.findFirst.mockImplementation(
      (args: { select?: unknown }) =>
        Promise.resolve(
          args.select
            ? {
                id: fullRow.id,
                storeId: fullRow.storeId,
                startTime: fullRow.startTime,
                status: sessionStatus,
                prepaidVoucherCode: fullRow.prepaidVoucherCode,
              }
            : fullRow,
        ),
    );
    commerceAccessService.ensureCanAccessStore.mockResolvedValue(undefined);
    service = buildService();
  });

  afterEach(() => {
    nowSpy.mockRestore();
  });

  it('同 bucket 内两次调用只回源一次，且金额逐字段相同', async () => {
    setNow(at(10, 0, 20));
    const first = await service.getLivePreview(user, 9);
    setNow(at(10, 0, 50));
    const second = await service.getLivePreview(user, 9);

    expect(fullQueryCount()).toBe(1);
    const { asOf: _firstAsOf, ...firstAmounts } = first;
    const { asOf: _secondAsOf, ...secondAmounts } = second;
    expect(secondAmounts).toEqual(firstAmounts);
    expect(first.durationMinutes).toBe(1);
    expect(first.timeFeeMode).toBe('timed');
  });

  it('缓存参数为 90s TTL + 60s 提前刷新，键带 store/session/bucket 段', async () => {
    setNow(at(10, 0, 20));
    await service.getLivePreview(user, 9);

    expect(refreshableCache.getOrLoadRefreshableJson).toHaveBeenCalledWith(
      expect.objectContaining({
        cacheKey: buildSpaceLivePreviewCacheKey(18, 9, 0),
        ttlSeconds: 90,
        refreshAfterMs: 60_000,
      }),
    );
  });

  it('跨 bucket（59s → 61s）必然回源，durationMinutes 正确 +1', async () => {
    setNow(at(10, 0, 59));
    const first = await service.getLivePreview(user, 9);
    setNow(at(10, 1, 1));
    const second = await service.getLivePreview(user, 9);

    expect(fullQueryCount()).toBe(2);
    expect(first.durationMinutes).toBe(1);
    expect(second.durationMinutes).toBe(2);
    expect(first.timeCost).toBe(1);
    expect(second.timeCost).toBe(2);
    expect(second.totalAmount).toBe(first.totalAmount + 1);
  });

  it('startTime 非整分时自然分钟跨越但 bucket 未变，不得换键或金额跳变', async () => {
    // 10:00:30 开台：10:00:50（elapsed 20s）与 10:01:10（elapsed 40s）
    // 已被自然分钟分隔，但 elapsed 桶同为 0
    fullRow = makeTimedRow({
      startTime: new Date(2026, 5, 4, 10, 0, 30),
    });
    setNow(at(10, 0, 50));
    const first = await service.getLivePreview(user, 9);
    setNow(at(10, 1, 10));
    const second = await service.getLivePreview(user, 9);

    expect(fullQueryCount()).toBe(1);
    const cacheKeys = refreshableCache.getOrLoadRefreshableJson.mock.calls.map(
      (call) => (call[0] as PreviewCacheLoadOptions).cacheKey,
    );
    expect(cacheKeys[0]).toBe(cacheKeys[1]);
    expect(cacheKeys[0]).toContain('bucket:0');
    expect(second.timeCost).toBe(first.timeCost);
    expect(second.durationMinutes).toBe(first.durationMinutes);
  });

  it('写路径失效后同 bucket 立即读到新金额', async () => {
    setNow(at(10, 0, 20));
    const before = await service.getLivePreview(user, 9);

    // 模拟 CacheInvalidatorService.invalidateSpacesReadCaches 的 pattern 清理
    cacheStore.clear();
    fullRow = makeTimedRow({
      sessionItems: [
        {
          id: 1,
          sessionId: 9,
          productId: '201',
          productName: '可乐',
          categoryName: '饮品',
          salePrice: 3000,
          profit: 800,
          quantity: 1,
          sortOrder: 0,
          createdAt: new Date(2026, 5, 4, 9, 0, 0),
        },
      ],
    });

    const after = await service.getLivePreview(user, 9);

    expect(before.itemsCost).toBe(20);
    expect(after.itemsCost).toBe(30);
    expect(after.totalAmount).toBe(before.totalAmount + 10);
  });

  it('asOf 每次都是实时值，缓存体内不保存 asOf', async () => {
    setNow(at(10, 0, 20));
    const first = await service.getLivePreview(user, 9);
    setNow(at(10, 0, 45));
    const second = await service.getLivePreview(user, 9);

    expect(first.asOf).toBe(at(10, 0, 20));
    expect(second.asOf).toBe(at(10, 0, 45));
    expect(second.asOf).toBeGreaterThan(first.asOf);

    const cachedValues = [...cacheStore.values()] as Array<
      Record<string, unknown>
    >;
    expect(cachedValues).toHaveLength(1);
    expect(cachedValues[0]).not.toHaveProperty('asOf');
  });

  it('非 active 会话直接拒绝，不查权限也不进缓存', async () => {
    sessionStatus = 'settled';

    await expect(service.getLivePreview(user, 9)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(commerceAccessService.ensureCanAccessStore).not.toHaveBeenCalled();
    expect(refreshableCache.getOrLoadRefreshableJson).not.toHaveBeenCalled();
  });

  it('前置查询保留软删过滤与最小投影', async () => {
    setNow(at(10, 0, 20));
    await service.getLivePreview(user, 9);

    expect(prismaService.spaceSession.findFirst).toHaveBeenCalledWith({
      where: { id: 9, space: { deletedAt: null } },
      select: {
        id: true,
        storeId: true,
        startTime: true,
        status: true,
        prepaidVoucherCode: true,
      },
    });
  });
});

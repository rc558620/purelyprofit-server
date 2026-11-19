import type { PrismaService } from '../../../prisma/prisma.service';
import { getShanghaiDayStartMs } from '../../../shared/shanghai-time.utils';
import {
  buildCacheRefreshTaskKey,
  buildProfitDashboardHomeActivitiesLiveCacheKey,
  buildProfitDashboardHomeActivitiesStableCacheKey,
} from '../../../redis/keys';
import type { RefreshableCacheService } from '../../../redis/refreshable-cache.service';
import { loadDashboardHomeActivitiesLiveChunk } from './dashboard-home.activities.query';
import { loadDashboardHomeActivitiesStableChunk } from './dashboard-home.activities-stable.query';
import { mergeDashboardHomeActivitiesChunks } from './dashboard-home.query.helpers';
import type {
  DashboardHomeActivitiesData,
  DashboardHomeActivitiesLiveChunk,
  DashboardHomeActivitiesStableChunk,
  LoadDashboardHomeActivitiesDataParams,
} from './dashboard-home.types';

/** 实时块：今天的充值 / 订单 / 会员，商家感知最快，维持 45s 刷新 */
const LIVE_CACHE_TTL_SECONDS = 45;
const LIVE_REFRESH_AFTER_MS = 15_000;

/**
 * 状态块：账款、库存、促销、待办等分钟级变化的数据，5 分钟刷新。
 *
 * 这类数据没有写操作时只随时间漂移（逾期每天新增、客存到期每天临近），
 * 没必要跟着今日订单一起 45s 重算。写操作会显式失效首页缓存，
 * 因此这里的陈旧窗口只影响「纯时间推进」产生的变化。
 */
const STABLE_CACHE_TTL_SECONDS = 300;
const STABLE_REFRESH_AFTER_MS = 120_000;

interface ActivitiesChunkSpec<T> {
  /** 缓存键构造：两块用不同后缀，互不覆盖；必须带业务日，跨零点换键重算 */
  buildCacheKey: (storeId: number, businessDayStart: number) => string;
  ttlSeconds: number;
  refreshAfterMs: number;
  loadValue: (
    prisma: PrismaService,
    params: LoadDashboardHomeActivitiesDataParams,
  ) => Promise<T>;
}

const LIVE_CHUNK_SPEC: ActivitiesChunkSpec<DashboardHomeActivitiesLiveChunk> = {
  buildCacheKey: buildProfitDashboardHomeActivitiesLiveCacheKey,
  ttlSeconds: LIVE_CACHE_TTL_SECONDS,
  refreshAfterMs: LIVE_REFRESH_AFTER_MS,
  loadValue: loadDashboardHomeActivitiesLiveChunk,
};

const STABLE_CHUNK_SPEC: ActivitiesChunkSpec<DashboardHomeActivitiesStableChunk> =
  {
    buildCacheKey: buildProfitDashboardHomeActivitiesStableCacheKey,
    ttlSeconds: STABLE_CACHE_TTL_SECONDS,
    refreshAfterMs: STABLE_REFRESH_AFTER_MS,
    loadValue: loadDashboardHomeActivitiesStableChunk,
  };

export interface LoadDashboardHomeActivitiesCachedParams {
  cache: RefreshableCacheService;
  prisma: PrismaService;
  storeId: number;
  now: number;
  /** true 时跳过读取、直接回源并回写缓存（overview 的 refresh=1 路径） */
  refresh: boolean;
}

/** 单个缓存块：refresh 走「回源 + 回写」，否则读缓存（过期则回源） */
async function resolveActivitiesChunk<T>(
  spec: ActivitiesChunkSpec<T>,
  params: LoadDashboardHomeActivitiesCachedParams,
): Promise<T> {
  const { cache, prisma, storeId, now, refresh } = params;
  // 业务日参与缓存键：零点后自然换键，旧块不再被读到，也不会被后台任务续命
  const businessDayStart = getShanghaiDayStartMs(now);
  const cacheKey = spec.buildCacheKey(storeId, businessDayStart);
  const chunkParams: LoadDashboardHomeActivitiesDataParams = { storeId, now };

  if (refresh) {
    const data = await spec.loadValue(prisma, chunkParams);
    await cache.writeRefreshableJson(
      cacheKey,
      data,
      spec.ttlSeconds,
      spec.refreshAfterMs,
    );
    return data;
  }

  return cache.getOrLoadRefreshableJson({
    cacheKey,
    taskKey: buildCacheRefreshTaskKey(cacheKey),
    ttlSeconds: spec.ttlSeconds,
    refreshAfterMs: spec.refreshAfterMs,
    loadValue: () => spec.loadValue(prisma, chunkParams),
  });
}

/**
 * 读取动态流两块缓存并合并成完整结构。
 *
 * 两块并发读取，只多一次 Redis GET（与另一块的重叠执行），换来的是实时块的
 * 45s 刷新不再拖着 9 条状态类查询一起跑。
 *
 * 注意 stable 必须排在 live 之前：两块都 miss 时，这个顺序保证 SQL 的发起
 * 顺序与分块前一致（先状态类、后今日类），避免打乱既有查询计划与测试桩顺序。
 */
export async function loadDashboardHomeActivitiesChunks(
  params: LoadDashboardHomeActivitiesCachedParams,
): Promise<DashboardHomeActivitiesData> {
  const [stable, live] = await Promise.all([
    resolveActivitiesChunk(STABLE_CHUNK_SPEC, params),
    resolveActivitiesChunk(LIVE_CHUNK_SPEC, params),
  ]);

  return mergeDashboardHomeActivitiesChunks(stable, live);
}

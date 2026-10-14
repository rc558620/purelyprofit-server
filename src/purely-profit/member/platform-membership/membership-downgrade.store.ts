import type { Logger } from '@nestjs/common';
import type { RedisService } from '../../../redis/redis.service';
import { DOWNGRADE_STATE_CACHE_TTL_SECONDS } from './membership-downgrade.constants';
import {
  buildDowngradeStateCacheKey,
  buildManualEntryKey,
  isCompleteDowngradeState,
  ttlUntilNextDay,
} from './membership-downgrade.shared';
import type { StoreDowngradeState } from './membership-downgrade.types';

/**
 * 降级态的 Redis 读写。
 *
 * 单独成文件是为了把「缓存故障一律降级为回源 / 放行」这条策略收敛在一处：
 * 降级态缓存与手动录单计数都不允许因为 Redis 抖动而阻断下单或录单。
 */

/**
 * 读取降级态缓存。
 *
 * 缓存不可用（Redis 故障 / 脏数据）时返回 null 走回源，绝不因缓存问题
 * 影响下单判定。
 */
export async function readDowngradeStateCache(
  redisService: RedisService,
  logger: Logger,
  storeId: number,
): Promise<StoreDowngradeState | null> {
  const cacheKey = buildDowngradeStateCacheKey(storeId);

  try {
    const raw = await redisService.getJson<StoreDowngradeState>(cacheKey);

    return isCompleteDowngradeState(raw) ? raw : null;
  } catch (error) {
    logger.warn(
      `读取会员降级态缓存失败，改为回源：key=${cacheKey}, ` +
        `error=${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

/** 写入降级态缓存；失败仅告警，不影响调用方 */
export async function writeDowngradeStateCache(
  redisService: RedisService,
  logger: Logger,
  storeId: number,
  state: StoreDowngradeState,
): Promise<void> {
  const cacheKey = buildDowngradeStateCacheKey(storeId);

  try {
    await redisService.setJson(
      cacheKey,
      state,
      DOWNGRADE_STATE_CACHE_TTL_SECONDS,
    );
  } catch (error) {
    logger.warn(
      `写入会员降级态缓存失败（不影响本次判定）：key=${cacheKey}, ` +
        `error=${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * 读取今日已手动录单数。
 *
 * Redis 不可用时按 0 处理（即放行）：每日限额是可事后追补的商业控制，
 * 不应因为计数组件故障就阻断商家录单这种直接影响营业的操作。
 */
export async function readManualEntryCount(
  redisService: RedisService,
  logger: Logger,
  storeId: number,
): Promise<number> {
  try {
    const raw = await redisService.getJson<number>(
      buildManualEntryKey(storeId),
    );
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
  } catch (error) {
    logger.warn(
      `读取手动录单计数失败，本次按未超限处理：storeId=${storeId}, ` +
        `error=${error instanceof Error ? error.message : String(error)}`,
    );
    return 0;
  }
}

/**
 * 累加当日手动录单计数。
 *
 * 必须用 Redis INCR 原子递增。
 * 若改回「先 get 再 set」：并发录单时两个请求可能同时读到 3、各自写 4，
 * 结果是实际录了 5 单而计数只有 4 —— 配额被悄悄突破且难以察觉。
 */
export async function incrementManualEntryCount(
  redisService: RedisService,
  storeId: number,
): Promise<void> {
  await redisService.incr(buildManualEntryKey(storeId), ttlUntilNextDay());
}

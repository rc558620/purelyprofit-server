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

/** 额度预占结果：allowed=false 表示已达每日上限，used 为当前已用量 */
export interface ManualEntryQuotaReservation {
  allowed: boolean;
  used: number;
}

/**
 * 「读取 → 判上限 → 递增 → 首次写入时设 TTL」的原子脚本。
 *
 * 为什么必须用 Lua：额度校验与计数递增若分成两次往返（GET 再 INCR），
 * 两个并发录单会同时读到 4、都判定「未超限」，随后各 INCR 一次，
 * 实际录了 6 单而单次判定都认为自己合法——上限被悄悄突破且无日志可查。
 * 放在一个脚本里由 Redis 串行执行，判定与占用之间不存在窗口。
 */
const RESERVE_MANUAL_ENTRY_SCRIPT = `
local used = tonumber(redis.call('GET', KEYS[1]) or '0')
local limit = tonumber(ARGV[1])
if used >= limit then
  return {0, used}
end
local nextValue = redis.call('INCR', KEYS[1])
if nextValue == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[2])
end
return {1, nextValue}
`;

/** 归还一次预占；不降到 0 以下（防止重复归还把额度放大） */
const RELEASE_MANUAL_ENTRY_SCRIPT = `
local used = tonumber(redis.call('GET', KEYS[1]) or '0')
if used <= 0 then
  return 0
end
return redis.call('DECR', KEYS[1])
`;

/**
 * 原子预占一次手动录单额度。
 *
 * 放行即已占用（调用方建单失败必须调用 releaseManualEntryCount 归还），
 * 这样「先占后建」不会出现「订单已落库但额度没涨」的漏记。
 * Redis 不可用时按放行处理：每日限额是可事后追补的商业控制，
 * 不能因为计数组件故障阻断营业（与 readManualEntryCount 同策略）。
 */
export async function reserveManualEntryCount(
  redisService: RedisService,
  logger: Logger,
  storeId: number,
  limit: number,
): Promise<ManualEntryQuotaReservation> {
  const key = buildManualEntryKey(storeId);

  try {
    // 需要「判定 + 递增」原子执行，属于切实需要底层能力的场景，故走 getClient().eval
    const reply: unknown = await redisService
      .getClient()
      .eval(RESERVE_MANUAL_ENTRY_SCRIPT, 1, key, limit, ttlUntilNextDay());
    const [allowedFlag, usedValue] = Array.isArray(reply) ? reply : [];
    return {
      allowed: Number(allowedFlag) === 1,
      used: Number(usedValue ?? 0),
    };
  } catch (error) {
    logger.warn(
      `预占手动录单额度失败，本次按未超限处理：storeId=${storeId}, ` +
        `error=${error instanceof Error ? error.message : String(error)}`,
    );
    return { allowed: true, used: 0 };
  }
}

/** 归还一次预占（建单事务失败 / 命中幂等回放时调用）；失败仅告警 */
export async function releaseManualEntryCount(
  redisService: RedisService,
  logger: Logger,
  storeId: number,
): Promise<void> {
  const key = buildManualEntryKey(storeId);

  try {
    await redisService.getClient().eval(RELEASE_MANUAL_ENTRY_SCRIPT, 1, key);
  } catch (error) {
    logger.warn(
      `归还手动录单额度失败（额度可能偏紧，次日自动重置）：storeId=${storeId}, ` +
        `error=${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

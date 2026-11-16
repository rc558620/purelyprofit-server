import type { Logger } from '@nestjs/common';
import type {
  DistributedLock,
  RedisLockService,
} from '../../redis/redis-lock.service';

/**
 * 跨 worker 缓存回源单飞（read-through singleflight）。
 *
 * 背景：`RefreshableCacheService` 与各 club 缓存自带的 inflight Map 只能做到
 * **进程内**去重，4 个 worker 在缓存冷启动/过期瞬间仍会各打一次回源。对两类
 * 资源代价最大：
 *  - 微信 `cgi-bin/token`：有频率限制，且各 worker 会互相覆盖刚写入的缓存；
 *  - 邀请码全量映射：未命中时是全表 `findMany`。
 *
 * 协议（用 Redis SETNX+EX 短租约做互斥）：
 *  1. 抢到租约 → 先**双检缓存**（别的 worker 可能刚写完）→ 再回源并发布；
 *  2. 抢不到 → 退避轮询缓存若干次（预算由调用方给定）→ 命中即用；
 *     预算耗尽则**兜底直连回源**，绝不把请求挂死；
 *  3. 任何锁异常（Redis 断连、命令超时、释放失败）→ 直接回源，
 *     行为与「没有单飞」时完全一致。
 *
 * 降级底线：调用方（登录、邀请码解析）在**任何**锁异常下都必须成功返回，
 * 本文件所有 Redis 交互都被 try/catch 包裹，只记 warn 不抛错。
 *
 * 租约 value 是 `RedisLockService` 生成的随机 UUID（不是任何凭据），
 * 释放走"校验 token 再删"的 Lua 脚本，避免租约过期后误删他人锁。
 */
export const CLUB_CACHE_LOAD_LOCK_LEASE_SECONDS = 10;

export interface ClubLockedLoadParams<T> {
  /** 锁资源标识，必须收敛到业务资源粒度（如 `...:refresh:<appId>`） */
  lockResource: string;
  /** 重读缓存；返回 null 视为未命中 */
  readCached: () => Promise<T | null>;
  /** 回源并写缓存（与未接入单飞时的实现保持一致） */
  loadAndPublish: () => Promise<T>;
  /** 抢锁失败方的最大轮询次数（0 表示不等待，直接兜底回源） */
  waitAttempts: number;
  /** 抢锁失败方的轮询间隔（毫秒） */
  waitIntervalMs: number;
}

/**
 * 在跨 worker 互斥保护下执行一次「读缓存 → 回源 → 发布」。
 *
 * 返回值语义与直接回源一致（不会因为抢锁失败而返回空）。
 */
export async function runClubLockedLoad<T>(
  lockService: RedisLockService,
  params: ClubLockedLoadParams<T>,
  logger?: Logger,
): Promise<T> {
  const lock = await acquireLockQuietly(
    lockService,
    params.lockResource,
    logger,
  );
  if (!lock) {
    const waited = await waitForCachedValue(params, logger);
    if (waited !== null) {
      return waited;
    }
    // 兜底直连：宁可多打一次回源，也不让用户等到超时
    return params.loadAndPublish();
  }

  try {
    // 双检：拿到锁之前可能已有别的 worker 完成回源并写入
    const cached = await readCachedQuietly(params.readCached, logger);
    if (cached !== null) {
      return cached;
    }
    return await params.loadAndPublish();
  } finally {
    await releaseLockQuietly(lockService, lock, logger);
  }
}

/** 抢租约：任何异常都视为「没抢到」，交由调用方走等待/兜底路径。 */
async function acquireLockQuietly(
  lockService: RedisLockService,
  lockResource: string,
  logger?: Logger,
): Promise<DistributedLock | null> {
  try {
    return await lockService.acquireLock(lockResource, {
      ttlSeconds: CLUB_CACHE_LOAD_LOCK_LEASE_SECONDS,
    });
  } catch (error) {
    logger?.warn(
      `[club-cache-lock] 抢租约异常，直接回源 resource=${lockResource}: ${toMessage(error)}`,
    );
    return null;
  }
}

/** 读缓存：异常按未命中处理。 */
async function readCachedQuietly<T>(
  readCached: () => Promise<T | null>,
  logger?: Logger,
): Promise<T | null> {
  try {
    return await readCached();
  } catch (error) {
    logger?.warn(
      `[club-cache-lock] 重读缓存异常，按未命中处理: ${toMessage(error)}`,
    );
    return null;
  }
}

/** 抢锁失败方：退避轮询缓存，返回首个命中的值。 */
async function waitForCachedValue<T>(
  params: ClubLockedLoadParams<T>,
  logger?: Logger,
): Promise<T | null> {
  for (let attempt = 0; attempt < params.waitAttempts; attempt += 1) {
    if (params.waitIntervalMs > 0) {
      await sleep(params.waitIntervalMs);
    }
    const cached = await readCachedQuietly(params.readCached, logger);
    if (cached !== null) {
      return cached;
    }
  }
  return null;
}

/** 释放租约：失败只意味着它会被 TTL 自然回收，不影响本次返回。 */
async function releaseLockQuietly(
  lockService: RedisLockService,
  lock: DistributedLock,
  logger?: Logger,
): Promise<void> {
  try {
    await lockService.releaseLock(lock);
  } catch (error) {
    logger?.warn(
      `[club-cache-lock] 释放租约异常 resource=${lock.resource}: ${toMessage(error)}`,
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

import type {
  DistributedLock,
  RedisLockService,
} from '../../../redis/redis-lock.service';

/**
 * 门店自动结账分布式锁 TTL（秒）= 120s。
 *
 * 单店是「串行逐会话」处理（不并发化：同一门店内多会话并发会争用 Prisma
 * 连接、并在门店级统计/交班写入上互相踩踏），因此最坏耗时随会话数线性增长：
 * 每个会话上限 ≈ 会话锁 60s（> TX_TIMEOUT_LONG 30s）+ 明细查询与写回。
 * 30s 只够 1 个会话跑完，多会话时锁会在处理中过期 → 双 worker 同时处理
 * 同一门店（此时只有会话锁/行锁兜底，门店级扫描会重复回源）。
 * 取 120s 覆盖「数个会话 + 单会话事务打满」的耗时上限。
 */
export const AUTO_CHECKOUT_STORE_LOCK_TTL_SECONDS = 120;

/**
 * 会话认领标记 TTL（秒）= 120s。
 *
 * 语义是「这一轮由我负责结这个会话」：与门店锁同量级，保证即使进程在结账
 * 中途失联，标记也会随门店锁窗口一起自然过期，不会永久占死该会话。
 */
export const AUTO_CHECKOUT_SESSION_CLAIM_TTL_SECONDS = 120;

/** 门店锁资源标识（与历史键保持一致，避免滚动发布期间互不互斥） */
export function buildAutoCheckoutStoreLockResource(storeId: number): string {
  return `space:auto-checkout:store:${storeId}`;
}

/** 会话认领资源标识：按会话粒度，混入门店会导致同店互斥过度 */
export function buildAutoCheckoutSessionClaimResource(
  sessionId: number,
): string {
  return `space:auto-checkout:claim:${sessionId}`;
}

/**
 * 尝试认领单个会话。
 *
 * 返回 null 表示「另一路调度正在结这个会话」，调用方必须跳过而不是重试：
 * 重试会把串行处理退化成等待，且对方结完账后本路会读到已结账状态。
 */
export async function claimAutoCheckoutSession(
  lockService: RedisLockService,
  sessionId: number,
): Promise<DistributedLock | null> {
  return lockService.acquireLock(
    buildAutoCheckoutSessionClaimResource(sessionId),
    { ttlSeconds: AUTO_CHECKOUT_SESSION_CLAIM_TTL_SECONDS },
  );
}

/**
 * 释放会话认领。
 *
 * 复用 `RedisLockService.releaseLock`（Lua 校验 token 后删除），
 * 不手写 SET NX / DEL，避免误删他人持有的认领标记。
 */
export async function releaseAutoCheckoutSessionClaim(
  lockService: RedisLockService,
  lock: DistributedLock,
): Promise<void> {
  await lockService.releaseLock(lock);
}

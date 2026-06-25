import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { RedisService } from './redis.service';

/**
 * 分布式锁持有凭证
 */
export interface DistributedLock {
  /** 锁资源标识 */
  resource: string;
  /** 锁持有 token（用于释放时校验所有权） */
  token: string;
  /** 锁 Key */
  readonly key: string;
}

/**
 * 分布式锁配置
 */
export interface AcquireLockOptions {
  /** 锁超时时间（秒），防止死锁 */
  ttlSeconds: number;
  /** 获取锁失败时的重试次数 */
  retryTimes?: number;
  /** 重试间隔（毫秒） */
  retryDelayMs?: number;
}

/**
 * Redis 分布式锁服务
 *
 * 功能：
 * - 基于 Redis SETNX + TTL 实现分布式互斥锁
 * - 使用 Lua 脚本原子释放锁（防止误删他人持有的锁）
 * - 支持重试获取锁
 * - 提供 withLock 装饰器风格接口
 *
 * 适用场景：
 * - 空间开台并发控制
 * - 交班记录并发创建
 * - 定时任务多实例互斥
 */
@Injectable()
export class RedisLockService {
  private readonly logger = new Logger(RedisLockService.name);
  private readonly lockKeyPrefix = 'distributed-lock';

  constructor(private readonly redisService: RedisService) {}

  /**
   * 尝试获取分布式锁
   *
   * @param resource 锁资源标识（如 'space:session:open:123'）
   * @param options 锁配置
   * @returns 锁持有凭证，获取失败时返回 null
   *
   * @example
   * ```typescript
   * const lock = await redisLockService.acquireLock('space:session:open:7', {
   *   ttlSeconds: 10,
   *   retryTimes: 3,
   *   retryDelayMs: 50,
   * });
   *
   * if (!lock) {
   *   throw new ConflictException('当前资源正在被操作，请稍后重试');
   * }
   *
   * try {
   *   // 执行业务逻辑
   * } finally {
   *   await redisLockService.releaseLock(lock);
   * }
   * ```
   */
  async acquireLock(
    resource: string,
    options: AcquireLockOptions,
  ): Promise<DistributedLock | null> {
    const { ttlSeconds, retryTimes = 0, retryDelayMs = 50 } = options;
    const token = randomUUID();
    const key = this.buildLockKey(resource);

    let attempt = 0;
    const maxAttempts = retryTimes + 1;

    while (attempt < maxAttempts) {
      const acquired = await this.redisService.setIfAbsent(
        key,
        token,
        ttlSeconds,
      );

      if (acquired) {
        return {
          resource,
          token,
          key,
        };
      }

      attempt += 1;

      if (attempt < maxAttempts && retryDelayMs > 0) {
        await this.sleep(retryDelayMs);
      }
    }

    this.logger.warn(
      `[redis-lock] acquire failed resource=${resource} attempts=${maxAttempts} ttlSeconds=${ttlSeconds}`,
    );

    return null;
  }

  /**
   * 释放分布式锁
   *
   * 使用 Lua 脚本确保：
   * 1. 只有持有锁的 token 才能释放
   * 2. 校验与删除是原子操作，防止竞态
   *
   * @param lock 锁持有凭证
   */
  async releaseLock(lock: DistributedLock): Promise<void> {
    try {
      const deleted = (await this.redisService
        .getClient()
        .eval(
          this.buildReleaseLockScript(),
          1,
          lock.key,
          lock.token,
        )) as number;

      if (deleted === 0) {
        this.logger.warn(
          `[redis-lock] release mismatch or expired resource=${lock.resource} token=${lock.token}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `[redis-lock] release failed resource=${lock.resource} reason=${
          error instanceof Error ? error.message : 'UnknownError'
        }`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /**
   * 在锁保护下执行业务逻辑（装饰器风格）
   *
   * 优点：
   * - 自动获取锁 + 执行 + 释放锁
   * - 异常安全：即使业务逻辑抛异常，锁也会被释放
   * - 支持泛型返回值
   *
   * @param resource 锁资源标识
   * @param options 锁配置
   * @param fn 业务逻辑函数
   * @returns 业务逻辑返回值
   * @throws ConflictException 获取锁失败时抛出
   *
   * @example
   * ```typescript
   * const session = await redisLockService.withLock(
   *   `space:session:open:${spaceId}`,
   *   { ttlSeconds: 10, retryTimes: 3 },
   *   async () => {
   *     // 在锁保护下执行开台逻辑
   *     return this.createSpaceSession(spaceId, dto);
   *   },
   * );
   * ```
   */
  async withLock<T>(
    resource: string,
    options: AcquireLockOptions,
    fn: () => Promise<T>,
  ): Promise<T> {
    const lock = await this.acquireLock(resource, options);

    if (!lock) {
      throw new Error(
        `无法获取分布式锁: ${resource}。资源可能正在被其他操作使用，请稍后重试。`,
      );
    }

    try {
      return await fn();
    } finally {
      await this.releaseLock(lock);
    }
  }

  /**
   * 构建锁 Key
   */
  private buildLockKey(resource: string): string {
    return `${this.lockKeyPrefix}:${resource}`;
  }

  /**
   * Lua 脚本：原子释放锁
   *
   * 逻辑：
   * 1. 检查 Key 存在且值等于 token
   * 2. 删除 Key
   * 3. 返回删除数量（1 表示成功，0 表示锁已过期或被他人持有）
   */
  private buildReleaseLockScript(): string {
    return `
      if redis.call('GET', KEYS[1]) == ARGV[1] then
        return redis.call('DEL', KEYS[1])
      end
      return 0
    `;
  }

  /**
   * 延迟工具函数
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

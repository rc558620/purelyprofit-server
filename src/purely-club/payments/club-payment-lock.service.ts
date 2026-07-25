import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';

const CLUB_PAYMENT_LOCK_KEY_PREFIX = 'club:payment:lock:';
const CLUB_PAYMENT_LOCK_TTL_SECONDS = 30;

/**
 * 基于 Redis SET NX EX 的简单分布式锁，用于防止同一笔订单被并发回调 / 重复 confirm 重复落账。
 *
 * 锁粒度：per orderNo
 * 过期时间：30 秒（远超一次正常落账耗时的上限，防止死锁）
 *
 * 安全机制：
 *   - acquireLock 写入时以唯一 token 为值，releaseLock 仅在值匹配时删除（Lua 原子操作）
 *   - 防止 TTL 过期后请求 A 误释放请求 B 的锁
 */
@Injectable()
export class ClubPaymentLockService {
  private readonly logger = new Logger(ClubPaymentLockService.name);

  constructor(private readonly redisService: RedisService) {}

  /**
   * 尝试获取支付落账锁。
   * @returns 锁的 token（用于后续安全释放），若获取失败返回 null
   */
  async acquireLock(orderNo: string): Promise<string | null> {
    const key = `${CLUB_PAYMENT_LOCK_KEY_PREFIX}${orderNo}`;
    const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const result = await this.redisService
      .getClient()
      .set(key, token, 'EX', CLUB_PAYMENT_LOCK_TTL_SECONDS, 'NX');

    return result === 'OK' ? token : null;
  }

  /**
   * 安全释放支付落账锁。
   * 仅当锁的值与当前请求持有的 token 一致时才删除（Lua 原子操作），防止误释放他人锁。
   * 即使释放失败也不影响正确性（锁会在 TTL 后自动过期）。
   */
  async withOrderLock<T>(
    orderNo: string,
    callback: () => Promise<T>,
  ): Promise<T> {
    const token = await this.acquireLock(orderNo);
    if (!token) throw new Error(`支付订单正在处理中: ${orderNo}`);
    try {
      return await callback();
    } finally {
      await this.releaseLock(orderNo, token);
    }
  }

  async releaseLock(orderNo: string, token: string): Promise<void> {
    const key = `${CLUB_PAYMENT_LOCK_KEY_PREFIX}${orderNo}`;

    // Lua 脚本：仅当 key 存在且值等于 token 时才删除，保证原子性
    const luaScript = `
      if redis.call("GET", KEYS[1]) == ARGV[1] then
        return redis.call("DEL", KEYS[1])
      else
        return 0
      end
    `;

    try {
      const result = await this.redisService
        .getClient()
        .eval(luaScript, 1, key, token);

      if (result !== 1) {
        this.logger.warn(
          `释放支付锁跳过: orderNo=${orderNo}，锁已被其他请求持有或已过期（token 不匹配）`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `释放支付锁异常: orderNo=${orderNo}，锁将在 TTL 后自动过期`,
        error,
      );
    }
  }
}

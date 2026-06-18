import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';

const CLUB_PAYMENT_LOCK_KEY_PREFIX = 'club:payment:lock:';
const CLUB_PAYMENT_LOCK_TTL_SECONDS = 30;

/**
 * 基于 Redis SET NX EX 的简单分布式锁，用于防止同一笔订单被并发回调 / 重复 confirm 重复落账。
 *
 * 锁粒度：per orderId
 * 过期时间：30 秒（远超一次正常落账耗时的上限，防止死锁）
 */
@Injectable()
export class ClubPaymentLockService {
  private readonly logger = new Logger(ClubPaymentLockService.name);

  constructor(private readonly redisService: RedisService) {}

  /**
   * 尝试获取支付落账锁。
   * @returns true 表示获取成功，false 表示锁已被占用（即已有并发请求在处理）
   */
  async acquireLock(orderId: string): Promise<boolean> {
    const key = `${CLUB_PAYMENT_LOCK_KEY_PREFIX}${orderId}`;
    const result = await this.redisService
      .getClient()
      .set(key, `${Date.now()}`, 'EX', CLUB_PAYMENT_LOCK_TTL_SECONDS, 'NX');
    return result === 'OK';
  }

  /**
   * 释放支付落账锁。
   * 即使释放失败也不影响正确性（锁会在 TTL 后自动过期）。
   */
  async releaseLock(orderId: string): Promise<void> {
    try {
      await this.redisService.del(`${CLUB_PAYMENT_LOCK_KEY_PREFIX}${orderId}`);
    } catch (error) {
      this.logger.warn(
        `释放支付锁失败: orderId=${orderId}，锁将在 TTL 后自动过期`,
        error,
      );
    }
  }
}

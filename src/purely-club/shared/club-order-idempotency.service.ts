import { Injectable } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';

/**
 * 下单幂等键最小长度。
 *
 * 太短的键很容易被不同请求「撞」在一起（例如前端直接用订单类型当键），
 * 撞了会把别人的订单当成自己的返回，宁可判定为「不带幂等键」。
 */
const MIN_IDEMPOTENCY_KEY_LENGTH = 8;

/**
 * 下单幂等键默认 TTL（秒）：与团购券 / 服务订单草稿的 15 分钟支付窗口对齐。
 */
const DEFAULT_IDEMPOTENCY_TTL_SECONDS = 15 * 60;

/**
 * 服务订单 / 团购券订单的幂等键缓存。
 *
 * 两条链路的状态存放位置不同（服务订单在 Redis 草稿、团购券订单在 DB），
 * 但「同一用户 + 同一幂等键只允许建一单」的判定可以共用这份 Redis 记录：
 * key → orderNo，重复提交时直接命中已建订单号。
 *
 * 设计上是**可选**的：请求头缺失或格式不合法时直接跳过幂等，
 * 保证尚未适配的新老前端都不会因为缺少请求头而无法下单。
 */
@Injectable()
export class ClubOrderIdempotencyService {
  constructor(private readonly redisService: RedisService) {}

  /** 规整幂等键：空白、过短、超长一律视为无效（null = 不做幂等） */
  normalizeKey(raw: string | undefined): string | null {
    const key = raw?.trim();
    if (!key || key.length < MIN_IDEMPOTENCY_KEY_LENGTH || key.length > 128) {
      return null;
    }
    return key;
  }

  /** 该幂等键此前已创建过的订单号（没有则 null） */
  async findOrderNo(params: {
    scope: string;
    userId: number;
    key: string;
  }): Promise<string | null> {
    return this.redisService.get(this.buildKey(params));
  }

  /**
   * 占位：成功返回 null；已被占用则返回已存在的订单号。
   *
   * 返回订单号说明这是一次重复提交（可能是并发双击），调用方应当直接
   * 复用那笔订单，而不是再建一单、再扣一次新客额度。
   */
  async reserve(params: {
    scope: string;
    userId: number;
    key: string;
    orderNo: string;
  }): Promise<string | null> {
    const created = await this.redisService.setIfAbsent(
      this.buildKey(params),
      params.orderNo,
      DEFAULT_IDEMPOTENCY_TTL_SECONDS,
    );

    if (created) {
      return null;
    }

    return this.redisService.get(this.buildKey(params));
  }

  /** 建单失败时释放占位，让用户可以用同一个键重新提交 */
  async release(params: {
    scope: string;
    userId: number;
    key: string;
  }): Promise<void> {
    await this.redisService.del(this.buildKey(params));
  }

  private buildKey(params: {
    scope: string;
    userId: number;
    key: string;
  }): string {
    return `club:order:idem:${params.scope}:${params.userId}:${params.key}`;
  }
}

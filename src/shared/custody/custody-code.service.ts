// 客存验证码服务：取件码 / 核销预留令牌的签发与消费，以及核销失败计数锁，统一走 Redis
import { randomBytes, randomInt } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';
import {
  CODE_ISSUE_MAX_RETRY,
  CONFIRM_FAIL_MAX_ATTEMPTS,
  CONFIRM_FAIL_WINDOW_TTL_SECONDS,
  CUSTODY_CODE_LENGTH,
  CUSTODY_CONFIRM_FAIL_KEY_PREFIX,
  CUSTODY_PICKUP_CODE_KEY_PREFIX,
  CUSTODY_PICKUP_ORDER_KEY_PREFIX,
  CUSTODY_SUMMARY_CACHE_TTL_SECONDS,
  CUSTODY_SUMMARY_KEY_PREFIX,
  CUSTODY_VERIFY_TOKEN_KEY_PREFIX,
  PICKUP_CODE_TTL_SECONDS,
  VERIFY_TOKEN_LENGTH,
  VERIFY_TOKEN_TTL_SECONDS,
} from './custody-code.constants';
import type {
  CustodyPickupCodePayload,
  CustodyVerifyTokenPayload,
  IssuedShortCode,
} from './custody-code.types';

/** 生成指定长度的纯数字短码（门店与会员均通过数字键盘输入） */
function generateNumericCode(length: number): string {
  let code = '';
  for (let index = 0; index < length; index += 1) {
    code += String(randomInt(0, 10));
  }
  return code;
}

@Injectable()
export class CustodyCodeService {
  private readonly logger = new Logger(CustodyCodeService.name);

  constructor(private readonly redisService: RedisService) {}

  /** 读取取件码载荷（不消费） */
  peekPickupCode(code: string): Promise<CustodyPickupCodePayload | null> {
    return this.redisService.getJson<CustodyPickupCodePayload>(
      this.buildPickupKey(code),
    );
  }

  /**
   * 核销前判断锁：连续失败达到阈值时拒绝继续校验，避免暴力枚举 6 位取件码。
   *
   * @throws BadRequest 由调用方根据返回值决定，此处只返回是否被锁
   */
  async isConfirmFailLocked(
    storeId: number,
    staffId: number,
  ): Promise<boolean> {
    return this.isFailLocked(this.buildFailKey(storeId, staffId));
  }

  /** 累加核销失败计数：首次创建时设置窗口 TTL */
  async registerConfirmFailure(
    storeId: number,
    staffId: number,
  ): Promise<void> {
    await this.redisService.incr(
      this.buildFailKey(storeId, staffId),
      CONFIRM_FAIL_WINDOW_TTL_SECONDS,
    );
  }

  /** 清除核销失败计数（校验成功后调用） */
  async clearConfirmFailures(storeId: number, staffId: number): Promise<void> {
    await this.redisService.del(this.buildFailKey(storeId, staffId));
  }

  /** 签发取件码（1 分钟内有效，同一存单重复签发会覆盖上一枚） */
  async issuePickupCode(
    payload: CustodyPickupCodePayload,
  ): Promise<IssuedShortCode> {
    return this.issueShortCode(
      CUSTODY_PICKUP_CODE_KEY_PREFIX,
      PICKUP_CODE_TTL_SECONDS,
      payload,
    );
  }

  /** 消费取件码：原子读取并删除，作为核销幂等 token */
  consumePickupCode(code: string): Promise<CustodyPickupCodePayload | null> {
    return this.redisService.getJsonAndDelete<CustodyPickupCodePayload>(
      this.buildPickupKey(code),
    );
  }

  /** 取消取件码：客户主动作废尚未核销的码 */
  async cancelPickupCode(code: string): Promise<void> {
    await this.redisService.del(this.buildPickupKey(code));
  }

  /** 绑定取件码与存单：支持客户取消与覆盖签发 */
  async bindPickupCode(
    custodyOrderId: number,
    issued: IssuedShortCode,
  ): Promise<void> {
    await this.redisService.setJson(
      `${CUSTODY_PICKUP_ORDER_KEY_PREFIX}${custodyOrderId}`,
      issued,
      PICKUP_CODE_TTL_SECONDS,
    );
  }

  /** 读取存单当前取件码绑定（已过期返回 null） */
  readPickupCodeBinding(
    custodyOrderId: number,
  ): Promise<IssuedShortCode | null> {
    return this.redisService.getJson<IssuedShortCode>(
      `${CUSTODY_PICKUP_ORDER_KEY_PREFIX}${custodyOrderId}`,
    );
  }

  /** 解除存单取件码绑定 */
  async unbindPickupCode(custodyOrderId: number): Promise<void> {
    await this.redisService.del(
      `${CUSTODY_PICKUP_ORDER_KEY_PREFIX}${custodyOrderId}`,
    );
  }

  /** 签发核销预留令牌：确认取出阶段凭此令牌做二次校验，避免取件码被重复核销 */
  async issueVerifyToken(
    pickupCode: string,
    payload: Omit<CustodyVerifyTokenPayload, 'pickupCode'>,
  ): Promise<string> {
    const token = randomBytes(VERIFY_TOKEN_LENGTH).toString('hex');
    await this.redisService.setJson(
      `${CUSTODY_VERIFY_TOKEN_KEY_PREFIX}${token}`,
      { ...payload, pickupCode } satisfies CustodyVerifyTokenPayload,
      VERIFY_TOKEN_TTL_SECONDS,
    );
    return token;
  }

  /** 消费核销预留令牌：原子读取并删除，重复提交只可能成功一次 */
  consumeVerifyToken(token: string): Promise<CustodyVerifyTokenPayload | null> {
    return this.redisService.getJsonAndDelete<CustodyVerifyTokenPayload>(
      `${CUSTODY_VERIFY_TOKEN_KEY_PREFIX}${token}`,
    );
  }

  /** 失效门店统计缓存：任何客存写操作后都必须调用 */
  async invalidateSummaryCache(storeId: number): Promise<void> {
    await this.redisService.del(`${CUSTODY_SUMMARY_KEY_PREFIX}${storeId}`);
  }

  /** 读取门店统计缓存（未命中返回 null） */
  readSummaryCache<T>(storeId: number): Promise<T | null> {
    return this.redisService.getJson<T>(
      `${CUSTODY_SUMMARY_KEY_PREFIX}${storeId}`,
    );
  }

  /** 写入门店统计缓存 */
  async writeSummaryCache<T>(storeId: number, summary: T): Promise<void> {
    await this.redisService.setJson(
      `${CUSTODY_SUMMARY_KEY_PREFIX}${storeId}`,
      summary,
      CUSTODY_SUMMARY_CACHE_TTL_SECONDS,
    );
  }

  private buildPickupKey(code: string): string {
    return `${CUSTODY_PICKUP_CODE_KEY_PREFIX}${code}`;
  }

  private buildFailKey(storeId: number, staffId: number): string {
    return `${CUSTODY_CONFIRM_FAIL_KEY_PREFIX}${storeId}:${staffId}`;
  }

  /** 判定核销失败计数是否达到锁定阈值 */
  private async isFailLocked(key: string): Promise<boolean> {
    const raw = await this.redisService.get(key);
    const attempts = Number.parseInt(raw ?? '0', 10);
    return Number.isFinite(attempts) && attempts >= CONFIRM_FAIL_MAX_ATTEMPTS;
  }

  private async issueShortCode(
    keyPrefix: string,
    ttlSeconds: number,
    payload: CustodyPickupCodePayload,
  ): Promise<IssuedShortCode> {
    for (let attempt = 0; attempt < CODE_ISSUE_MAX_RETRY; attempt += 1) {
      const code = generateNumericCode(CUSTODY_CODE_LENGTH);
      const acquired = await this.redisService.setIfAbsent(
        `${keyPrefix}${code}`,
        JSON.stringify(payload),
        ttlSeconds,
      );
      if (acquired) {
        return { code, expiresAt: this.buildExpireIso(ttlSeconds) };
      }
    }

    this.logger.error(
      '[custody-code] 短码签发耗尽重试次数，疑似 Redis 冲突过高',
    );
    throw new Error('客存短码签发失败，请稍后重试');
  }

  private buildExpireIso(ttlSeconds: number): string {
    return new Date(Date.now() + ttlSeconds * 1000).toISOString();
  }
}

// 客存验证码服务：取件码 / 核销预留令牌的签发与消费，以及核销失败计数锁，统一走 Redis
//
// 同时是客存模块唯一的 Redis 访问出口：门店统计、列表总数、门店快照、门店配置、
// 会员汇总的缓存读写与失效都收在此处，业务侧不直接拼 key。
// 好处是失效矩阵集中在一处可见，新增写路径时不会漏掉某个 key。
import { randomBytes, randomInt } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';
import { safeJsonStringify } from '../../redis/redis-json.util';
import {
  CODE_ISSUE_MAX_RETRY,
  CONFIRM_FAIL_MAX_ATTEMPTS,
  CONFIRM_FAIL_WINDOW_TTL_SECONDS,
  CUSTODY_CODE_LENGTH,
  CUSTODY_CONFIRM_FAIL_KEY_PREFIX,
  CUSTODY_MEMBER_SUMMARY_CACHE_TTL_SECONDS,
  CUSTODY_MEMBER_SUMMARY_KEY_PREFIX,
  CUSTODY_PICKUP_CODE_KEY_PREFIX,
  CUSTODY_PICKUP_ORDER_KEY_PREFIX,
  CUSTODY_SETTINGS_CACHE_TTL_SECONDS,
  CUSTODY_SETTINGS_KEY_PREFIX,
  CUSTODY_STORE_SNAPSHOT_KEY_PREFIX,
  CUSTODY_STORE_SNAPSHOT_TTL_SECONDS,
  CUSTODY_SUMMARY_CACHE_TTL_SECONDS,
  CUSTODY_SUMMARY_KEY_PREFIX,
  CUSTODY_TOTAL_CACHE_TTL_SECONDS,
  CUSTODY_TOTAL_KEY_PREFIX,
  CUSTODY_VERIFY_TOKEN_KEY_PREFIX,
  PICKUP_CODE_TTL_SECONDS,
  VERIFY_TOKEN_LENGTH,
  VERIFY_TOKEN_TTL_SECONDS,
} from './custody-code.constants';
import type {
  CustodyPickupCodePayload,
  CustodyStoreSnapshot,
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

  /** 消费核销预留令牌：原子读取并删除，重复提交只可能成功一次 */
  consumeVerifyToken(token: string): Promise<CustodyVerifyTokenPayload | null> {
    return this.redisService.getJsonAndDelete<CustodyVerifyTokenPayload>(
      `${CUSTODY_VERIFY_TOKEN_KEY_PREFIX}${token}`,
    );
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

  /** 读取门店快照（未命中返回 null） */
  readStoreSnapshot(storeId: number): Promise<CustodyStoreSnapshot | null> {
    return this.redisService.getJson<CustodyStoreSnapshot>(
      `${CUSTODY_STORE_SNAPSHOT_KEY_PREFIX}${storeId}`,
    );
  }

  /** 写入门店快照 */
  async writeStoreSnapshot(
    storeId: number,
    snapshot: CustodyStoreSnapshot,
  ): Promise<void> {
    await this.redisService.setJson(
      `${CUSTODY_STORE_SNAPSHOT_KEY_PREFIX}${storeId}`,
      snapshot,
      CUSTODY_STORE_SNAPSHOT_TTL_SECONDS,
    );
  }

  /** 读取门店客存配置缓存（未命中返回 null） */
  readSettingsCache<T>(storeId: number): Promise<T | null> {
    return this.redisService.getJson<T>(
      `${CUSTODY_SETTINGS_KEY_PREFIX}${storeId}`,
    );
  }

  /** 写入门店客存配置缓存 */
  async writeSettingsCache<T>(storeId: number, settings: T): Promise<void> {
    await this.redisService.setJson(
      `${CUSTODY_SETTINGS_KEY_PREFIX}${storeId}`,
      settings,
      CUSTODY_SETTINGS_CACHE_TTL_SECONDS,
    );
  }

  /** 读取该筛选组合下的列表总数（未命中返回 null） */
  readTotal(storeId: number, filterKey: string): Promise<number | null> {
    return this.redisService.hgetJson<number>(
      `${CUSTODY_TOTAL_KEY_PREFIX}${storeId}`,
      filterKey,
    );
  }

  /** 写入该筛选组合下的列表总数 */
  async writeTotal(
    storeId: number,
    filterKey: string,
    total: number,
  ): Promise<void> {
    await this.redisService.hsetJson(
      `${CUSTODY_TOTAL_KEY_PREFIX}${storeId}`,
      filterKey,
      total,
      CUSTODY_TOTAL_CACHE_TTL_SECONDS,
    );
  }

  /** 读取会员维度汇总缓存（未命中返回 null） */
  readMemberSummary<T>(storeId: number, memberId: number): Promise<T | null> {
    return this.redisService.getJson<T>(
      `${CUSTODY_MEMBER_SUMMARY_KEY_PREFIX}${storeId}:${memberId}`,
    );
  }

  /** 写入会员维度汇总缓存 */
  async writeMemberSummary<T>(
    storeId: number,
    memberId: number,
    summary: T,
  ): Promise<void> {
    await this.redisService.setJson(
      `${CUSTODY_MEMBER_SUMMARY_KEY_PREFIX}${storeId}:${memberId}`,
      summary,
      CUSTODY_MEMBER_SUMMARY_CACHE_TTL_SECONDS,
    );
  }

  /**
   * 客存写操作后的缓存收尾：门店级（统计 + 各筛选组合的总数）、会员级汇总，
   * 以及可选的残留取件码，全部合并为一次 DEL 往返。
   *
   * 分开调用是 3 次串行往返，而核销是高频热路径；且门店级与会员级的失效
   * 本来就该在同一步完成，漏掉会员侧会导致小程序徽标停在旧值。
   *
   * @param params.storeId 门店
   * @param params.memberId 受影响的会员（存单归属）；为 null 表示无人可通知
   * @param params.pickupCode 本次核销掉的取件码（取出后该码必须失效）
   */
  async invalidateAfterWrite(params: {
    storeId: number;
    memberId?: number | null;
    pickupCode?: string | null;
  }): Promise<void> {
    const { storeId, memberId, pickupCode } = params;
    const keys = [
      `${CUSTODY_SUMMARY_KEY_PREFIX}${storeId}`,
      `${CUSTODY_TOTAL_KEY_PREFIX}${storeId}`,
    ];
    if (memberId !== null && memberId !== undefined) {
      keys.push(`${CUSTODY_MEMBER_SUMMARY_KEY_PREFIX}${storeId}:${memberId}`);
    }
    if (pickupCode) {
      keys.push(this.buildPickupKey(pickupCode));
    }
    await this.redisService.delMany(keys);
  }

  /** 配置更新后的缓存收尾：配置缓存本身 + 受配置影响的门店级缓存 */
  async invalidateAfterSettingsUpdate(storeId: number): Promise<void> {
    await this.redisService.delMany([
      `${CUSTODY_SETTINGS_KEY_PREFIX}${storeId}`,
      `${CUSTODY_SUMMARY_KEY_PREFIX}${storeId}`,
      `${CUSTODY_TOTAL_KEY_PREFIX}${storeId}`,
    ]);
  }

  /**
   * 签发核销令牌并清除该店员的失败计数（合并为一次往返）。
   *
   * 两者互不依赖：令牌签发失败不应留下失败计数，计数清除失败也不该让
   * 店员一直被锁。分开 await 是两次串行往返，合并后省掉一次。
   */
  async issueVerifyTokenAndClearFailure(
    storeId: number,
    lockId: number,
    pickupCode: string,
    payload: Omit<CustodyVerifyTokenPayload, 'pickupCode'>,
  ): Promise<string> {
    const token = randomBytes(VERIFY_TOKEN_LENGTH).toString('hex');
    await this.redisService.executePipeline((pipeline) => {
      pipeline.set(
        `${CUSTODY_VERIFY_TOKEN_KEY_PREFIX}${token}`,
        safeJsonStringify({ ...payload, pickupCode }),
        'EX',
        VERIFY_TOKEN_TTL_SECONDS,
      );
      pipeline.del(this.buildFailKey(storeId, lockId));
    });
    return token;
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

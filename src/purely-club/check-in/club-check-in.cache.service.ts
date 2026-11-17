import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';
import {
  buildClubCheckInPromotionCacheKey,
  buildClubCheckInStatusCacheKey,
} from '../../redis/keys/club-cache-keys';
import type { CheckInStatusResponseDto } from './dto/club-check-in.dto';
import type { ClubCheckInPromotionRecord } from './club-check-in.types';

/**
 * 签到活动配置缓存 TTL（秒）。
 *
 * 该配置只在商家端新建 / 编辑 / 启停签到活动时变化，且
 * `invalidateMarketingOverview` 会主动删除本 key，因此 TTL 只作为兜底：
 * 兜底窗口内活动「到点开始 / 到点结束」最多延迟 30s 生效。
 */
const CLUB_CHECK_IN_PROMOTION_CACHE_TTL_SECONDS = 30;

/**
 * 签到状态缓存 TTL（秒）。
 *
 * 只缓存「服务端算好的签到结论」，命中时 `serverTime` 会被覆盖为当前时间：
 *  - `todayCheckedIn` / `checkedDates` / `continuousDays` 只由签到落账改变，
 *    submit 成功后立即删除本 key，不等 TTL；
 *  - `pointsBalance` 会被充值 / 消费改变，由 `invalidateMarketingCustomerDerived`
 *    统一失效（与会员快照同一失效入口）；
 *  - TTL 取 15s 与前端首页页缓存对齐：切 tab 回来仍命中，久了重新回源。
 */
const CLUB_CHECK_IN_STATUS_CACHE_TTL_SECONDS = 15;

/** Date 经 JSON 往返退化为字符串，缓存统一存毫秒时间戳 */
type CachedCheckInPromotionRecord = Omit<
  ClubCheckInPromotionRecord,
  'startAt' | 'endAt'
> & {
  startAt: number;
  endAt: number;
};

/** 显式区分「已确认门店未配置签到活动」与「缓存未命中」，避免空配置反复回源 */
const MISS_SENTINEL = { found: false } as const;

type CachedCheckInPromotionEntry =
  | { found: true; record: CachedCheckInPromotionRecord }
  | typeof MISS_SENTINEL;

/**
 * purely-club 每日签到的读缓存。
 *
 * 首页 Hero 的签到入口每次进场都会请求 `/club/check-in/status`，原实现对
 * 活动配置、顾客档案、签到历史各打一次 DB，等于每次打开首页固定 3 次查询。
 * 本服务只承担缓存读写与降级，不承载签到业务规则：
 *  - 缓存读 / 写异常一律降级回源，缓存不许变成故障点；
 *  - 不缓存「顾客档案」，只缓存已由服务端校验过的状态结论。
 */
@Injectable()
export class ClubCheckInCacheService {
  private readonly logger = new Logger(ClubCheckInCacheService.name);

  constructor(private readonly redisService: RedisService) {}

  /**
   * 读取门店签到活动配置。
   *
   * @returns `undefined` 缓存未命中（需回源）；`null` 已确认门店未配置签到活动；
   *          否则为命中的活动配置
   */
  async readPromotion(
    storeId: number,
  ): Promise<ClubCheckInPromotionRecord | null | undefined> {
    const cacheKey = buildClubCheckInPromotionCacheKey(storeId);
    let cached: CachedCheckInPromotionEntry | null;
    try {
      cached =
        await this.redisService.getJson<CachedCheckInPromotionEntry>(cacheKey);
    } catch (error: unknown) {
      this.logger.warn(
        `读取签到活动缓存失败 cacheKey=${cacheKey}，降级回源: ${this.toMessage(error)}`,
      );
      return undefined;
    }

    return this.toPromotionRecord(cached);
  }

  /** 写入门店签到活动配置（`null` 同样写入哨兵，防止无活动门店反复回源）。 */
  async writePromotion(
    storeId: number,
    record: ClubCheckInPromotionRecord | null,
  ): Promise<void> {
    const cacheKey = buildClubCheckInPromotionCacheKey(storeId);
    const entry: CachedCheckInPromotionEntry = record
      ? {
          found: true,
          record: {
            ...record,
            startAt: record.startAt.getTime(),
            endAt: record.endAt.getTime(),
          },
        }
      : MISS_SENTINEL;

    try {
      await this.redisService.setJson(
        cacheKey,
        entry,
        CLUB_CHECK_IN_PROMOTION_CACHE_TTL_SECONDS,
      );
    } catch (error: unknown) {
      this.logger.warn(
        `写入签到活动缓存失败 cacheKey=${cacheKey}: ${this.toMessage(error)}`,
      );
    }
  }

  /**
   * 一次 MGET 合并读取「签到状态 + 门店签到活动配置」。
   *
   * 两个 key 都可从入参直接算出（无先后依赖），而签到状态请求每次都要用到
   * 至少其中一个：命中状态时只值 1 次往返就返回；未命中时活动配置大概率同轮
   * 命中，省掉一次「先查状态、再查配置」的串行跳数。
   *
   * @returns `status`：命中为 DTO，未命中为 null；
   *          `promotion`：命中为配置（含 null＝确认未配置），未命中为 undefined
   */
  async readStatusAndPromotion(
    storeId: number,
    userId: number,
    checkInDate: string,
  ): Promise<{
    status: CheckInStatusResponseDto | null;
    promotion: ClubCheckInPromotionRecord | null | undefined;
  }> {
    const statusKey = buildClubCheckInStatusCacheKey(
      storeId,
      userId,
      checkInDate,
    );
    const promotionKey = buildClubCheckInPromotionCacheKey(storeId);

    let values: unknown[];
    try {
      values = await this.redisService.mgetJson<unknown>([
        statusKey,
        promotionKey,
      ]);
    } catch (error: unknown) {
      this.logger.warn(
        `读取签到缓存失败 statusKey=${statusKey}，降级回源: ${this.toMessage(error)}`,
      );
      return { status: null, promotion: undefined };
    }

    return {
      status: (values[0] as CheckInStatusResponseDto | null) ?? null,
      promotion: this.toPromotionRecord(
        values[1] as CachedCheckInPromotionEntry | null,
      ),
    };
  }

  /** 把缓存条目还原成活动配置；null 表示未命中，`null` 记录表示确认未配置。 */
  private toPromotionRecord(
    entry: CachedCheckInPromotionEntry | null,
  ): ClubCheckInPromotionRecord | null | undefined {
    if (!entry) {
      return undefined;
    }
    if (!entry.found) {
      return null;
    }

    return {
      ...entry.record,
      startAt: new Date(entry.record.startAt),
      endAt: new Date(entry.record.endAt),
    };
  }

  /** 写入签到状态；失败只影响下次是否命中，不改变本次响应。 */
  async writeStatus(
    storeId: number,
    userId: number,
    checkInDate: string,
    status: CheckInStatusResponseDto,
  ): Promise<void> {
    const cacheKey = buildClubCheckInStatusCacheKey(
      storeId,
      userId,
      checkInDate,
    );
    try {
      await this.redisService.setJson(
        cacheKey,
        status,
        CLUB_CHECK_IN_STATUS_CACHE_TTL_SECONDS,
      );
    } catch (error: unknown) {
      this.logger.warn(
        `写入签到状态缓存失败 cacheKey=${cacheKey}: ${this.toMessage(error)}`,
      );
    }
  }

  /**
   * 删除签到状态缓存（签到落账后调用）。
   *
   * 落账后 `todayCheckedIn` / `continuousDays` / `pointsBalance` 全部变化，
   * 不能等 15s TTL：用户签到成功回到首页必须立刻看到「已签到」。
   */
  async deleteStatus(
    storeId: number,
    userId: number,
    checkInDate: string,
  ): Promise<void> {
    const cacheKey = buildClubCheckInStatusCacheKey(
      storeId,
      userId,
      checkInDate,
    );
    try {
      await this.redisService.del(cacheKey);
    } catch (error: unknown) {
      // 失效失败只影响读加速层，签到已落账，不得改写写操作结果
      this.logger.warn(
        `删除签到状态缓存失败 cacheKey=${cacheKey}: ${this.toMessage(error)}`,
      );
    }
  }

  private toMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}

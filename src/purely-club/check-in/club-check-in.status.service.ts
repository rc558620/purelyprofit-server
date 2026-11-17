import { Injectable, Logger } from '@nestjs/common';
import { formatShanghaiDate } from '../../shared/shanghai-time.utils';
import { normalizeDailyCheckInPoints } from '../../purely-profit/marketing/schemas/promotion-params.schema';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import { ClubCheckInCacheService } from './club-check-in.cache.service';
import { ClubCheckInQueryService } from './club-check-in.query.service';
import type {
  ClubCheckInActivePromotion,
  ClubCheckInPromotionRecord,
} from './club-check-in.types';
import type { CheckInStatusResponseDto } from './dto/club-check-in.dto';
import {
  computeContinuousDays,
  filterRecentMonthDates,
} from './club-check-in.utils';

/**
 * 读取活动 params 中的单次积分：后端权威归一化，
 * 缺失 / 非正整数 / 越界一律回落 1，绝不采信客户端传值。
 */
function readPointsPerCheckIn(params: unknown): number {
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    return normalizeDailyCheckInPoints(undefined);
  }
  return normalizeDailyCheckInPoints(
    (params as Record<string, unknown>).pointsPerCheckIn,
  );
}

/**
 * 每日签到的**读路径**：状态查询 + 活动生效判定。
 *
 * 从 `ClubCheckInService` 拆出的原因：
 *  - 首页 Hero 的签到入口每次进场都会请求状态，读链路（缓存编排 + 状态组装）
 *    与写链路（防抖、事务、落账日志）关注点完全不同；
 *  - 活动生效判定被读路径与提交前校验共用，抽到一处避免两套口径。
 */
@Injectable()
export class ClubCheckInStatusService {
  private readonly logger = new Logger(ClubCheckInStatusService.name);

  constructor(
    private readonly queryService: ClubCheckInQueryService,
    private readonly cacheService: ClubCheckInCacheService,
  ) {}

  /**
   * 签到状态。
   *
   * 原实现固定 3 次 DB 查询（活动配置 + 顾客档案 + 签到历史），冷热路径一致。
   * 现在：状态结论按「门店 + 用户 + 上海自然日」缓存 15s，活动配置另走门店级
   * 缓存，两者用**一次 MGET** 合并读取——命中状态时一次 Redis 往返即返回，
   * 未命中时活动配置大概率同轮命中。命中时只把 `serverTime` 覆盖成当前时间，
   * 前端拿到的服务器时间始终新鲜。签到落账后由写路径删除状态缓存。
   */
  async getStatus(
    context: ClubCurrentContext,
  ): Promise<CheckInStatusResponseDto> {
    const serverTime = Date.now();
    const storeId = context.store.id;
    const checkInDate = formatShanghaiDate(serverTime);
    const userId = context.user.id;

    const { status: cachedStatus, promotion } =
      await this.cacheService.readStatusAndPromotion(
        storeId,
        userId,
        checkInDate,
      );
    if (cachedStatus) {
      return { ...cachedStatus, serverTime };
    }

    const status = await this.buildStatus(
      context,
      serverTime,
      checkInDate,
      promotion,
    );
    // 回填不阻塞本次响应：用户看到的是刚算出的结论，缓存只为下次加速
    void this.cacheService.writeStatus(storeId, userId, checkInDate, status);
    return status;
  }

  /**
   * 活动生效判定：`enabled` + 时间窗双条件。
   *
   * 读路径与提交前校验共用，保证「页面上可签到」与「提交被接受」同一口径。
   */
  resolveActivePromotion(
    promotion: ClubCheckInPromotionRecord | null,
    serverTime: number,
  ): ClubCheckInActivePromotion | null {
    if (!promotion || !promotion.enabled) {
      return null;
    }
    const startAt = promotion.startAt.getTime();
    const endAt = promotion.endAt.getTime();
    if (serverTime < startAt || serverTime > endAt) {
      return null;
    }
    return {
      id: promotion.id,
      startAt,
      endAt,
      pointsPerCheckIn: readPointsPerCheckIn(promotion.params),
    };
  }

  /** 状态本体：仅在缓存未命中时执行，结果由 getStatus 写回缓存。 */
  private async buildStatus(
    context: ClubCurrentContext,
    serverTime: number,
    checkInDate: string,
    prefetchedPromotion?: ClubCheckInPromotionRecord | null,
  ): Promise<CheckInStatusResponseDto> {
    const storeId = context.store.id;
    const [customer, promotion] = await Promise.all([
      this.queryService.findCustomer(context),
      this.queryService.findPromotion(storeId, prefetchedPromotion),
    ]);
    const active = this.resolveActivePromotion(promotion, serverTime);
    const pointsBalance = customer?.points ?? 0;

    if (!active || !customer) {
      const reasons = [
        active ? null : 'activity_inactive',
        customer ? null : 'customer_missing',
      ].filter((reason): reason is string => reason !== null);
      this.logger.warn(
        `签到状态降级空态 storeId=${storeId} reason=${reasons.join(',')}`,
      );
      return this.buildDisabledStatus(pointsBalance, serverTime);
    }

    const checkedDates = await this.queryService.listCheckedDates(
      storeId,
      customer.id,
      this.queryService.buildHistoryFromDate(serverTime),
    );
    const todayCheckedIn = checkedDates.includes(checkInDate);

    return {
      activityEnabled: true,
      activityStartAt: active.startAt,
      activityEndAt: active.endAt,
      todayCheckedIn,
      // 连签必须用完整历史窗口计算：裁剪后的集合会在月初把跨月连签截断
      continuousDays: computeContinuousDays(
        checkedDates,
        checkInDate,
        todayCheckedIn,
      ),
      pointsPerCheckIn: active.pointsPerCheckIn,
      pointsBalance,
      // 下发只保留当前自然月 + 上一个自然月（≤62 条）：
      // 月历只渲染服务端当月，上月用于跨月展示，体积从最多 366 条降到 62 条
      checkedDates: filterRecentMonthDates(checkedDates, serverTime),
      serverTime,
    };
  }

  private buildDisabledStatus(
    pointsBalance: number,
    serverTime: number,
  ): CheckInStatusResponseDto {
    return {
      activityEnabled: false,
      todayCheckedIn: false,
      continuousDays: 0,
      pointsPerCheckIn: 0,
      pointsBalance,
      checkedDates: [],
      serverTime,
    };
  }
}

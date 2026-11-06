import { Injectable, Logger } from '@nestjs/common';
import { PrismaService, TX_TIMEOUT_MEDIUM } from '../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../redis/invalidator';
import { RedisService } from '../../redis/redis.service';
import { formatShanghaiDate } from '../../shared/shanghai-time.utils';
import { normalizeDailyCheckInPoints } from '../../purely-profit/marketing/schemas/promotion-params.schema';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import {
  buildCheckInBusinessError,
  CHECK_IN_ACTIVITY_NOT_ACTIVE_CODE,
  CHECK_IN_ACTIVITY_NOT_FOUND_CODE,
  CHECK_IN_ALREADY_DONE_CODE,
} from './club-check-in.errors';
import { ClubCheckInQueryService } from './club-check-in.query.service';
import type {
  ClubCheckInActivePromotion,
  ClubCheckInCommittedResult,
  ClubCheckInLogEvent,
  ClubCheckInPromotionRecord,
  ClubCheckInSubmitState,
  ClubCheckInWriteInput,
  ClubCheckInWriteResult,
} from './club-check-in.types';
import {
  buildDedupTtlSeconds,
  computeContinuousDays,
  isUniqueViolation,
  readErrorCode,
} from './club-check-in.utils';
import type {
  CheckInResultDto,
  CheckInStatusResponseDto,
} from './dto/club-check-in.dto';

/** 防抖 key 带业务前缀且按自然日隔离；TTL 到当日上海日终，跨日自动失效 */
const CHECK_IN_DEDUP_KEY_PREFIX = 'checkin:dedup:';

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

@Injectable()
export class ClubCheckInService {
  private readonly logger = new Logger('ClubCheckInService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly cacheInvalidatorService: CacheInvalidatorService,
    private readonly queryService: ClubCheckInQueryService,
  ) {}

  async getStatus(
    context: ClubCurrentContext,
  ): Promise<CheckInStatusResponseDto> {
    const serverTime = Date.now();
    const storeId = context.store.id;
    const [customer, promotion] = await Promise.all([
      this.queryService.findCustomer(context),
      this.queryService.findPromotion(storeId),
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

    const checkInDate = formatShanghaiDate(serverTime);
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
      continuousDays: computeContinuousDays(
        checkedDates,
        checkInDate,
        todayCheckedIn,
      ),
      pointsPerCheckIn: active.pointsPerCheckIn,
      pointsBalance,
      checkedDates,
      serverTime,
    };
  }

  async submit(
    context: ClubCurrentContext,
    requestId: string,
  ): Promise<CheckInResultDto> {
    const serverTime = Date.now();
    const state = await this.resolveSubmitState(context, serverTime, requestId);
    const acquired = await this.redisService.setIfAbsent(
      state.dedupKey,
      '1',
      buildDedupTtlSeconds(serverTime),
    );
    if (!acquired) {
      throw buildCheckInBusinessError(CHECK_IN_ALREADY_DONE_CODE);
    }

    const committed = await this.executeCheckInTransaction(
      state,
      context,
      requestId,
      serverTime,
    );
    // 事务已提交：缓存失效只影响读加速层，失败不得改写写操作结果
    await this.invalidateDerivedCacheAfterCommit(state, requestId);
    this.logSubmit({
      requestId,
      storeId: state.storeId,
      customerId: state.customer.id,
      checkInDate: state.checkInDate,
      pointsAwarded: state.awardedPoints,
      result: 'success',
    });
    return {
      checkedInAt: committed.checkedInAt,
      awardedPoints: state.awardedPoints,
      pointsBalance: committed.pointsBalance,
      continuousDays: computeContinuousDays(
        [...committed.previousCheckedDates, state.checkInDate],
        state.checkInDate,
        true,
      ),
      description: state.description,
    };
  }

  /** 事务段：只有这里失败才算签到失败，失败时释放防抖占位 */
  private async executeCheckInTransaction(
    state: ClubCheckInSubmitState,
    context: ClubCurrentContext,
    requestId: string,
    serverTime: number,
  ): Promise<ClubCheckInCommittedResult> {
    try {
      // 事务前取历史日期，事务成功后叠加今日推导连续天数
      const previousCheckedDates = await this.queryService.listCheckedDates(
        state.storeId,
        state.customer.id,
        this.queryService.buildHistoryFromDate(serverTime),
      );
      const result = await this.runTransaction({
        storeId: state.storeId,
        customer: state.customer,
        promotion: state.promotion,
        clubUserId: context.user.id,
        checkInDate: state.checkInDate,
        description: state.description,
      });
      return { ...result, previousCheckedDates };
    } catch (error) {
      await this.releaseDedupKey(state.dedupKey);
      this.logSubmit({
        requestId,
        storeId: state.storeId,
        customerId: state.customer.id,
        checkInDate: state.checkInDate,
        pointsAwarded: state.awardedPoints,
        result: 'failed',
        errorCode: readErrorCode(error),
      });
      if (isUniqueViolation(error)) {
        throw buildCheckInBusinessError(CHECK_IN_ALREADY_DONE_CODE);
      }
      throw error;
    }
  }

  /** 提交后的派生缓存失效：失败只记录补偿信号，绝不把已落账的签到判为失败 */
  private async invalidateDerivedCacheAfterCommit(
    state: ClubCheckInSubmitState,
    requestId: string,
  ): Promise<void> {
    try {
      await this.cacheInvalidatorService.invalidateMarketingCustomerDerived(
        state.storeId,
      );
    } catch (error) {
      this.logger.warn(
        `签到已落账但派生缓存失效失败 ${JSON.stringify({
          requestId,
          storeId: state.storeId,
          customerId: state.customer.id,
          checkInDate: state.checkInDate,
          result: 'committed_but_cache_stale',
          error: error instanceof Error ? error.name : 'UNKNOWN',
        })}`,
      );
    }
  }

  /** 提交前再次由服务端校验活动、门店上下文与会员档案，不采信任何客户端状态 */
  private async resolveSubmitState(
    context: ClubCurrentContext,
    serverTime: number,
    requestId: string,
  ): Promise<ClubCheckInSubmitState> {
    const storeId = context.store.id;
    const promotionRow = await this.queryService.findPromotion(storeId);
    if (!promotionRow) {
      this.logger.warn(`[${requestId}] 签到活动未配置 storeId=${storeId}`);
      throw buildCheckInBusinessError(CHECK_IN_ACTIVITY_NOT_FOUND_CODE);
    }
    const promotion = this.resolveActivePromotion(promotionRow, serverTime);
    if (!promotion) {
      this.logger.warn(`[${requestId}] 签到活动未生效 storeId=${storeId}`);
      throw buildCheckInBusinessError(CHECK_IN_ACTIVITY_NOT_ACTIVE_CODE);
    }
    const customer = await this.queryService.findCustomer(context);
    if (!customer) {
      this.logger.warn(`[${requestId}] 会员档案缺失 storeId=${storeId}`);
      throw buildCheckInBusinessError(CHECK_IN_ACTIVITY_NOT_ACTIVE_CODE);
    }
    const checkInDate = formatShanghaiDate(serverTime);
    const awardedPoints = promotion.pointsPerCheckIn;
    return {
      storeId,
      customer,
      promotion,
      checkInDate,
      awardedPoints,
      description: `每日签到 +${awardedPoints} 积分`,
      dedupKey: `${CHECK_IN_DEDUP_KEY_PREFIX}${storeId}:${customer.id}:${checkInDate}`,
    };
  }

  /** 短事务：签到事实 + 余额 + 积分流水 + 条件性审计流水 + 活动参与人次 */
  private async runTransaction(
    input: ClubCheckInWriteInput,
  ): Promise<ClubCheckInWriteResult> {
    const { storeId, customer, promotion, checkInDate, description } = input;
    const awardedPoints = promotion.pointsPerCheckIn;

    return this.prisma.$transaction(
      async (tx) => {
        const now = new Date();
        // 活动生效是积分发放的前置条件：用带条件的原子更新占用本次参与，
        // 影响行数为 0 说明活动在「提交前校验」之后被停用 / 删除 / 越过时间窗，
        // 必须整笔回滚，不能继续发积分。积分不是金额，只累加参与人次。
        const claimed = await tx.marketingPromotion.updateMany({
          where: {
            id: promotion.id,
            enabled: true,
            startAt: { lte: now },
            endAt: { gte: now },
          },
          data: { usageCount: { increment: 1 } },
        });
        if (claimed.count === 0) {
          throw buildCheckInBusinessError(CHECK_IN_ACTIVITY_NOT_ACTIVE_CODE);
        }

        const record = await tx.clubDailyCheckInRecord.create({
          data: {
            storeId,
            customerId: customer.id,
            clubUserId: input.clubUserId,
            memberId: customer.memberId,
            promotionId: promotion.id,
            checkInDate,
            pointsAwarded: awardedPoints,
          },
          select: { id: true, createdAt: true },
        });
        const updated = await tx.marketingCustomer.update({
          where: { id: customer.id, storeId, deletedAt: null },
          data: { points: { increment: awardedPoints } },
          select: { id: true, points: true },
        });
        await tx.marketingPointsRecord.create({
          data: {
            storeId,
            customerId: customer.id,
            amount: awardedPoints,
            type: 'earn',
            description,
          },
        });
        if (customer.memberId !== null) {
          await tx.memberPointsLog.create({
            data: {
              memberId: customer.memberId,
              storeId,
              changeType: 'increase',
              source: 'check_in',
              changeAmount: awardedPoints,
              beforePoints: updated.points - awardedPoints,
              afterPoints: updated.points,
              reason: '每日签到',
              remark: description,
            },
          });
        }
        return {
          checkedInAt: record.createdAt.getTime(),
          pointsBalance: updated.points,
        };
      },
      { timeout: TX_TIMEOUT_MEDIUM },
    );
  }

  private resolveActivePromotion(
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

  private async releaseDedupKey(key: string): Promise<void> {
    try {
      await this.redisService.del(key);
    } catch (error) {
      // 仅记录辅助清理失败，不吞掉主异常（主异常由调用方继续抛出）
      this.logger.warn(
        `释放签到防抖占位失败 key=${key} error=${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private logSubmit(event: ClubCheckInLogEvent): void {
    const payload = JSON.stringify(event);
    if (event.result === 'success') {
      this.logger.log(`签到落账成功 ${payload}`);
    } else {
      this.logger.warn(`签到落账失败 ${payload}`);
    }
  }
}

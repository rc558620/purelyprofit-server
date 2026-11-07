import { Injectable, Logger } from '@nestjs/common';
import {
  PrismaService,
  TX_TIMEOUT_SHORT,
} from '../../../prisma/prisma.service';
import { getShanghaiMonthStartMs } from '../../../shared/shanghai-time.utils';
import { CacheInvalidatorService } from '../../../redis/invalidator';
import { RedisLockService } from '../../../redis/redis-lock.service';
import { PROMO_BEAN_REWARDS_BY_LEVEL } from './platform-membership.constants';
import type { PartnerLevelValue } from './platform-membership.types';
import { maskPhone } from '../../auth/auth.utils';
import type { PlatformMembershipPlanId } from './dto/platform-membership-query.dto';
import { resolvePartnerLevel } from './platform-membership-promo-stats.domain';
import { PlatformMembershipPromoBackfillService } from './platform-membership-promo-backfill.service';

/** 等级判定与发豆互斥锁的 TTL（秒）：只覆盖一次短事务，过期自动释放防死锁 */
const AWARD_LOCK_TTL_SECONDS = 10;
/** 拿锁失败时的重试次数与间隔 */
const AWARD_LOCK_RETRY_TIMES = 2;
const AWARD_LOCK_RETRY_DELAY_MS = 30;

interface UnchargedPromo {
  id: number;
  storeId: number;
  partnerId: number | null;
}

interface PromoRewardInput {
  userId: number;
  storeId: number;
  planId: PlatformMembershipPlanId;
  amount: number;
}

@Injectable()
export class PlatformMembershipPromoService {
  private readonly logger = new Logger(PlatformMembershipPromoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheInvalidatorService: CacheInvalidatorService,
    private readonly redisLockService: RedisLockService,
    private readonly backfillService: PlatformMembershipPromoBackfillService,
  ) {}

  /** 启动补偿入口：实现已拆到独立 service，此处保留稳定调用契约 */
  async backfillUnchargedPromoRecords(): Promise<void> {
    await this.backfillService.run();
  }

  /**
   * 充值时尝试发放推广奖励。
   * 流程：解析手机号 → 匹配唯一未充值推广记录 → 在合伙人锁内判定等级 → 事务发放。
   * 幂等保护：hasCharged 置位后不会再被查出，避免重复发放。
   */
  async tryAwardPromoReward(input: PromoRewardInput): Promise<void> {
    const inviteePhone = await this.resolveInviteePhone(input.userId);
    if (!inviteePhone) return;

    const promo = await this.findPrimaryUnchargedPromo(inviteePhone);
    if (!promo) return;

    const partnerId = await this.resolvePartnerId(promo);
    if (partnerId === null) {
      this.logger.debug(
        `推广记录 #${promo.id} 所属门店 ${promo.storeId} 无已通过合伙人，跳过奖励`,
      );
      return;
    }

    // 等级由「本月已成交数」推导，读计数与写数据必须串行：
    // 否则两笔并发充值会读到同一个计数、都按低档发豆，与展示侧等级口径不一致。
    const lock = await this.redisLockService.acquireLock(
      `promo:award:${partnerId}`,
      {
        ttlSeconds: AWARD_LOCK_TTL_SECONDS,
        retryTimes: AWARD_LOCK_RETRY_TIMES,
        retryDelayMs: AWARD_LOCK_RETRY_DELAY_MS,
      },
    );
    if (!lock) {
      this.logger.warn(
        `推广奖励发放未拿到合伙人锁，等待启动补偿: promoId=${promo.id}`,
      );
      return;
    }

    try {
      await this.awardWithLevelLock(input, promo, partnerId, inviteePhone);
    } finally {
      await this.redisLockService.releaseLock(lock);
    }
  }

  private async resolveInviteePhone(userId: number): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, wechatPhone: true },
    });
    if (!user) return null;

    // 优先从登录邮箱反解手机号，其次使用微信授权手机号（邮箱被改写时仍能兜底）
    const phoneMatch = user.email.match(
      /^profit_phone_(.+)@purelyprofit\.local$/,
    );
    const inviteePhone = phoneMatch?.[1] ?? user.wechatPhone ?? null;
    if (!inviteePhone) {
      this.logger.warn(`无法解析用户 ${userId} 的手机号，跳过推广奖励发放`);
    }
    return inviteePhone;
  }

  /**
   * 只取最早注册的一条：同一手机号若因历史数据 / 多推广人录入存在多条记录，
   * 全量遍历会让一次充值给多个推广人都发豆（一单多发）。
   */
  private async findPrimaryUnchargedPromo(
    inviteePhone: string,
  ): Promise<UnchargedPromo | null> {
    const records = await this.prisma.storeMembershipPromoRecord.findMany({
      where: { inviteePhone, hasCharged: false },
      select: { id: true, storeId: true, partnerId: true },
      orderBy: { registeredAt: 'asc' },
      take: 1,
    });
    return records[0] ?? null;
  }

  private async resolvePartnerId(
    promo: UnchargedPromo,
  ): Promise<number | null> {
    if (promo.partnerId !== null) return promo.partnerId;
    const partner = await this.prisma.storePartner.findFirst({
      where: { storeId: promo.storeId, status: 'approved' },
      select: { id: true },
      orderBy: { joinedAt: 'asc' },
    });
    return partner?.id ?? null;
  }

  private async awardWithLevelLock(
    input: PromoRewardInput,
    promo: UnchargedPromo,
    partnerId: number,
    inviteePhone: string,
  ): Promise<void> {
    const monthStart = new Date(getShanghaiMonthStartMs(Date.now()));
    const monthChargedCount =
      await this.prisma.storeMembershipPromoRecord.count({
        where: {
          partnerId,
          hasCharged: true,
          chargedAt: { gte: monthStart },
        },
      });

    const partnerLevel: PartnerLevelValue =
      this.resolveRewardLevel(monthChargedCount);
    const rewardBeans =
      PROMO_BEAN_REWARDS_BY_LEVEL[partnerLevel]?.[input.planId] ?? 0;

    let awarded = false;
    try {
      // 置位 + 发豆 + 写日志放同一事务，避免置位后崩溃导致奖励丢失
      awarded = await this.prisma.$transaction(
        async (tx) => {
          const updateResult = await tx.storeMembershipPromoRecord.updateMany({
            where: { id: promo.id, hasCharged: false },
            data: {
              hasCharged: true,
              chargedAmount: input.amount,
              chargedAt: new Date(),
              chargedPlan: input.planId,
              rewardBeans,
              ...(promo.partnerId === null ? { partnerId } : {}),
            },
          });
          if (updateResult.count === 0) return false;

          if (rewardBeans > 0) {
            await tx.storePartner.update({
              where: { id: partnerId },
              data: {
                beanBalance: { increment: rewardBeans },
                totalEarnedBeans: { increment: rewardBeans },
              },
            });

            await tx.storePartnerBeanLog.create({
              data: {
                storeId: promo.storeId,
                partnerId,
                source: 'promo_reward',
                changeAmount: rewardBeans,
                description: `推广奖励 · ${input.planId}套餐`,
                relatedPromoRecordId: promo.id,
                relatedPlanType: input.planId,
                relatedUser: maskPhone(inviteePhone),
              },
            });
          }
          return true;
        },
        { timeout: TX_TIMEOUT_SHORT },
      );
    } catch (err: unknown) {
      // 事务失败时不标记 charged，后续可由启动补偿重新发放
      this.logger.error(
        `推广奖励发放事务失败（未标记已发放，等待补偿）: promoId=${promo.id}, error=${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    if (!awarded) return;

    await this.cacheInvalidatorService.invalidateMembershipDerived(
      promo.storeId,
    );
    this.logger.log(
      `推广奖励已发放: partnerId=${partnerId}, rewardBeans=${rewardBeans}, promoId=${promo.id}`,
    );
  }

  /**
   * 计算「本次成交」应适用的合伙人等级。
   *
   * monthChargedCount 统计的是**已置位**的记录，而本单此刻尚未置位，
   * 因此它代表「本单之前」的成交人数，需 +1 才是含本单的人数。
   *
   * 这样才与展示侧 buildPartnerLevel 对齐（展示时本单已 hasCharged=true，
   * 天然含本单）。否则会出现：本月第 10 单按 star(8豆) 发，
   * 用户刷新后却看到自己是 elite(9豆) 的口径不一致问题。
   */
  private resolveRewardLevel(monthChargedCount: number): PartnerLevelValue {
    return resolvePartnerLevel(monthChargedCount + 1);
  }
}

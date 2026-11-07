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
import { buildPhoneLoginEmail, maskPhone } from '../../auth/auth.utils';
import type { PlatformMembershipPlanId } from './dto/platform-membership-query.dto';
import { resolvePartnerLevel } from './platform-membership-promo-stats.domain';
import { PlatformMembershipPromoBeanReconciliationService } from './platform-membership-promo-bean-reconciliation.service';

/** 等级判定与发豆互斥锁的 TTL（秒）：只覆盖一次短事务，过期自动释放防死锁 */
const AWARD_LOCK_TTL_SECONDS = 10;
/** 拿锁失败时的重试次数与间隔 */
const AWARD_LOCK_RETRY_TIMES = 2;
const AWARD_LOCK_RETRY_DELAY_MS = 30;

interface UnchargedPromoRecord {
  id: number;
  inviteePhone: string;
  storeId: number;
  partnerId: number | null;
  registeredAt: Date;
}

interface RewardContext {
  planId: PlatformMembershipPlanId;
  amount: number;
  partnerId: number;
  rewardBeans: number;
  hasExistingBeanLog: boolean;
}

type BackfillOutcome = 'done' | 'skipped' | 'failed';

/**
 * 启动期推广补偿服务。
 *
 * 与充值实时链路 PlatformMembershipPromoService 保持同一套归属与等级口径：
 * - 同一手机号只认最早建立的推广关系，避免「一单多发」；
 * - 只有推广关系建立之后的真实微信充值才触发补发；
 * - 等级判定与发豆在同一把 partnerId 锁内完成，避免并发等级漂移。
 */
@Injectable()
export class PlatformMembershipPromoBackfillService {
  private readonly logger = new Logger(
    PlatformMembershipPromoBackfillService.name,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheInvalidatorService: CacheInvalidatorService,
    private readonly beanReconciliationService: PlatformMembershipPromoBeanReconciliationService,
    private readonly redisLockService: RedisLockService,
  ) {}

  /** 对账 → 归属收敛 → 补发 → 缓存失效 */
  async run(): Promise<void> {
    await this.beanReconciliationService.runStartupReconciliation();

    const records = await this.loadPrimaryUnchargedRecords();
    if (records.length === 0) return;
    this.logger.log(`发现 ${records.length} 条待补发推广记录，开始检查修复...`);

    const affectedStoreIds = new Set<number>();
    let fixedCount = 0;

    for (const record of records) {
      const outcome = await this.backfillOne(record);
      if (outcome !== 'done') continue;
      affectedStoreIds.add(record.storeId);
      fixedCount += 1;
    }

    for (const storeId of affectedStoreIds) {
      await this.cacheInvalidatorService.invalidateMembershipDerived(storeId);
    }

    if (fixedCount > 0) {
      this.logger.log(`历史推广记录修复完成: 共修复 ${fixedCount} 条`);
    }
  }

  /**
   * 按被推广手机号收敛到唯一一条待补发记录。
   *
   * 同一手机号可能跨门店存在多条推广记录（历史数据 / 多推广人录入）。
   * 归属权以最早建立推广关系的记录为准，与实时链路 take: 1 的口径一致；
   * 全量遍历会让一次充值给多个推广人都发豆。
   */
  private async loadPrimaryUnchargedRecords(): Promise<UnchargedPromoRecord[]> {
    const uncharged = await this.prisma.storeMembershipPromoRecord.findMany({
      where: { hasCharged: false },
      select: {
        id: true,
        inviteePhone: true,
        storeId: true,
        partnerId: true,
        registeredAt: true,
      },
      orderBy: [{ registeredAt: 'asc' }, { id: 'asc' }],
    });

    const primaryByPhone = new Map<string, UnchargedPromoRecord>();
    for (const record of uncharged) {
      if (!primaryByPhone.has(record.inviteePhone)) {
        primaryByPhone.set(record.inviteePhone, record);
      }
    }
    return [...primaryByPhone.values()];
  }

  private async backfillOne(
    record: UnchargedPromoRecord,
  ): Promise<BackfillOutcome> {
    this.logger.log(
      `[backfill] 处理记录 #${record.id}: inviteePhone=${maskPhone(record.inviteePhone)}, storeId=${record.storeId}`,
    );

    const context = await this.resolveRewardContext(record);
    if (!context) return 'skipped';

    const lock = await this.redisLockService.acquireLock(
      `promo:award:${context.partnerId}`,
      {
        ttlSeconds: AWARD_LOCK_TTL_SECONDS,
        retryTimes: AWARD_LOCK_RETRY_TIMES,
        retryDelayMs: AWARD_LOCK_RETRY_DELAY_MS,
      },
    );
    if (!lock) {
      this.logger.warn(
        `[backfill] 记录 #${record.id} 未拿到发豆锁，等待下轮补偿`,
      );
      return 'failed';
    }

    try {
      return await this.applyReward(record, context);
    } finally {
      await this.redisLockService.releaseLock(lock);
    }
  }

  private async resolveRewardContext(
    record: UnchargedPromoRecord,
  ): Promise<RewardContext | null> {
    const paidOrder = await this.findQualifiedPaidOrder(record);
    if (!paidOrder) return null;

    const partnerId = await this.resolvePartnerId(record);
    if (partnerId === null) return null;

    const planId = paidOrder.planId as PlatformMembershipPlanId;
    const rewardBeans = await this.resolveRewardBeans(partnerId, planId);
    const hasExistingBeanLog =
      rewardBeans > 0 &&
      (await this.prisma.storePartnerBeanLog.findFirst({
        where: {
          relatedPromoRecordId: record.id,
          source: 'promo_reward',
        },
        select: { id: true },
      })) !== null;

    return {
      planId,
      amount: paidOrder.amount,
      partnerId,
      rewardBeans,
      hasExistingBeanLog,
    };
  }

  /** 只认推广关系建立之后、被推广人自己门店的真实微信充值订单 */
  private async findQualifiedPaidOrder(
    record: UnchargedPromoRecord,
  ): Promise<{ amount: number; planId: string } | null> {
    const inviteeEmail = buildPhoneLoginEmail(
      'purely_profit',
      record.inviteePhone,
    );
    const inviteeUser = await this.prisma.user.findUnique({
      where: { email: inviteeEmail },
      select: { id: true },
    });
    if (!inviteeUser) {
      this.logger.log(`[backfill] 记录 #${record.id}: 未找到注册用户，跳过`);
      return null;
    }

    // 明确排序，避免 owner 名下多门店时 findFirst 返回不确定行
    const inviteeStore = await this.prisma.store.findFirst({
      where: { ownerId: inviteeUser.id },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    if (!inviteeStore) {
      this.logger.log(
        `[backfill] 记录 #${record.id}: 用户 ${inviteeUser.id} 无门店，跳过`,
      );
      return null;
    }

    // admin / gift 后台订单不是被推广人自己付费，不能触发返豆；
    // createdAt 下界防止推广关系建立前的历史订单被误判为「本次成交」。
    const paidOrder = await this.prisma.storeMembershipOrder.findFirst({
      where: {
        storeId: inviteeStore.id,
        status: 'paid',
        paymentChannel: 'wechat',
        createdAt: { gte: record.registeredAt },
      },
      select: { amount: true, planId: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!paidOrder) {
      this.logger.log(
        `[backfill] 记录 #${record.id}: 推广关系建立后无真实付费订单，跳过`,
      );
      return null;
    }
    return paidOrder;
  }

  private async resolvePartnerId(
    record: UnchargedPromoRecord,
  ): Promise<number | null> {
    if (record.partnerId !== null) return record.partnerId;
    const partner = await this.prisma.storePartner.findFirst({
      where: { storeId: record.storeId, status: 'approved' },
      select: { id: true },
      orderBy: { joinedAt: 'asc' },
    });
    return partner?.id ?? null;
  }

  /** 等级按「含本单」的月成交数计算，与展示侧 buildPartnerLevel 对齐 */
  private async resolveRewardBeans(
    partnerId: number,
    planId: PlatformMembershipPlanId,
  ): Promise<number> {
    const monthStart = new Date(getShanghaiMonthStartMs(Date.now()));
    const monthChargedCount =
      await this.prisma.storeMembershipPromoRecord.count({
        where: {
          partnerId,
          hasCharged: true,
          chargedAt: { gte: monthStart },
        },
      });
    const level: PartnerLevelValue = resolvePartnerLevel(monthChargedCount + 1);
    return PROMO_BEAN_REWARDS_BY_LEVEL[level]?.[planId] ?? 0;
  }

  /**
   * 置位 + 发豆 + 写日志必须在同一事务：
   * 若置位在事务外而发豆失败，下轮 findMany(hasCharged=false) 再也查不到它，奖励永久丢失。
   */
  private async applyReward(
    record: UnchargedPromoRecord,
    context: RewardContext,
  ): Promise<BackfillOutcome> {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const updateResult = await tx.storeMembershipPromoRecord.updateMany({
            where: { id: record.id, hasCharged: false },
            data: {
              hasCharged: true,
              chargedAmount: context.amount,
              chargedAt: new Date(),
              chargedPlan: context.planId,
              rewardBeans: context.rewardBeans,
              ...(record.partnerId === null
                ? { partnerId: context.partnerId }
                : {}),
            },
          });
          if (updateResult.count === 0) return 'skipped' as const;

          if (context.rewardBeans > 0 && !context.hasExistingBeanLog) {
            await tx.storePartner.update({
              where: { id: context.partnerId },
              data: {
                beanBalance: { increment: context.rewardBeans },
                totalEarnedBeans: { increment: context.rewardBeans },
              },
            });

            await tx.storePartnerBeanLog.create({
              data: {
                storeId: record.storeId,
                partnerId: context.partnerId,
                source: 'promo_reward',
                changeAmount: context.rewardBeans,
                description: `推广奖励(补发) · ${context.planId}套餐`,
                relatedPromoRecordId: record.id,
                relatedPlanType: context.planId,
                relatedUser: maskPhone(record.inviteePhone),
              },
            });
          }
          return 'done' as const;
        },
        { timeout: TX_TIMEOUT_SHORT },
      );
    } catch (err: unknown) {
      // 事务已整体回滚（未置位），下轮启动会再次进入补偿重试
      this.logger.error(
        `[backfill] 记录 #${record.id}: 补发事务失败，等待下轮补偿: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return 'failed';
    }
  }
}

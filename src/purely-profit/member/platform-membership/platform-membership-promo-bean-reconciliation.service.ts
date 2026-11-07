import { Injectable, Logger } from '@nestjs/common';
import {
  PrismaService,
  TX_TIMEOUT_SHORT,
} from '../../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../../redis/invalidator';
import { RedisLockService } from '../../../redis/redis-lock.service';

/** 启动对账锁资源名（全局唯一，跨实例互斥） */
const RECONCILE_LOCK_RESOURCE = 'promo:bean-reconciliation';
/** 锁 TTL：需覆盖全量合伙人对账耗时，过期后自动释放防死锁 */
const RECONCILE_LOCK_TTL_SECONDS = 300;

interface BeanDelta {
  balance: number;
  earned: number;
}

@Injectable()
export class PlatformMembershipPromoBeanReconciliationService {
  private readonly logger = new Logger(
    PlatformMembershipPromoBeanReconciliationService.name,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheInvalidatorService: CacheInvalidatorService,
    private readonly redisLockService: RedisLockService,
  ) {}

  /**
   * 启动期一次性对账入口（去重日志 + 校正余额）。
   *
   * 分布式锁只负责「多实例不重复执行对账」。
   * 在线的发豆 / 提现 / 管理端调豆不持有这把锁，因此对账禁止用日志快照
   * 绝对值覆盖余额：所有修正都改为「条件 + 增量」，见 reconcileOne。
   * 拿不到锁说明已有实例在执行，直接跳过（对账允许延后，不阻塞启动）。
   */
  async runStartupReconciliation(): Promise<void> {
    const lock = await this.redisLockService.acquireLock(
      RECONCILE_LOCK_RESOURCE,
      {
        ttlSeconds: RECONCILE_LOCK_TTL_SECONDS,
        retryTimes: 0,
      },
    );

    if (!lock) {
      this.logger.warn(
        '[reconcile] 已有实例正在执行推广豆对账，本实例跳过（避免并发覆盖余额）',
      );
      return;
    }

    try {
      await this.deduplicatePromoBeanLogs();
      await this.reconcilePartnerBeanBalances();
    } finally {
      await this.redisLockService.releaseLock(lock);
    }
  }

  /**
   * 清理同一推广记录的重复豆日志。
   * 对每个 promoRecord 只保留最早一条 promo_reward 日志，
   * 删除与余额回退在同一事务内完成，且按合伙人精确回退增量。
   */
  async deduplicatePromoBeanLogs(): Promise<void> {
    const duplicates = await this.prisma.storePartnerBeanLog.groupBy({
      by: ['relatedPromoRecordId'],
      where: {
        source: 'promo_reward',
        relatedPromoRecordId: { not: null },
      },
      _count: { id: true },
      having: { id: { _count: { gt: 1 } } },
    });

    if (duplicates.length === 0) return;
    this.logger.log(
      `发现 ${duplicates.length} 个推广记录存在重复豆日志，开始清理...`,
    );

    const affectedPartnerIds = new Set<number>();
    for (const dup of duplicates) {
      if (!dup.relatedPromoRecordId) continue;
      const partnerIds = await this.deduplicateOne(dup.relatedPromoRecordId);
      partnerIds.forEach((id) => affectedPartnerIds.add(id));
    }

    await this.invalidatePartners(affectedPartnerIds);
  }

  private async deduplicateOne(promoRecordId: number): Promise<number[]> {
    const logs = await this.prisma.storePartnerBeanLog.findMany({
      where: {
        relatedPromoRecordId: promoRecordId,
        source: 'promo_reward',
      },
      select: { id: true, partnerId: true, changeAmount: true },
      orderBy: { createdAt: 'asc' },
    });

    const [keep, ...remove] = logs;
    if (!keep || remove.length === 0) return [];

    // 重复日志可能挂在不同合伙人名下，必须全部纳入回退范围：
    // 否则「仅剩这一条日志」的合伙人不会被后续 groupBy 扫到，余额永久偏高。
    const deltasByPartner = new Map<number, BeanDelta>();
    for (const log of remove) {
      const delta = deltasByPartner.get(log.partnerId) ?? {
        balance: 0,
        earned: 0,
      };
      delta.balance += log.changeAmount;
      if (log.changeAmount > 0) delta.earned += log.changeAmount;
      deltasByPartner.set(log.partnerId, delta);
    }

    await this.prisma.$transaction(
      async (tx) => {
        await tx.storePartnerBeanLog.deleteMany({
          where: { id: { in: remove.map((log) => log.id) } },
        });
        for (const [partnerId, delta] of deltasByPartner) {
          await tx.storePartner.updateMany({
            where: { id: partnerId },
            data: {
              beanBalance: { increment: -delta.balance },
              totalEarnedBeans: { increment: -delta.earned },
            },
          });
        }
      },
      { timeout: TX_TIMEOUT_SHORT },
    );

    this.logger.log(
      `已清理推广记录 #${promoRecordId} 的 ${remove.length} 条重复豆日志`,
    );
    return [...deltasByPartner.keys()];
  }

  /**
   * 校正所有推广人的豆余额。
   * 以「日志之和」为准，但只允许条件增量修正，不得绝对值覆盖。
   */
  async reconcilePartnerBeanBalances(): Promise<void> {
    const partnersWithLogs = await this.prisma.storePartnerBeanLog.groupBy({
      by: ['partnerId'],
      where: { source: 'promo_reward' },
    });

    if (partnersWithLogs.length === 0) return;

    const affectedStoreIds = new Set<number>();
    for (const entry of partnersWithLogs) {
      const storeId = await this.reconcileOne(entry.partnerId);
      if (storeId !== null) affectedStoreIds.add(storeId);
    }

    // 无论余额是否变化都清缓存，确保 Redis 与 DB 同步
    for (const storeId of affectedStoreIds) {
      await this.cacheInvalidatorService.invalidateMembershipDerived(storeId);
    }
  }

  private async reconcileOne(partnerId: number): Promise<number | null> {
    const [allLogs, partner] = await Promise.all([
      this.prisma.storePartnerBeanLog.findMany({
        where: { partnerId },
        select: { changeAmount: true, source: true },
      }),
      this.prisma.storePartner.findUnique({
        where: { id: partnerId },
        select: {
          beanBalance: true,
          totalEarnedBeans: true,
          storeId: true,
        },
      }),
    ]);
    if (!partner) return null;

    const loggedBalance = Math.max(
      0,
      allLogs.reduce((sum, log) => sum + log.changeAmount, 0),
    );
    const balanceDiff = loggedBalance - partner.beanBalance;

    if (balanceDiff !== 0) {
      // 带条件的增量修正：只有余额仍等于读到的快照时才生效。
      // 若期间有发豆 / 提现 / 管理端调整写入，条件不命中即跳过本轮，
      // 绝不能用旧日志快照覆盖在线写入（原实现会凭空增减用户豆）。
      const result = await this.prisma.storePartner.updateMany({
        where: { id: partnerId, beanBalance: partner.beanBalance },
        data: { beanBalance: { increment: balanceDiff } },
      });
      if (result.count === 0) {
        this.logger.warn(
          `[reconcile] 合伙人 #${partnerId} 余额在校正期间被并发修改，本轮跳过`,
        );
      } else {
        this.logger.log(
          `[reconcile] 合伙人 #${partnerId} 余额已按日志增量校正: diff=${balanceDiff}`,
        );
      }
    }

    // totalEarnedBeans 的写入侧口径尚未统一（管理端正向调豆计入、提现退回不计入），
    // 因此只告警、不覆盖，避免抹掉管理端累计（原实现只统计 promo_reward 会回退累计值）。
    const promoRewardEarned = allLogs
      .filter((log) => log.source === 'promo_reward' && log.changeAmount > 0)
      .reduce((sum, log) => sum + log.changeAmount, 0);
    if (partner.totalEarnedBeans < promoRewardEarned) {
      this.logger.warn(
        `[reconcile] 合伙人 #${partnerId} 累计获得纯利豆低于推广奖励日志合计: ` +
          `db=${partner.totalEarnedBeans}, promoReward=${promoRewardEarned}，` +
          `不自动覆盖（累计口径由写入侧负责）`,
      );
    }

    return partner.storeId;
  }

  private async invalidatePartners(partnerIds: Set<number>): Promise<void> {
    const storeIds = new Set<number>();
    for (const partnerId of partnerIds) {
      const partner = await this.prisma.storePartner.findUnique({
        where: { id: partnerId },
        select: { storeId: true },
      });
      if (partner) storeIds.add(partner.storeId);
    }

    for (const storeId of storeIds) {
      await this.cacheInvalidatorService.invalidateMembershipDerived(storeId);
    }
  }
}

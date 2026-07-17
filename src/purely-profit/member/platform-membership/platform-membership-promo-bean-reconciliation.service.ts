import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../../redis/invalidator';

@Injectable()
export class PlatformMembershipPromoBeanReconciliationService {
  private readonly logger = new Logger(
    PlatformMembershipPromoBeanReconciliationService.name,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheInvalidatorService: CacheInvalidatorService,
  ) {}

  /**
   * 清理同一推广记录的重复豆日志。
   * 对每个 promoRecord，只保留最早的一条 promo_reward 日志，
   * 删除多余的并回滚对应的 bean 余额。
   */
  async deduplicatePromoBeanLogs(): Promise<void> {
    // 查找有重复豆日志的 promoRecordId
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

      // 获取所有该记录的豆日志，按时间排序
      const logs = await this.prisma.storePartnerBeanLog.findMany({
        where: {
          relatedPromoRecordId: dup.relatedPromoRecordId,
          source: 'promo_reward',
        },
        select: { id: true, partnerId: true, changeAmount: true },
        orderBy: { createdAt: 'asc' },
      });

      // 保留第一条，删除其余
      const [keep, ...remove] = logs;
      if (remove.length === 0) continue;

      const removeIds = remove.map((r) => r.id);

      // 删除重复日志
      await this.prisma.storePartnerBeanLog.deleteMany({
        where: { id: { in: removeIds } },
      });

      if (keep.partnerId) {
        affectedPartnerIds.add(keep.partnerId);
      }

      this.logger.log(
        `已清理推广记录 #${dup.relatedPromoRecordId} 的 ${remove.length} 条重复豆日志`,
      );
    }

    // 从所有日志重新计算受影响合伙人的 bean 余额（绝对值校正）
    for (const partnerId of affectedPartnerIds) {
      const allLogs = await this.prisma.storePartnerBeanLog.findMany({
        where: { partnerId },
        select: { changeAmount: true, source: true },
      });

      // totalEarnedBeans = 所有 promo_reward 正数日志之和
      const correctTotalEarned = allLogs
        .filter((l) => l.source === 'promo_reward' && l.changeAmount > 0)
        .reduce((sum, l) => sum + l.changeAmount, 0);

      // beanBalance = 所有日志 changeAmount 之和
      const correctBalance = allLogs.reduce(
        (sum, l) => sum + l.changeAmount,
        0,
      );

      await this.prisma.storePartner.update({
        where: { id: partnerId },
        data: {
          beanBalance: Math.max(0, correctBalance),
          totalEarnedBeans: correctTotalEarned,
        },
      });

      this.logger.log(
        `合伙人 #${partnerId} 豆余额已校正: balance=${Math.max(0, correctBalance)}, totalEarned=${correctTotalEarned}`,
      );

      // 清除缓存
      const partnerRecord = await this.prisma.storePartner.findUnique({
        where: { id: partnerId },
        select: { storeId: true },
      });
      if (partnerRecord) {
        await this.cacheInvalidatorService.invalidateMembershipDerived(
          partnerRecord.storeId,
        );
      }
    }
  }

  /**
   * 校正所有推广人的豆余额。
   * 从豆日志重新计算 balance 和 totalEarnedBeans，与数据库值比对，
   * 不一致则校正。每次服务启动运行一次。
   */
  async reconcilePartnerBeanBalances(): Promise<void> {
    // 查找所有有 promo_reward 日志的合伙人
    const partnersWithLogs = await this.prisma.storePartnerBeanLog.groupBy({
      by: ['partnerId'],
      where: { source: 'promo_reward' },
    });

    if (partnersWithLogs.length === 0) return;

    let _correctedCount = 0;
    const affectedStoreIds = new Set<number>();

    for (const entry of partnersWithLogs) {
      const allLogs = await this.prisma.storePartnerBeanLog.findMany({
        where: { partnerId: entry.partnerId },
        select: { changeAmount: true, source: true },
      });

      const correctTotalEarned = allLogs
        .filter((l) => l.source === 'promo_reward' && l.changeAmount > 0)
        .reduce((sum, l) => sum + l.changeAmount, 0);

      const correctBalance = Math.max(
        0,
        allLogs.reduce((sum, l) => sum + l.changeAmount, 0),
      );

      const partner = await this.prisma.storePartner.findUnique({
        where: { id: entry.partnerId },
        select: {
          beanBalance: true,
          totalEarnedBeans: true,
          storeId: true,
        },
      });
      if (!partner) continue;

      // 无论余额是否一致，都强制清缓存（确保 Redis 缓存与 DB 同步）
      affectedStoreIds.add(partner.storeId);

      if (
        partner.beanBalance !== correctBalance ||
        partner.totalEarnedBeans !== correctTotalEarned
      ) {
        this.logger.debug(
          `[reconcile] 合伙人 #${entry.partnerId} 余额不一致: ` +
            `db_balance=${partner.beanBalance}→${correctBalance}, ` +
            `db_earned=${partner.totalEarnedBeans}→${correctTotalEarned}`,
        );

        await this.prisma.storePartner.update({
          where: { id: entry.partnerId },
          data: {
            beanBalance: correctBalance,
            totalEarnedBeans: correctTotalEarned,
          },
        });

        _correctedCount++;
      } else {
        // 余额正确，无需处理
      }
    }

    for (const storeId of affectedStoreIds) {
      await this.cacheInvalidatorService.invalidateMembershipDerived(storeId);
    }
  }
}

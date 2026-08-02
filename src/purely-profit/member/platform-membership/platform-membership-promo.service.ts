import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { getShanghaiMonthStartMs } from '../../../shared/shanghai-time.utils';
import { CacheInvalidatorService } from '../../../redis/invalidator';
import { PROMO_BEAN_REWARDS_BY_LEVEL } from './platform-membership.constants';
import type { PartnerLevelValue } from './platform-membership.types';
import { buildPhoneLoginEmail } from '../../auth/auth.utils';
import type { PlatformMembershipPlanId } from './dto/platform-membership-query.dto';
import { resolvePartnerLevel } from './platform-membership-promo-stats.domain';
import { PlatformMembershipPromoBeanReconciliationService } from './platform-membership-promo-bean-reconciliation.service';

@Injectable()
export class PlatformMembershipPromoService {
  private readonly logger = new Logger(PlatformMembershipPromoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheInvalidatorService: CacheInvalidatorService,
    private readonly beanReconciliationService: PlatformMembershipPromoBeanReconciliationService,
  ) {}

  /**
   * 服务启动时修复历史未充值推广记录。
   * 查找所有 hasCharged=false 的记录，检查被推广人是否已充值，
   * 如果已充值则补发推广奖励。
   */
  async backfillUnchargedPromoRecords(): Promise<void> {
    // 先清理历史重复豆日志并校正余额
    await this.beanReconciliationService.deduplicatePromoBeanLogs();
    // 校正所有推广人的豆余额（修复历史数据不一致）
    await this.beanReconciliationService.reconcilePartnerBeanBalances();

    const uncharged = await this.prisma.storeMembershipPromoRecord.findMany({
      where: { hasCharged: false },
      select: {
        id: true,
        inviteePhone: true,
        storeId: true,
        partnerId: true,
        registeredAt: true,
      },
    });

    if (uncharged.length === 0) return;
    this.logger.log(
      `发现 ${uncharged.length} 条未充值推广记录，开始检查修复...`,
    );

    let fixedCount = 0;
    const affectedStoreIds = new Set<number>();

    for (const record of uncharged) {
      this.logger.log(
        `[backfill] 处理记录 #${record.id}: inviteePhone=${record.inviteePhone}, storeId=${record.storeId}`,
      );

      // 通过 User.email 查找被推广人的门店
      // User.email 格式: profit_phone_{phone}@purelyprofit.local
      const inviteeEmail = buildPhoneLoginEmail(
        'purely_profit',
        record.inviteePhone,
      );
      const inviteeUser = await this.prisma.user.findUnique({
        where: { email: inviteeEmail },
        select: { id: true },
      });
      if (!inviteeUser) {
        this.logger.log(
          `[backfill] 记录 #${record.id}: 未找到 User (email=${inviteeEmail})，跳过`,
        );
        continue;
      }

      // 查找被推广人拥有的门店
      const inviteeStore = await this.prisma.store.findFirst({
        where: { ownerId: inviteeUser.id },
        select: { id: true },
      });
      if (!inviteeStore) {
        this.logger.log(
          `[backfill] 记录 #${record.id}: 用户 ${inviteeUser.id} 无门店，跳过`,
        );
        continue;
      }

      // 检查被推广人门店是否有 paid 订单
      const paidOrder = await this.prisma.storeMembershipOrder.findFirst({
        where: { storeId: inviteeStore.id, status: 'paid' },
        select: { amount: true, planId: true },
        orderBy: { createdAt: 'asc' },
      });
      if (!paidOrder) {
        this.logger.log(
          `[backfill] 记录 #${record.id}: 门店 ${inviteeStore.id} 无 paid 订单，跳过`,
        );
        continue;
      }
      this.logger.log(
        `[backfill] 记录 #${record.id}: 找到 paid 订单 (planId=${paidOrder.planId}, amount=${paidOrder.amount})`,
      );

      // 有 paid 订单但未触发推广奖励 → 补发
      const planId = paidOrder.planId as PlatformMembershipPlanId;

      // 查找推广人
      let partnerId = record.partnerId;
      if (!partnerId) {
        const partner = await this.prisma.storePartner.findFirst({
          where: { storeId: record.storeId, status: 'approved' },
          select: { id: true },
          orderBy: { joinedAt: 'asc' },
        });
        if (!partner) continue;
        partnerId = partner.id;
      }

      // 计算合伙人等级（自然月按上海时区切分，避免跨月瞬间等级判错）
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
        resolvePartnerLevel(monthChargedCount);
      const rewardBeans =
        PROMO_BEAN_REWARDS_BY_LEVEL[partnerLevel]?.[
          planId as keyof (typeof PROMO_BEAN_REWARDS_BY_LEVEL)['star']
        ] ?? 0;

      // 原子更新推广记录（hasCharged=false 作为并发锁）
      const updateResult =
        await this.prisma.storeMembershipPromoRecord.updateMany({
          where: { id: record.id, hasCharged: false },
          data: {
            hasCharged: true,
            chargedAmount: paidOrder.amount,
            chargedAt: new Date(),
            chargedPlan: planId,
            rewardBeans,
            ...(record.partnerId === null ? { partnerId } : {}),
          },
        });
      // 如果已被其他进程处理，跳过豆子发放
      if (updateResult.count === 0) {
        this.logger.log(
          `[backfill] 记录 #${record.id}: 已被其他进程处理，跳过`,
        );
        continue;
      }

      // 发放纯利豆
      if (rewardBeans > 0) {
        // 去重：检查是否已为该记录发放过豆子
        const existingLog = await this.prisma.storePartnerBeanLog.findFirst({
          where: {
            relatedPromoRecordId: record.id,
            source: 'promo_reward',
          },
          select: { id: true },
        });
        if (existingLog) {
          this.logger.log(
            `[backfill] 记录 #${record.id}: 已存在豆日志 #${existingLog.id}，跳过豆子发放`,
          );
          affectedStoreIds.add(record.storeId);
          fixedCount++;
          continue;
        }
        await this.prisma.storePartner.update({
          where: { id: partnerId },
          data: {
            beanBalance: { increment: rewardBeans },
            totalEarnedBeans: { increment: rewardBeans },
          },
        });

        await this.prisma.storePartnerBeanLog.create({
          data: {
            storeId: record.storeId,
            partnerId,
            source: 'promo_reward',
            changeAmount: rewardBeans,
            description: `推广奖励(补发) · ${planId}套餐`,
            relatedPromoRecordId: record.id,
            relatedPlanType: planId,
            relatedUser: record.inviteePhone.replace(
              /(\d{3})\d{4}(\d{4})/,
              '$1****$2',
            ),
          },
        });
      }

      affectedStoreIds.add(record.storeId);
      fixedCount++;
      this.logger.log(
        `已修复推广记录 #${record.id}: partnerId=${partnerId}, beans=${rewardBeans}`,
      );
    }

    // 清除受影响门店的缓存
    for (const storeId of affectedStoreIds) {
      await this.cacheInvalidatorService.invalidateMembershipDerived(storeId);
    }

    if (fixedCount > 0) {
      this.logger.log(`历史推广记录修复完成: 共修复 ${fixedCount} 条`);
    }
  }

  /**
   * 充值时尝试发放推广奖励。
   * 流程：查询用户手机号 → 匹配未充值推广记录 → 计算纯利豆 → 更新记录 + 发放豆子。
   * 幂等保护：hasCharged 标记为 true 后不会再被查出，避免重复发放。
   */
  async tryAwardPromoReward(input: {
    userId: number;
    storeId: number;
    planId: PlatformMembershipPlanId;
    amount: number;
  }): Promise<void> {
    // 1. 通过 User.email 提取当前用户的手机号
    //    User.email 格式: profit_phone_{phone}@purelyprofit.local
    const user = await this.prisma.user.findUnique({
      where: { id: input.userId },
      select: { email: true },
    });
    if (!user?.email) return;
    const phoneMatch = user.email.match(
      /^profit_phone_(.+)@purelyprofit\.local$/,
    );
    const inviteePhone = phoneMatch?.[1];
    if (!inviteePhone) return;

    // 2. 查找该用户手机号关联的未充值推广记录
    //    hasCharged=false 作为幂等保护：已处理的记录不会被重复查出
    const unchargedPromos =
      await this.prisma.storeMembershipPromoRecord.findMany({
        where: {
          inviteePhone,
          hasCharged: false,
        },
        select: {
          id: true,
          storeId: true,
          partnerId: true,
        },
      });
    if (unchargedPromos.length === 0) return;

    const now = new Date();

    for (const promo of unchargedPromos) {
      // 3. 查找推广记录所属门店的已通过合伙人
      let partnerId = promo.partnerId;
      if (!partnerId) {
        const partner = await this.prisma.storePartner.findFirst({
          where: { storeId: promo.storeId, status: 'approved' },
          select: { id: true },
          orderBy: { joinedAt: 'asc' },
        });
        if (!partner) {
          this.logger.debug(
            `推广记录 #${promo.id} 所属门店 ${promo.storeId} 无已通过合伙人，跳过奖励`,
          );
          continue;
        }
        partnerId = partner.id;
      }

      // 4. 查询合伙人当前等级（通过本月已充值推广人数计算，按上海时区切月）
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
        resolvePartnerLevel(monthChargedCount);

      // 5. 计算奖励纯利豆数
      const rewardBeans =
        PROMO_BEAN_REWARDS_BY_LEVEL[partnerLevel]?.[
          input.planId as keyof (typeof PROMO_BEAN_REWARDS_BY_LEVEL)['star']
        ] ?? 0;

      // 6. 原子更新推广记录（hasCharged=false 作为并发锁）
      const updateResult =
        await this.prisma.storeMembershipPromoRecord.updateMany({
          where: { id: promo.id, hasCharged: false },
          data: {
            hasCharged: true,
            chargedAmount: input.amount,
            chargedAt: now,
            chargedPlan: input.planId,
            rewardBeans,
            // 如果之前 partnerId 为 null，补绑
            ...(promo.partnerId === null ? { partnerId } : {}),
          },
        });
      // 如果已被其他进程处理，跳过豆子发放
      if (updateResult.count === 0) continue;

      // 7. 发放纯利豆给推广人
      if (rewardBeans > 0) {
        await this.prisma.storePartner.update({
          where: { id: partnerId },
          data: {
            beanBalance: { increment: rewardBeans },
            totalEarnedBeans: { increment: rewardBeans },
          },
        });

        // 8. 写入纯利豆日志
        await this.prisma.storePartnerBeanLog.create({
          data: {
            storeId: promo.storeId,
            partnerId,
            source: 'promo_reward',
            changeAmount: rewardBeans,
            description: `推广奖励 · ${input.planId}套餐`,
            relatedPromoRecordId: promo.id,
            relatedPlanType: input.planId,
            relatedUser: inviteePhone.replace(
              /(\d{3})\d{4}(\d{4})/,
              '$1****$2',
            ),
          },
        });

        this.logger.log(
          `推广奖励已发放: partnerId=${partnerId}, rewardBeans=${rewardBeans}, promoId=${promo.id}`,
        );
      }
    }

    // 9. 清除推广人缓存以刷新统计数据
    for (const promo of unchargedPromos) {
      await this.cacheInvalidatorService.invalidateMembershipDerived(
        promo.storeId,
      );
    }
  }
}

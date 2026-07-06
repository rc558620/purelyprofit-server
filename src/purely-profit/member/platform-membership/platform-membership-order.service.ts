import {
  ConflictException,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../../redis/invalidator';

import {
  DAY_MS,
  PROMO_BEAN_REWARDS_BY_LEVEL,
  PURCHASE_BONUS_POINTS,
} from './platform-membership.constants';
import { resolveEffectivePlanId } from './membership-plan-resolver';
import {
  buildPlanExpiryAt,
  resolveFrontendMembershipExpiry,
} from './membership-expiry.utils';
import { buildProfileResponse } from './membership-profile.mapper';
import {
  buildOrdersOverview,
  calcMemberPlanPayment,
  calcPreviewResult,
  generateWechatOrderId,
  mapOrder,
} from './platform-membership-ledger.domain';
import type { PartnerLevelValue } from './platform-membership.types';
import { buildPhoneLoginEmail } from '../../auth/auth.utils';
import type { PlatformMembershipPlanId } from './dto/platform-membership-query.dto';
import { resolvePartnerLevel } from './platform-membership-promo-stats.domain';
import {
  PreviewPlatformMembershipOrderDto,
  PurchasePlatformMembershipOrderDto,
} from './dto/platform-membership-query.dto';
import {
  PreviewPlatformMembershipOrderResponseDto,
  PurchasePlatformMembershipOrderResponseDto,
} from './dto/platform-membership-response.dto';
import {
  ensureMembershipProfile,
  ensurePlatformMembershipStoreOwner,
  findCurrentStorePartner,
  requirePlan,
} from './platform-membership.query';

@Injectable()
export class PlatformMembershipOrderService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PlatformMembershipOrderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheInvalidatorService: CacheInvalidatorService,
  ) {}

  /** 服务启动后自动修复历史未充值推广记录（在 Redis 就绪后执行） */
  async onApplicationBootstrap(): Promise<void> {
    this.logger.log('[promo-init] 开始执行推广记录修复与余额校正...');
    try {
      await this.backfillUnchargedPromoRecords();
      this.logger.log('[promo-init] 推广记录修复与余额校正完成');
    } catch (err: unknown) {
      this.logger.warn(
        `[promo-init] 历史推广记录修复失败: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  async previewOrder(
    userId: number,
    storeId: number,
    dto: PreviewPlatformMembershipOrderDto,
  ): Promise<PreviewPlatformMembershipOrderResponseDto> {
    await ensurePlatformMembershipStoreOwner(this.prisma, userId, storeId);

    const requestedPoints = dto.usePoints ?? 0;
    const requestedBeans = dto.useBeans ?? 0;

    const plan = await requirePlan(this.prisma, dto.planId);
    const profile = await ensureMembershipProfile(this.prisma, storeId);
    const partner = await findCurrentStorePartner(this.prisma, storeId);
    const availableBeans = partner?.beanBalance ?? 0;

    const preview = calcPreviewResult({
      planPrice: plan.price,
      requestedPoints,
      availablePoints: profile.availablePoints,
      requestedBeans,
      availableBeans,
    });

    return {
      planPrice: plan.price,
      beanDeductAmount: preview.beanDeductAmount,
      actualBeansUsed: preview.actualBeansUsed,
      pointsDeductAmount: preview.pointsDeductAmount,
      actualPointsUsed: preview.actualPointsUsed,
      finalAmount: preview.finalAmount,
      maxBeanDeductAmount: preview.maxBeanDeductAmount,
      maxPointsDeductAmount: preview.maxPointsDeductAmount,
      canUsePoints: preview.canUsePoints,
      canUseBeans: preview.canUseBeans,
    };
  }

  async purchaseOrder(
    userId: number,
    storeId: number,
    dto: PurchasePlatformMembershipOrderDto,
  ): Promise<PurchasePlatformMembershipOrderResponseDto> {
    await ensurePlatformMembershipStoreOwner(this.prisma, userId, storeId);

    const requestedPoints = dto.usePoints ?? 0;
    const requestedBeans = dto.useBeans ?? 0;

    const response = await this.prisma.$transaction(async (tx) => {
      const plan = await requirePlan(tx, dto.planId);
      const profile = await ensureMembershipProfile(tx, storeId);
      const partner = await findCurrentStorePartner(tx, storeId);
      const availableBeans = partner?.beanBalance ?? 0;
      const payment = calcMemberPlanPayment({
        planPrice: plan.price,
        requestedPoints,
        availablePoints: profile.availablePoints,
        requestedBeans,
        availableBeans,
      });

      if (requestedPoints > 0 && payment.actualPointsUsed === 0) {
        throw new ConflictException('当前无可抵扣积分');
      }

      if (requestedBeans > 0 && payment.actualBeansUsed === 0) {
        throw new ConflictException('当前无可抵扣纯利豆');
      }

      if (payment.actualBeansUsed > 0) {
        // 单合伙人扣减：每个账号只有一个当前合伙人
        if (!partner || partner.beanBalance < payment.actualBeansUsed) {
          throw new ConflictException('纯利豆余额不足，请刷新后重试');
        }

        // 原子 decrement 并校验非负（并发安全）
        const updateResult = await tx.storePartner.updateMany({
          where: {
            id: partner.id,
            storeId,
            status: 'approved',
            beanBalance: { gte: payment.actualBeansUsed },
          },
          data: {
            beanBalance: { decrement: payment.actualBeansUsed },
          },
        });

        if (updateResult.count !== 1) {
          throw new ConflictException('纯利豆余额不足，请刷新后重试');
        }

        await tx.storePartnerBeanLog.create({
          data: {
            storeId,
            partnerId: partner.id,
            source: 'deduct_payment',
            changeAmount: -payment.actualBeansUsed,
            description: `纯利豆抵扣 · 订阅${plan.name}`,
            relatedPlanType: plan.id,
          },
        });
      }

      const bonusPoints = PURCHASE_BONUS_POINTS[plan.id] ?? 0;
      const nextAvailablePoints =
        profile.availablePoints - payment.actualPointsUsed + bonusPoints;
      const nextTotalPoints =
        profile.totalPoints - payment.actualPointsUsed + bonusPoints;
      const now = new Date();
      const isLegacyLifetimeMembership =
        profile.currentPlanId === 'yearly' && profile.expiresAt === null;
      const currentExpiryMs =
        resolveFrontendMembershipExpiry(profile)?.getTime() ?? 0;
      const baseMs =
        currentExpiryMs > now.getTime() ? currentExpiryMs : now.getTime();
      const nextExpiresAt = buildPlanExpiryAt(plan, baseMs);
      const currentActivePlanId =
        currentExpiryMs > now.getTime() ? profile.currentPlanId : null;
      const nextPlanId = isLegacyLifetimeMembership
        ? 'yearly'
        : resolveEffectivePlanId(currentActivePlanId, plan.id);
      const nextStartsAt = isLegacyLifetimeMembership
        ? new Date(nextExpiresAt.getTime() - 730 * DAY_MS)
        : (profile.startsAt ?? now);

      const updatedProfile = await tx.storeMembershipProfile.update({
        where: { id: profile.id },
        data: {
          currentPlanId: nextPlanId,
          startsAt: nextStartsAt,
          expiresAt: isLegacyLifetimeMembership ? null : nextExpiresAt,
          totalPoints: nextTotalPoints,
          availablePoints: nextAvailablePoints,
        },
        select: {
          id: true,
          storeId: true,
          currentPlanId: true,
          startsAt: true,
          expiresAt: true,
          totalPoints: true,
          availablePoints: true,
        },
      });

      if (payment.actualPointsUsed > 0) {
        await tx.storeMembershipPointsLog.create({
          data: {
            storeId,
            profileId: profile.id,
            source: 'deduct_payment',
            changeType: 'decrease',
            changeAmount: payment.actualPointsUsed,
            description: `订阅${plan.name}抵扣`,
          },
        });
      }

      if (bonusPoints > 0) {
        await tx.storeMembershipPointsLog.create({
          data: {
            storeId,
            profileId: profile.id,
            source: 'purchase_bonus',
            changeType: 'increase',
            changeAmount: bonusPoints,
            description: `购买${plan.name}赠积分`,
          },
        });
      }

      const order = await tx.storeMembershipOrder.create({
        data: {
          storeId,
          profileId: profile.id,
          planId: plan.id,
          planName: plan.name,
          originalAmount: plan.price,
          pointsUsed: payment.actualPointsUsed,
          beansUsed: payment.actualBeansUsed,
          amount: payment.finalAmount,
          status: 'paid',
          paymentChannel: 'wechat',
          paymentOrderId: generateWechatOrderId(storeId, now),
          paidAt: now,
        },
        select: {
          id: true,
          planId: true,
          planName: true,
          amount: true,
          pointsUsed: true,
          beansUsed: true,
          status: true,
          paymentChannel: true,
          paymentOrderId: true,
          createdAt: true,
        },
      });

      const [latestPartner, allOrders, inviteCodeRecord] = await Promise.all([
        findCurrentStorePartner(tx, storeId),
        tx.storeMembershipOrder.findMany({
          where: { storeId },
          select: {
            id: true,
            planId: true,
            planName: true,
            amount: true,
            pointsUsed: true,
            beansUsed: true,
            status: true,
            paymentChannel: true,
            paymentOrderId: true,
            createdAt: true,
          },
        }),
        tx.storeInviteCode.findFirst({
          where: { storeId, isActive: true },
          select: { code: true },
          orderBy: { createdAt: 'desc' },
        }),
      ]);

      return {
        order: mapOrder(order),
        profile: buildProfileResponse(
          updatedProfile,
          latestPartner,
          inviteCodeRecord?.code ?? null,
        ),
        overview: buildOrdersOverview(allOrders),
        // 用于事务后异步触发推广奖励
        _planId: plan.id as PlatformMembershipPlanId,
        _amount: payment.finalAmount,
      };
    });

    await this.cacheInvalidatorService.invalidateMembershipDerived(storeId);

    // 提取内部字段，返回干净的响应
    const { _planId, _amount, ...cleanResponse } = response;

    // 首次充值推广奖励（异步，不阻塞订单响应）
    void this.tryAwardPromoReward({
      userId,
      storeId,
      planId: _planId,
      amount: _amount,
    }).catch((err: unknown) => {
      this.logger.warn(
        `推广奖励发放失败（不影响订单）: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    });

    return cleanResponse;
  }

  /**
   * 服务启动时修复历史未充值推广记录。
   * 查找所有 hasCharged=false 的记录，检查被推广人是否已充值，
   * 如果已充值则补发推广奖励。
   */
  private async backfillUnchargedPromoRecords(): Promise<void> {
    // 先清理历史重复豆日志并校正余额
    await this.deduplicatePromoBeanLogs();
    // 校正所有推广人的豆余额（修复历史数据不一致）
    await this.reconcilePartnerBeanBalances();

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

      // 计算合伙人等级
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);
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
   * 清理同一推广记录的重复豆日志。
   * 对每个 promoRecord，只保留最早的一条 promo_reward 日志，
   * 删除多余的并回滚对应的 bean 余额。
   */
  private async deduplicatePromoBeanLogs(): Promise<void> {
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
  private async reconcilePartnerBeanBalances(): Promise<void> {
    // 查找所有有 promo_reward 日志的合伙人
    const partnersWithLogs = await this.prisma.storePartnerBeanLog.groupBy({
      by: ['partnerId'],
      where: { source: 'promo_reward' },
    });

    this.logger.log(
      `[reconcile] 找到 ${partnersWithLogs.length} 个有推广豆日志的合伙人`,
    );

    if (partnersWithLogs.length === 0) return;

    let correctedCount = 0;
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
        this.logger.log(
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

        correctedCount++;
      } else {
        this.logger.log(
          `[reconcile] 合伙人 #${entry.partnerId} 余额已正确: balance=${correctBalance}`,
        );
      }
    }

    for (const storeId of affectedStoreIds) {
      await this.cacheInvalidatorService.invalidateMembershipDerived(storeId);
    }

    if (correctedCount > 0) {
      this.logger.log(`[reconcile] 校正了 ${correctedCount} 个合伙人的豆余额`);
    }
  }

  /**
   * 充值时尝试发放推广奖励。
   * 流程：查询用户手机号 → 匹配未充值推广记录 → 计算纯利豆 → 更新记录 + 发放豆子。
   * 幂等保护：hasCharged 标记为 true 后不会再被查出，避免重复发放。
   */
  private async tryAwardPromoReward(input: {
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

      // 4. 查询合伙人当前等级（通过本月已充值推广人数计算）
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);
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

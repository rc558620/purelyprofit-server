import {
  ConflictException,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../../redis/invalidator';

import { DAY_MS, PURCHASE_BONUS_POINTS } from './platform-membership.constants';
import {
  isRenewalPlanPurchasable,
  SUB_ACCOUNT_PLAN_BLOCKED_MESSAGE,
} from './membership-renewal-policy.shared';
import { resolveEffectivePlanId } from './membership-plan-resolver';
import { StoreMembershipLockedPriceService } from './store-membership-locked-price.service';
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
import type { PlatformMembershipPlanId } from './dto/platform-membership-query.dto';
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
import { PlatformMembershipPromoService } from './platform-membership-promo.service';
import { NewCustomerQuotaService } from '../new-customer-quota/new-customer-quota.service';

@Injectable()
export class PlatformMembershipOrderService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PlatformMembershipOrderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheInvalidatorService: CacheInvalidatorService,
    private readonly promoService: PlatformMembershipPromoService,
    private readonly lockedPriceService: StoreMembershipLockedPriceService,
    private readonly quotaService: NewCustomerQuotaService,
  ) {}

  /** 服务启动后自动修复历史未充值推广记录（在 Redis 就绪后执行） */
  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.promoService.backfillUnchargedPromoRecords();
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

    const pricingContext =
      await this.lockedPriceService.loadRenewalPricingContext(storeId);
    this.assertRenewalPlanAllowed(
      dto.planId,
      pricingContext.subAccountFeatureOwned,
    );

    const { price: planPrice } = this.lockedPriceService.resolvePlanPrice({
      plan,
      context: pricingContext,
    });

    const preview = calcPreviewResult({
      planPrice,
      requestedPoints,
      availablePoints: profile.availablePoints,
      requestedBeans,
      availableBeans,
    });

    return {
      planPrice,
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

      // 曾开通子账号功能的门店按首购锁定价结算；月 / 季会被直接拒绝，避免误降级
      // （会员到期后实时能力会被归零，故必须用「曾开通」口径，否则到期即可降级）
      const pricingContext =
        await this.lockedPriceService.loadRenewalPricingContext(storeId, tx);
      this.assertRenewalPlanAllowed(
        dto.planId,
        pricingContext.subAccountFeatureOwned,
      );
      const { price: planPrice } = this.lockedPriceService.resolvePlanPrice({
        plan,
        context: pricingContext,
      });

      const payment = calcMemberPlanPayment({
        planPrice,
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
          // 下单成功后 currentPlanId 就是最新的续费依据，清掉降级时转存的原档位
          previousPlanId: null,
          startsAt: nextStartsAt,
          expiresAt: isLegacyLifetimeMembership ? null : nextExpiresAt,
          totalPoints: nextTotalPoints,
          availablePoints: nextAvailablePoints,
        },
        select: {
          id: true,
          storeId: true,
          currentPlanId: true,
          previousPlanId: true,
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
          originalAmount: planPrice,
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

      // 首次成交价快照：已存在则不覆盖（锁定语义）
      await this.lockedPriceService.lockPriceOnFirstDeal({
        storeId,
        planId: plan.id,
        price: planPrice,
        source: 'purchase',
        executor: tx,
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

    // 新用户额度：购买 / 续费成功后按档位一次性叠加（失败只告警，不影响订单结果）
    void this.quotaService
      .grantByPlan(storeId, _planId)
      .catch((err: unknown) => {
        this.logger.warn(
          `新用户额度赠送失败（不影响订单）: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });

    // 首次充值推广奖励（异步，不阻塞订单响应）
    void this.promoService
      .tryAwardPromoReward({
        userId,
        storeId,
        planId: _planId,
        amount: _amount,
      })
      .catch((err: unknown) => {
        this.logger.warn(
          `推广奖励发放失败（不影响订单）: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });

    return cleanResponse;
  }

  /**
   * 曾开通子账号功能的门店禁止购买月度 / 季度（否则子账号能力会被配额归零而失效）。
   *
   * 用「曾开通」口径而非实时能力：会员到期后实时能力会被归零，
   * 若按实时能力判断，到期门店可下单降级到月 / 季，直接丢掉子账号与首购锁定价。
   */
  private assertRenewalPlanAllowed(
    planId: PlatformMembershipPlanId,
    subAccountFeatureOwned: boolean,
  ): void {
    if (!isRenewalPlanPurchasable({ planId, subAccountFeatureOwned })) {
      throw new ConflictException(SUB_ACCOUNT_PLAN_BLOCKED_MESSAGE);
    }
  }
}

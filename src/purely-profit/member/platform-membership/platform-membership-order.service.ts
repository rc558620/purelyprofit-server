import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { DAY_MS, PURCHASE_BONUS_POINTS } from './platform-membership.constants';
import {
  buildOrdersOverview,
  buildPlanExpiryAt,
  buildProfileResponse,
  calcMemberPlanPayment,
  generateWechatOrderId,
  mapOrder,
  requireApprovedPartnerOrNull,
  resolveEffectivePlanId,
  resolveFrontendMembershipExpiry,
} from './platform-membership.domain';
import { PurchasePlatformMembershipOrderDto } from './dto/platform-membership-query.dto';
import { PurchasePlatformMembershipOrderResponseDto } from './dto/platform-membership-response.dto';
import {
  ensureMembershipProfile,
  ensurePlatformMembershipStoreOwner,
  findStorePartner,
  requirePlan,
} from './platform-membership.query';

@Injectable()
export class PlatformMembershipOrderService {
  constructor(private readonly prisma: PrismaService) {}

  async purchaseOrder(
    userId: number,
    storeId: number,
    dto: PurchasePlatformMembershipOrderDto,
  ): Promise<PurchasePlatformMembershipOrderResponseDto> {
    await ensurePlatformMembershipStoreOwner(this.prisma, userId, storeId);

    const requestedPoints = dto.usePoints ?? 0;
    const requestedBeans = dto.useBeans ?? 0;

    return this.prisma.$transaction(async (tx) => {
      const plan = await requirePlan(tx, dto.planId);
      const profile = await ensureMembershipProfile(tx, storeId);
      const partner = await findStorePartner(tx, storeId);
      const approvedPartner = requireApprovedPartnerOrNull(partner);
      const payment = calcMemberPlanPayment({
        planPrice: plan.price,
        requestedPoints,
        availablePoints: profile.availablePoints,
        requestedBeans,
        availableBeans: approvedPartner?.beanBalance ?? 0,
      });

      if (requestedPoints > 0 && payment.actualPointsUsed === 0) {
        throw new ConflictException('当前无可抵扣积分');
      }

      if (requestedBeans > 0 && payment.actualBeansUsed === 0) {
        throw new ConflictException('当前无可抵扣纯利豆');
      }

      if (payment.actualBeansUsed > 0 && approvedPartner !== null) {
        const partnerUpdateResult = await tx.storePartner.updateMany({
          where: {
            id: approvedPartner.id,
            storeId,
            status: 'approved',
            beanBalance: { gte: payment.actualBeansUsed },
          },
          data: {
            beanBalance: { decrement: payment.actualBeansUsed },
          },
        });

        if (partnerUpdateResult.count !== 1) {
          throw new ConflictException('纯利豆余额不足，请刷新后重试');
        }

        await tx.storePartnerBeanLog.create({
          data: {
            storeId,
            partnerId: approvedPartner.id,
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
            changeAmount: -payment.actualPointsUsed,
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
          pointsDeducted: payment.pointsDeductAmount,
          pointsUsed: payment.actualPointsUsed,
          beanDeducted: payment.beanDeductAmount,
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
          pointsDeducted: true,
          pointsUsed: true,
          beanDeducted: true,
          beansUsed: true,
          status: true,
          paymentChannel: true,
          paymentOrderId: true,
          createdAt: true,
        },
      });

      const latestPartner = await findStorePartner(tx, storeId);
      const allOrders = await tx.storeMembershipOrder.findMany({
        where: { storeId },
        select: {
          id: true,
          planId: true,
          planName: true,
          amount: true,
          pointsDeducted: true,
          pointsUsed: true,
          beanDeducted: true,
          beansUsed: true,
          status: true,
          paymentChannel: true,
          paymentOrderId: true,
          createdAt: true,
        },
      });

      return {
        order: mapOrder(order),
        profile: buildProfileResponse(updatedProfile, latestPartner),
        overview: buildOrdersOverview(allOrders),
      };
    });
  }
}

import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../../redis/invalidator';
import { DAY_MS, PURCHASE_BONUS_POINTS } from './platform-membership.constants';
import { resolveEffectivePlanId } from './membership-plan-resolver';
import {
  buildPlanExpiryAt,
  resolveFrontendMembershipExpiry,
} from './membership-expiry.utils';
import { buildProfileResponse } from './membership-profile.mapper';
import {
  allocateBeansAcrossPartners,
  buildOrdersOverview,
  calcMemberPlanPayment,
  generateWechatOrderId,
  mapOrder,
} from './platform-membership-ledger.domain';
import { PurchasePlatformMembershipOrderDto } from './dto/platform-membership-query.dto';
import { PurchasePlatformMembershipOrderResponseDto } from './dto/platform-membership-response.dto';
import {
  ensureMembershipProfile,
  ensurePlatformMembershipStoreOwner,
  findStorePartners,
  requirePlan,
} from './platform-membership.query';

@Injectable()
export class PlatformMembershipOrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheInvalidatorService: CacheInvalidatorService,
  ) {}

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
      const partners = await findStorePartners(tx, storeId);
      const availableBeans = partners.reduce(
        (sum, partner) => sum + partner.beanBalance,
        0,
      );
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
        const allocations = allocateBeansAcrossPartners(
          partners,
          payment.actualBeansUsed,
        );

        // 前置批量校验：一次性查出所有涉及的 partner，校验归属和状态
        const allocationIds = allocations.map((a) => a.partnerId);
        const partnersBefore = await tx.storePartner.findMany({
          where: { id: { in: allocationIds } },
          select: { id: true, storeId: true, status: true },
        });
        const partnerBeforeMap = new Map(partnersBefore.map((p) => [p.id, p]));

        for (const allocation of allocations) {
          const partnerBefore = partnerBeforeMap.get(allocation.partnerId);
          if (
            !partnerBefore ||
            partnerBefore.storeId !== storeId ||
            partnerBefore.status !== 'approved'
          ) {
            throw new ConflictException('纯利豆余额不足，请刷新后重试');
          }
        }

        // 逐条原子 decrement（保证并发安全），但省去前置和后置的 N 次 findUnique
        // 仍需逐条执行：每个 allocation.beans 不同，无法用 updateMany 统一 decrement
        for (const allocation of allocations) {
          await tx.storePartner.update({
            where: { id: allocation.partnerId },
            data: {
              beanBalance: { decrement: allocation.beans },
            },
          });
        }

        // 扣减后批量读取余额，一次性校验非负防止超扣
        const partnersAfter = await tx.storePartner.findMany({
          where: { id: { in: allocationIds } },
          select: { id: true, beanBalance: true },
        });
        for (const partner of partnersAfter) {
          if (partner.beanBalance < 0) {
            throw new ConflictException('纯利豆余额不足，请刷新后重试');
          }
        }

        // 批量写入纯利豆日志，替代逐条 create
        await tx.storePartnerBeanLog.createMany({
          data: allocations.map((allocation) => ({
            storeId,
            partnerId: allocation.partnerId,
            source: 'deduct_payment',
            changeAmount: -allocation.beans,
            description: `纯利豆抵扣 · 订阅${plan.name}`,
            relatedPlanType: plan.id,
          })),
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

      const [latestPartners, allOrders, inviteCodeRecord] = await Promise.all([
        findStorePartners(tx, storeId),
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
          latestPartners,
          inviteCodeRecord?.code ?? null,
        ),
        overview: buildOrdersOverview(allOrders),
      };
    });

    await this.cacheInvalidatorService.invalidateMembershipDerived(storeId);

    return response;
  }
}

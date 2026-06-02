import { Injectable } from '@nestjs/common';
import type { PlatformMembershipPlanId } from './dto/platform-membership-query.dto';
import type {
  PlatformMembershipCenterResponseDto,
  PlatformMembershipOrdersResponseDto,
  PlatformMembershipPlanResponseDto,
  PlatformMembershipPlanRulesResponseDto,
  PlatformMembershipProfileResponseDto,
  PlatformMembershipPromoCenterResponseDto,
} from './dto/platform-membership-response.dto';
import { PLAN_RULES } from './platform-membership.constants';
import {
  buildOrdersOverview,
  buildProfileResponse,
  calcRemainingDays,
  mapOrder,
} from './platform-membership.domain';
import { buildCurrentPartnerApplication } from './platform-membership-partner.domain';
import {
  buildCenterStats,
  buildPartnerLevel,
  buildPromotionDetailCompatResponse,
  buildPromoStatsByPeriod,
  filterPromoRecordsForCompat,
  mapPromoRecord,
  resolvePromoDetailCompatFilters,
} from './platform-membership-promo.domain';
import {
  ensureMembershipProfile,
  findStoreMembershipPromoRecords,
  findStorePartnerApplications,
  findStorePartners,
  loadPlanCatalog,
  requirePlan,
} from './platform-membership.query';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  MembershipPlanConfig,
  PromotionDetailCompatResponse,
} from './platform-membership.types';

@Injectable()
export class PlatformMembershipReadService {
  constructor(private readonly prisma: PrismaService) {}

  async listPlans(): Promise<PlatformMembershipPlanResponseDto[]> {
    const plans = await loadPlanCatalog(this.prisma);
    return plans.map((plan) => ({ ...plan }));
  }

  async getPlanConfig(
    planId: PlatformMembershipPlanId,
  ): Promise<MembershipPlanConfig> {
    return requirePlan(this.prisma, planId);
  }

  listPlanRules(): PlatformMembershipPlanRulesResponseDto {
    return {
      rows: PLAN_RULES.map((row) => ({ ...row })),
    };
  }

  async getCenterByStoreId(
    storeId: number,
  ): Promise<PlatformMembershipCenterResponseDto> {
    const [profile, partners, paidOrderCount, promoRecords, applications] =
      await Promise.all([
        ensureMembershipProfile(this.prisma, storeId),
        findStorePartners(this.prisma, storeId),
        this.prisma.storeMembershipOrder.count({
          where: { storeId, status: 'paid' },
        }),
        findStoreMembershipPromoRecords(this.prisma, storeId),
        findStorePartnerApplications(this.prisma, storeId),
      ]);

    const profileResponse = buildProfileResponse(profile, partners);

    return {
      memberInfo: profileResponse.memberInfo,
      remainingDays: calcRemainingDays(profile),
      stats: buildCenterStats(promoRecords, profileResponse.approvedPartners.length),
      paidOrderCount,
      myPartnerApplication: buildCurrentPartnerApplication(
        applications,
        partners,
      ),
      approvedPartner: profileResponse.approvedPartner,
      approvedPartners: profileResponse.approvedPartners,
    };
  }

  async getProfileByStoreId(
    storeId: number,
  ): Promise<PlatformMembershipProfileResponseDto> {
    const [profile, partners] = await Promise.all([
      ensureMembershipProfile(this.prisma, storeId),
      findStorePartners(this.prisma, storeId),
    ]);

    return buildProfileResponse(profile, partners);
  }

  async listOrdersByStoreId(
    storeId: number,
  ): Promise<PlatformMembershipOrdersResponseDto> {
    await ensureMembershipProfile(this.prisma, storeId);

    const orders = await this.prisma.storeMembershipOrder.findMany({
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
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    return {
      overview: buildOrdersOverview(orders),
      items: orders.map((order) => mapOrder(order)),
    };
  }

  async getPromoCenterByStoreId(
    storeId: number,
  ): Promise<PlatformMembershipPromoCenterResponseDto> {
    const [profile, partners, promoRecords] = await Promise.all([
      ensureMembershipProfile(this.prisma, storeId),
      findStorePartners(this.prisma, storeId),
      findStoreMembershipPromoRecords(this.prisma, storeId),
    ]);
    const statsByPeriod = buildPromoStatsByPeriod(promoRecords);
    const profileResponse = buildProfileResponse(profile, partners);
    const primaryPartner = partners[0] ?? null;

    return {
      memberInfo: profileResponse.memberInfo,
      approvedPartner: profileResponse.approvedPartner,
      approvedPartners: profileResponse.approvedPartners,
      level: buildPartnerLevel(primaryPartner, promoRecords),
      stats: statsByPeriod.all,
      statsByPeriod,
      items: promoRecords.map((record) => mapPromoRecord(record)),
    };
  }

  async getPromotionDetailCompat(
    storeId: number,
    rawQuery: Record<string, unknown>,
  ): Promise<PromotionDetailCompatResponse> {
    const [profile, partners, promoRecords] = await Promise.all([
      ensureMembershipProfile(this.prisma, storeId),
      findStorePartners(this.prisma, storeId),
      findStoreMembershipPromoRecords(this.prisma, storeId),
    ]);
    const filters = resolvePromoDetailCompatFilters(rawQuery);
    const filteredRecords = filterPromoRecordsForCompat(promoRecords, filters);

    return buildPromotionDetailCompatResponse({
      profile,
      partner: partners[0] ?? null,
      promoRecords,
      filteredRecords,
      filters,
    });
  }
}

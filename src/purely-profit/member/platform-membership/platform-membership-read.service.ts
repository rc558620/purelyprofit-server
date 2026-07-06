import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
import { normalizeMembershipProfileFromPaidOrders } from './membership-plan-resolver';
import { calcRemainingDays } from './membership-expiry.utils';
import { buildProfileResponse } from './membership-profile.mapper';
import { mapOrder } from './platform-membership-ledger.domain';
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
  findCurrentStorePartner,
  findPaidStoreMembershipOrders,
  findStoreMembershipPromoRecords,
  findStorePartnerApplications,
  loadPlanCatalog,
  requirePlan,
} from './platform-membership.query';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  buildPaginationMeta,
  resolvePagination,
} from '../../commerce/commerce.utils';
import type {
  MembershipPlanConfig,
  PromotionDetailCompatResponse,
} from './platform-membership.types';

@Injectable()
export class PlatformMembershipReadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

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
    const [
      profile,
      partner,
      paidOrders,
      promoRecords,
      applications,
      plans,
      inviteCodeRecord,
    ] = await Promise.all([
      ensureMembershipProfile(this.prisma, storeId),
      findCurrentStorePartner(this.prisma, storeId),
      findPaidStoreMembershipOrders(this.prisma, storeId),
      findStoreMembershipPromoRecords(this.prisma, storeId),
      findStorePartnerApplications(this.prisma, storeId),
      loadPlanCatalog(this.prisma),
      this.prisma.storeInviteCode.findFirst({
        where: { storeId, isActive: true },
        select: { code: true },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    const effectiveProfile = normalizeMembershipProfileFromPaidOrders({
      profile,
      paidOrders,
      plans,
    });
    const profileResponse = buildProfileResponse(
      effectiveProfile,
      partner,
      inviteCodeRecord?.code ?? null,
    );

    return {
      memberInfo: profileResponse.memberInfo,
      remainingDays: calcRemainingDays(effectiveProfile),
      stats: buildCenterStats(
        promoRecords,
        profileResponse.approvedPartners.length,
      ),
      paidOrderCount: paidOrders.length,
      myPartnerApplication: buildCurrentPartnerApplication(
        applications,
        partner,
      ),
      approvedPartner: profileResponse.approvedPartner,
      approvedPartners: profileResponse.approvedPartners,
    };
  }

  async getProfileByStoreId(
    storeId: number,
  ): Promise<PlatformMembershipProfileResponseDto> {
    const [profile, partner, paidOrders, plans, inviteCodeRecord] =
      await Promise.all([
        ensureMembershipProfile(this.prisma, storeId),
        findCurrentStorePartner(this.prisma, storeId),
        findPaidStoreMembershipOrders(this.prisma, storeId),
        loadPlanCatalog(this.prisma),
        this.prisma.storeInviteCode.findFirst({
          where: { storeId, isActive: true },
          select: { code: true },
          orderBy: { createdAt: 'desc' },
        }),
      ]);
    const effectiveProfile = normalizeMembershipProfileFromPaidOrders({
      profile,
      paidOrders,
      plans,
    });

    return buildProfileResponse(
      effectiveProfile,
      partner,
      inviteCodeRecord?.code ?? null,
    );
  }

  async listOrdersByStoreId(
    storeId: number,
    page?: number,
    pageSize?: number,
  ): Promise<PlatformMembershipOrdersResponseDto> {
    await ensureMembershipProfile(this.prisma, storeId);

    const defaultPageSize =
      this.configService.get<number>('app.defaultPageSize') ?? 20;
    const maxPageSize =
      this.configService.get<number>('app.maxPageSize') ?? 100;
    const {
      page: resolvedPage,
      skip,
      take,
    } = resolvePagination(page, pageSize, defaultPageSize, maxPageSize);

    const orderSelect = {
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
    } as const;

    const [total, orders, amountRows] = await Promise.all([
      this.prisma.storeMembershipOrder.count({ where: { storeId } }),
      this.prisma.storeMembershipOrder.findMany({
        where: { storeId },
        select: orderSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
      this.prisma.storeMembershipOrder.findMany({
        where: { storeId },
        select: { amount: true },
      }),
    ]);

    const totalAmount = amountRows.reduce((sum, r) => sum + r.amount, 0);

    return {
      overview: { orderCount: total, totalAmount },
      items: orders.map((order) => mapOrder(order)),
      meta: buildPaginationMeta(total, resolvedPage, take),
    };
  }

  async getPromoCenterByStoreId(
    storeId: number,
  ): Promise<PlatformMembershipPromoCenterResponseDto> {
    const [
      profile,
      partner,
      promoRecords,
      paidOrders,
      plans,
      inviteCodeRecord,
    ] = await Promise.all([
      ensureMembershipProfile(this.prisma, storeId),
      findCurrentStorePartner(this.prisma, storeId),
      findStoreMembershipPromoRecords(this.prisma, storeId),
      findPaidStoreMembershipOrders(this.prisma, storeId),
      loadPlanCatalog(this.prisma),
      this.prisma.storeInviteCode.findFirst({
        where: { storeId, isActive: true },
        select: { code: true },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    const effectiveProfile = normalizeMembershipProfileFromPaidOrders({
      profile,
      paidOrders,
      plans,
    });
    const statsByPeriod = buildPromoStatsByPeriod(promoRecords);
    const profileResponse = buildProfileResponse(
      effectiveProfile,
      partner,
      inviteCodeRecord?.code ?? null,
    );

    return {
      memberInfo: profileResponse.memberInfo,
      approvedPartner: profileResponse.approvedPartner,
      approvedPartners: profileResponse.approvedPartners,
      level: buildPartnerLevel(partner, promoRecords),
      stats: statsByPeriod.all,
      statsByPeriod,
      items: promoRecords.map((record) => mapPromoRecord(record)),
    };
  }

  async getPromotionDetailCompat(
    storeId: number,
    rawQuery: Record<string, unknown>,
  ): Promise<PromotionDetailCompatResponse> {
    const [
      profile,
      partner,
      promoRecords,
      paidOrders,
      plans,
      inviteCodeRecord,
    ] = await Promise.all([
      ensureMembershipProfile(this.prisma, storeId),
      findCurrentStorePartner(this.prisma, storeId),
      findStoreMembershipPromoRecords(this.prisma, storeId),
      findPaidStoreMembershipOrders(this.prisma, storeId),
      loadPlanCatalog(this.prisma),
      this.prisma.storeInviteCode.findFirst({
        where: { storeId, isActive: true },
        select: { code: true },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    const effectiveProfile = normalizeMembershipProfileFromPaidOrders({
      profile,
      paidOrders,
      plans,
    });
    const filters = resolvePromoDetailCompatFilters(rawQuery);
    const filteredRecords = filterPromoRecordsForCompat(promoRecords, filters);

    return buildPromotionDetailCompatResponse({
      profile: effectiveProfile,
      partner,
      promoRecords,
      filteredRecords,
      filters,
      inviteCode: inviteCodeRecord?.code ?? null,
    });
  }
}

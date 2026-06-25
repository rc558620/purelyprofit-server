import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { GetPulseAdminMembersQueryDto } from './dto/pulse-membership-admin-members.request.dto';
import type {
  PulseMemberDetailDto,
  PulseMemberListItemDto,
} from './dto/pulse-membership-admin-members.response.dto';
import { PulseMembershipAccessService } from './membership-access.service';
import {
  buildPulseAdminMemberDetail,
  buildPulseAdminMemberListItem,
} from './membership-admin-member.builder';
import {
  buildAdminMemberListStoreWhere,
  type LegacyPulseAdminMembershipProfileRecord,
  type PulseAdminMembershipProfileListRecord,
  isMissingSubAccountQuotaSchemaError,
  matchesAdminMemberFilters,
} from './membership-admin-query.helper';
import type {
  PulseAdminMemberOrderSummary,
  PulseAdminMembershipOrderRecord,
  PulseAdminMembershipProfileRecord,
  PulseAdminPartnerRecord,
  PulseAdminStoreRecord,
  PulseAdminSubAccountDetail,
} from './membership.types';
import { PulseMembershipAdminSubAccountReadService } from './membership-admin-sub-account-read.service';

type PulseAdminPaidOrderSummaryGroup = {
  storeId: number;
  _count: { _all: number };
  _sum: { amount: number | null };
  _max: { createdAt: Date | null };
};

type PulseAdminMemberListDependencies = {
  profileByStoreId: Map<number, PulseAdminMembershipProfileRecord>;
  orderSummaryByStoreId: Map<number, PulseAdminMemberOrderSummary>;
  partnerByStoreId: Map<number, PulseAdminPartnerRecord>;
  banReasons: Map<number, string>;
};

type PulseAdminMemberDetailSnapshot = {
  store: PulseAdminStoreRecord;
  profile: PulseAdminMembershipProfileRecord | null;
  paidOrders: PulseAdminMembershipOrderRecord[];
  partner: PulseAdminPartnerRecord | null;
  promoCount: number;
  subAccountSummary: PulseAdminSubAccountDetail;
  banReason: string | null;
};

@Injectable()
export class PulseMembershipAdminMemberReadService {
  private readonly logger = new Logger(
    PulseMembershipAdminMemberReadService.name,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly accessService: PulseMembershipAccessService,
    private readonly subAccountReadService: PulseMembershipAdminSubAccountReadService,
  ) {}

  async buildAdminMemberDetail(storeId: number): Promise<PulseMemberDetailDto> {
    const snapshot = await this.loadAdminMemberDetailSnapshot(storeId);

    return buildPulseAdminMemberDetail(snapshot);
  }

  async buildAdminMemberListItems(
    storeIds: number[],
    query: GetPulseAdminMembersQueryDto,
  ): Promise<PulseMemberListItemDto[]> {
    if (storeIds.length === 0) {
      return [];
    }

    const stores = await this.prisma.store.findMany({
      where: buildAdminMemberListStoreWhere(storeIds, query),
      select: {
        id: true,
        name: true,
        contactPhone: true,
        createdAt: true,
        updatedAt: true,
        owner: {
          select: {
            email: true,
            name: true,
            realName: true,
            avatar: true,
            lastActiveAt: true,
          },
        },
      },
      orderBy: [{ id: 'asc' }],
    });
    if (stores.length === 0) {
      return [];
    }

    const dependencies = await this.loadAdminMemberListDependencies(
      stores.map((store) => store.id),
    );

    return stores
      .map((store) =>
        buildPulseAdminMemberListItem({
          store,
          profile: dependencies.profileByStoreId.get(store.id) ?? null,
          orderSummary: dependencies.orderSummaryByStoreId.get(store.id),
          partner: dependencies.partnerByStoreId.get(store.id) ?? null,
          banReason: dependencies.banReasons.get(store.id) ?? null,
        }),
      )
      .filter((member) => matchesAdminMemberFilters(member, query));
  }

  async findMembershipProfileByStoreId(
    storeId: number,
  ): Promise<PulseAdminMembershipProfileRecord | null> {
    try {
      return await this.prisma.storeMembershipProfile.findUnique({
        where: { storeId },
        select: {
          currentPlanId: true,
          expiresAt: true,
          totalPoints: true,
          availablePoints: true,
          subAccountQuota: true,
        },
      });
    } catch (error: unknown) {
      if (!isMissingSubAccountQuotaSchemaError(error)) {
        throw error;
      }

      this.logger.warn(
        '[pulse-membership-admin] store_membership_profiles.sub_account_quota schema not ready, fallback to legacy profile query',
      );

      const profile = await this.prisma.storeMembershipProfile.findUnique({
        where: { storeId },
        select: {
          currentPlanId: true,
          expiresAt: true,
          totalPoints: true,
          availablePoints: true,
        },
      });

      return profile
        ? {
            ...profile,
            subAccountQuota: 0,
          }
        : null;
    }
  }

  private async loadAdminMemberDetailSnapshot(
    storeId: number,
  ): Promise<PulseAdminMemberDetailSnapshot> {
    const banReason = await this.accessService.getAdminMemberBanReason(storeId);
    const [store, profile, paidOrders, partner, promoCount, subAccountSummary] =
      await Promise.all([
        this.prisma.store.findUnique({
          where: { id: storeId },
          select: {
            id: true,
            name: true,
            contactPhone: true,
            createdAt: true,
            updatedAt: true,
            owner: {
              select: {
                email: true,
                name: true,
                realName: true,
                avatar: true,
                lastActiveAt: true,
              },
            },
          },
        }),
        this.findMembershipProfileByStoreId(storeId),
        this.loadPaidOrders(storeId),
        this.loadApprovedPartner(storeId),
        this.prisma.storeMembershipPromoRecord.count({
          where: { storeId },
        }),
        this.subAccountReadService.buildAdminSubAccountDetail(storeId),
      ]);

    if (!store) {
      throw new NotFoundException('目标门店不存在');
    }

    return {
      store,
      profile,
      paidOrders,
      partner,
      promoCount,
      subAccountSummary,
      banReason,
    };
  }

  private async loadPaidOrders(
    storeId: number,
  ): Promise<PulseAdminMembershipOrderRecord[]> {
    return this.prisma.storeMembershipOrder.findMany({
      where: { storeId, status: 'paid' },
      select: {
        id: true,
        planId: true,
        planName: true,
        amount: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  private async loadApprovedPartner(
    storeId: number,
  ): Promise<PulseAdminPartnerRecord | null> {
    return this.prisma.storePartner.findFirst({
      where: { storeId, status: 'approved' },
      select: {
        id: true,
        beanBalance: true,
        status: true,
        totalEarnedBeans: true,
        totalWithdrawnBeans: true,
      },
      orderBy: [{ reviewedAt: 'desc' }, { joinedAt: 'desc' }, { id: 'desc' }],
    });
  }

  private async loadAdminMemberListDependencies(
    storeIds: number[],
  ): Promise<PulseAdminMemberListDependencies> {
    const [profiles, paidOrderSummaries, partners, banReasons] =
      await Promise.all([
        this.findMembershipProfilesByStoreIds(storeIds),
        this.prisma.storeMembershipOrder.groupBy({
          by: ['storeId'],
          where: {
            storeId: { in: storeIds },
            status: 'paid',
          },
          _count: { _all: true },
          _sum: { amount: true },
          _max: { createdAt: true },
        }),
        this.prisma.storePartner.findMany({
          where: {
            storeId: { in: storeIds },
            status: 'approved',
          },
          select: {
            storeId: true,
            id: true,
            status: true,
            beanBalance: true,
            totalEarnedBeans: true,
            totalWithdrawnBeans: true,
          },
          orderBy: [
            { storeId: 'asc' },
            { reviewedAt: 'desc' },
            { joinedAt: 'desc' },
            { id: 'desc' },
          ],
        }),
        this.accessService.listAdminMemberBanReasons(storeIds),
      ]);

    return {
      profileByStoreId: new Map(
        profiles.map((profile) => [profile.storeId, profile]),
      ),
      orderSummaryByStoreId:
        this.buildOrderSummaryByStoreId(paidOrderSummaries),
      partnerByStoreId: this.buildPartnerByStoreId(partners),
      banReasons,
    };
  }

  private buildOrderSummaryByStoreId(
    paidOrderSummaries: PulseAdminPaidOrderSummaryGroup[],
  ): Map<number, PulseAdminMemberOrderSummary> {
    return new Map(
      paidOrderSummaries.map((summary) => [
        summary.storeId,
        {
          rechargeCount: summary._count._all,
          totalRecharged: summary._sum.amount ?? 0,
          lastPaidAt: summary._max.createdAt?.getTime() ?? null,
        },
      ]),
    );
  }

  private buildPartnerByStoreId(
    partners: Array<PulseAdminPartnerRecord & { storeId: number }>,
  ): Map<number, PulseAdminPartnerRecord> {
    const partnerByStoreId = new Map<number, PulseAdminPartnerRecord>();
    for (const partner of partners) {
      if (!partnerByStoreId.has(partner.storeId)) {
        partnerByStoreId.set(partner.storeId, {
          id: partner.id,
          status: partner.status,
          beanBalance: partner.beanBalance,
          totalEarnedBeans: partner.totalEarnedBeans,
          totalWithdrawnBeans: partner.totalWithdrawnBeans,
        });
      }
    }

    return partnerByStoreId;
  }

  private async findMembershipProfilesByStoreIds(
    storeIds: number[],
  ): Promise<PulseAdminMembershipProfileListRecord[]> {
    try {
      return await this.prisma.storeMembershipProfile.findMany({
        where: { storeId: { in: storeIds } },
        select: {
          storeId: true,
          currentPlanId: true,
          expiresAt: true,
          totalPoints: true,
          availablePoints: true,
          subAccountQuota: true,
        },
      });
    } catch (error: unknown) {
      if (!isMissingSubAccountQuotaSchemaError(error)) {
        throw error;
      }

      this.logger.warn(
        '[pulse-membership-admin] store_membership_profiles.sub_account_quota schema not ready, fallback to legacy profile list query',
      );

      const profiles = await this.prisma.storeMembershipProfile.findMany({
        where: { storeId: { in: storeIds } },
        select: {
          storeId: true,
          currentPlanId: true,
          expiresAt: true,
          totalPoints: true,
          availablePoints: true,
        },
      });

      return profiles.map(
        (profile): PulseAdminMembershipProfileListRecord => ({
          ...(profile as LegacyPulseAdminMembershipProfileRecord & {
            storeId: number;
          }),
          subAccountQuota: 0,
        }),
      );
    }
  }
}

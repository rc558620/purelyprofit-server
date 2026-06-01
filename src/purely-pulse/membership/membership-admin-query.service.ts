import { Injectable, NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PlatformMembershipAccessService } from '../../purely-profit/member/platform-membership/platform-membership-access.service';
import { StoreSubAccountService } from '../../purely-profit/member/platform-membership/store-sub-account.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { GetPulseAdminMemberLogsQueryDto } from './dto/pulse-membership-admin-logs.request.dto';
import type {
  PulseAdminMemberBeanLogsResponseDto,
  PulseAdminMemberPointsLogsResponseDto,
} from './dto/pulse-membership-admin-logs.response.dto';
import type { GetPulseAdminMembersQueryDto } from './dto/pulse-membership-admin-members.request.dto';
import type {
  PulseAdminEmployeeCandidateDto,
  PulseAdminMembersResponseDto,
  PulseMemberDetailDto,
  PulseMemberListItemDto,
} from './dto/pulse-membership-admin-members.response.dto';
import { PulseMembershipAccessService } from './membership-access.service';
import {
  buildPulseAdminBeanLogItem,
  buildPulseAdminMemberDetail,
  buildPulseAdminMemberListItem,
  buildPulseAdminPointsLogItem,
} from './membership-admin-member.builder';
import {
  buildAdminMemberListStoreWhere,
  encodeAdminMemberLogsCursor,
  type LegacyPulseAdminMembershipProfileRecord,
  type PulseAdminMembershipProfileListRecord,
  isMissingSubAccountQuotaSchemaError,
  matchesAdminMemberFilters,
  resolveAdminMemberLogsCursorPagination,
} from './membership-admin-query.helper';
import type {
  PulseAdminMembershipOrderRecord,
  PulseAdminMembershipProfileRecord,
  PulseAdminPartnerRecord,
  PulseAdminStoreRecord,
  PulseAdminSubAccountDetail,
} from './membership.types';

@Injectable()
export class PulseMembershipAdminQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessService: PulseMembershipAccessService,
    private readonly storeSubAccountService: StoreSubAccountService,
    private readonly platformMembershipAccessService: PlatformMembershipAccessService,
  ) {}

  async listAdminPointsLogs(
    user: AuthenticatedUser,
    query: GetPulseAdminMemberLogsQueryDto,
  ): Promise<PulseAdminMemberPointsLogsResponseDto> {
    const storeIds = await this.accessService.resolveAdminMemberStoreIds(user);
    const cursorPagination = resolveAdminMemberLogsCursorPagination(query);
    const logs = await this.prisma.storeMembershipPointsLog.findMany({
      where: {
        storeId: { in: storeIds },
        ...(cursorPagination.cursor
          ? {
              OR: [
                { createdAt: { lt: cursorPagination.cursor.createdAt } },
                {
                  createdAt: cursorPagination.cursor.createdAt,
                  id: { lt: cursorPagination.cursor.id },
                },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        storeId: true,
        source: true,
        changeAmount: true,
        description: true,
        expireAt: true,
        createdAt: true,
        store: {
          select: {
            name: true,
            contactPhone: true,
            owner: {
              select: {
                email: true,
                name: true,
                realName: true,
              },
            },
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...(cursorPagination.limit !== undefined
        ? { take: cursorPagination.limit + 1 }
        : {}),
    });
    const hasMore =
      cursorPagination.limit !== undefined &&
      logs.length > cursorPagination.limit;
    const visibleLogs = hasMore ? logs.slice(0, cursorPagination.limit) : logs;

    return {
      items: visibleLogs.map(buildPulseAdminPointsLogItem),
      hasMore,
      nextCursor: hasMore
        ? encodeAdminMemberLogsCursor(visibleLogs.at(-1) ?? null)
        : null,
    };
  }

  async listAdminBeanLogs(
    user: AuthenticatedUser,
    query: GetPulseAdminMemberLogsQueryDto,
  ): Promise<PulseAdminMemberBeanLogsResponseDto> {
    const storeIds = await this.accessService.resolveAdminMemberStoreIds(user);
    const cursorPagination = resolveAdminMemberLogsCursorPagination(query);
    const logs = await this.prisma.storePartnerBeanLog.findMany({
      where: {
        storeId: { in: storeIds },
        ...(cursorPagination.cursor
          ? {
              OR: [
                { createdAt: { lt: cursorPagination.cursor.createdAt } },
                {
                  createdAt: cursorPagination.cursor.createdAt,
                  id: { lt: cursorPagination.cursor.id },
                },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        storeId: true,
        source: true,
        changeAmount: true,
        description: true,
        relatedPromoRecordId: true,
        relatedUser: true,
        createdAt: true,
        store: {
          select: {
            name: true,
            contactPhone: true,
            owner: {
              select: {
                email: true,
                name: true,
                realName: true,
              },
            },
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...(cursorPagination.limit !== undefined
        ? { take: cursorPagination.limit + 1 }
        : {}),
    });
    const hasMore =
      cursorPagination.limit !== undefined &&
      logs.length > cursorPagination.limit;
    const visibleLogs = hasMore ? logs.slice(0, cursorPagination.limit) : logs;

    return {
      items: visibleLogs.map(buildPulseAdminBeanLogItem),
      hasMore,
      nextCursor: hasMore
        ? encodeAdminMemberLogsCursor(visibleLogs.at(-1) ?? null)
        : null,
    };
  }

  async listAdminMembers(
    user: AuthenticatedUser,
    query: GetPulseAdminMembersQueryDto,
  ): Promise<PulseAdminMembersResponseDto> {
    const storeIds = await this.accessService.resolveAdminMemberStoreIds(user);
    const items = await this.buildAdminMemberListItems(storeIds, query);

    return {
      items,
      total: items.length,
    };
  }

  async getAdminMemberDetail(
    user: AuthenticatedUser,
    memberId: number,
  ): Promise<PulseMemberDetailDto> {
    const canAccess = await this.accessService.canAccessAdminMember(
      user,
      memberId,
    );
    if (!canAccess) {
      throw new NotFoundException('会员不存在');
    }

    return this.buildAdminMemberDetail(memberId);
  }

  /**
   * 获取指定门店的在职员工候选列表，用于子账号槽位分配
   */
  async listAdminMemberEmployeeCandidates(
    user: AuthenticatedUser,
    memberId: number,
  ): Promise<PulseAdminEmployeeCandidateDto[]> {
    const canAccess = await this.accessService.canAccessAdminMember(
      user,
      memberId,
    );
    if (!canAccess) {
      throw new NotFoundException('会员不存在');
    }

    return this.buildAdminEmployeeCandidates(memberId);
  }

  async buildAdminMemberDetail(storeId: number): Promise<PulseMemberDetailDto> {
    const banReason = await this.accessService.getAdminMemberBanReason(storeId);
    const [
      store,
      profile,
      paidOrders,
      partner,
      promoCount,
      subAccountSummary,
    ]: [
      PulseAdminStoreRecord | null,
      PulseAdminMembershipProfileRecord | null,
      PulseAdminMembershipOrderRecord[],
      PulseAdminPartnerRecord | null,
      number,
      PulseAdminSubAccountDetail,
    ] = await Promise.all([
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
            },
          },
        },
      }),
      this.findMembershipProfileByStoreId(storeId),
      this.prisma.storeMembershipOrder.findMany({
        where: { storeId, status: 'paid' },
        select: {
          id: true,
          planId: true,
          planName: true,
          amount: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.storePartner.findFirst({
        where: { storeId, status: 'approved' },
        select: {
          id: true,
          beanBalance: true,
          status: true,
          totalEarnedBeans: true,
          totalWithdrawnBeans: true,
        },
        orderBy: [{ reviewedAt: 'desc' }, { joinedAt: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.storeMembershipPromoRecord.count({
        where: { storeId },
      }),
      this.buildAdminSubAccountDetail(storeId),
    ]);

    if (!store) {
      throw new NotFoundException('目标门店不存在');
    }

    return buildPulseAdminMemberDetail({
      store,
      profile,
      paidOrders,
      partner,
      promoCount,
      subAccountSummary,
      banReason,
    });
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

      console.warn(
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

  private async buildAdminSubAccountDetail(
    storeId: number,
  ): Promise<PulseAdminSubAccountDetail> {
    const benefitSnapshot =
      await this.platformMembershipAccessService.getSubAccountBenefitSnapshot(
        storeId,
      );
    const summary =
      await this.storeSubAccountService.getStoreSubAccountSummary(storeId);

    return {
      eligible: benefitSnapshot.eligible,
      quota: summary.quota,
      quotaMax: benefitSnapshot.quotaMax,
      enabled: benefitSnapshot.enabled,
      usedCount: summary.usedCount,
      availableCount: summary.availableCount,
      roleSummary: summary.roleSummary.map((item) => ({
        role: item.role,
        activeCount: item.activeCount,
        inactiveCount: item.inactiveCount,
        disabledCount: item.disabledCount,
        assignedCount: item.assignedCount,
      })),
      slots: summary.slots.map((slot) => ({
        id: slot.id,
        slotIndex: slot.slotIndex,
        role: slot.role,
        status: slot.status,
        isAssigned: slot.isAssigned,
        employeeId: slot.employeeId,
        employeeName: slot.employeeName,
        canAccessHome: slot.canAccessHome,
        canUseHandover: slot.canUseHandover,
      })),
    };
  }

  /**
   * 构建门店在职员工候选列表，用于子账号槽位分配下拉选择
   */
  private async buildAdminEmployeeCandidates(
    storeId: number,
  ): Promise<PulseAdminEmployeeCandidateDto[]> {
    const [employees, subAccountSlots] = await Promise.all([
      this.prisma.employee.findMany({
        where: {
          storeId,
          status: 'active',
        },
        select: {
          id: true,
          name: true,
          position: true,
          department: true,
        },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.storeSubAccount.findMany({
        where: {
          storeId,
          isAssigned: true,
        },
        select: {
          employeeId: true,
          slotIndex: true,
        },
      }),
    ]);

    const employeeSlotMap = new Map<number, number>();
    for (const slot of subAccountSlots) {
      if (slot.employeeId) {
        employeeSlotMap.set(slot.employeeId, slot.slotIndex);
      }
    }

    return employees.map((employee) => ({
      id: String(employee.id),
      name: employee.name,
      position: employee.position ?? undefined,
      department: employee.department ?? undefined,
      hasSubAccount: employeeSlotMap.has(employee.id),
      assignedSlotIndex: employeeSlotMap.get(employee.id),
    }));
  }

  private async buildAdminMemberListItems(
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
          },
        },
      },
      orderBy: [{ id: 'asc' }],
    });
    if (stores.length === 0) {
      return [];
    }

    const resolvedStoreIds = stores.map((store) => store.id);
    const [profiles, paidOrderSummaries, partners, banReasons]: [
      Array<PulseAdminMembershipProfileRecord & { storeId: number }>,
      Array<{
        storeId: number;
        _count: { _all: number };
        _sum: { amount: number | null };
        _max: { createdAt: Date | null };
      }>,
      Array<PulseAdminPartnerRecord & { storeId: number }>,
      Map<number, string>,
    ] = await Promise.all([
      this.findMembershipProfilesByStoreIds(resolvedStoreIds),
      this.prisma.storeMembershipOrder.groupBy({
        by: ['storeId'],
        where: {
          storeId: { in: resolvedStoreIds },
          status: 'paid',
        },
        _count: { _all: true },
        _sum: { amount: true },
        _max: { createdAt: true },
      }),
      this.prisma.storePartner.findMany({
        where: {
          storeId: { in: resolvedStoreIds },
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
      this.accessService.listAdminMemberBanReasons(resolvedStoreIds),
    ]);

    const profileByStoreId = new Map(
      profiles.map((profile) => [profile.storeId, profile]),
    );
    const orderSummaryByStoreId = new Map(
      paidOrderSummaries.map((summary) => [
        summary.storeId,
        {
          rechargeCount: summary._count._all,
          totalRecharged: summary._sum.amount ?? 0,
          lastPaidAt: summary._max.createdAt?.getTime() ?? null,
        },
      ]),
    );
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

    return stores
      .map((store) =>
        buildPulseAdminMemberListItem({
          store,
          profile: profileByStoreId.get(store.id) ?? null,
          orderSummary: orderSummaryByStoreId.get(store.id),
          partner: partnerByStoreId.get(store.id) ?? null,
          banReason: banReasons.get(store.id) ?? null,
        }),
      )
      .filter((member) => matchesAdminMemberFilters(member, query));
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

      console.warn(
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

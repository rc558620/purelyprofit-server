import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PlatformMembershipAccessService } from '../../purely-profit/member/platform-membership/platform-membership-access.service';
import { PlatformMembershipService } from '../../purely-profit/member/platform-membership/platform-membership.service';
import { StoreSubAccountService } from '../../purely-profit/member/platform-membership/store-sub-account.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../redis/cache-invalidator.service';
import type {
  GetPulseAdminMemberLogsQueryDto,
  GetPulseAdminMembersQueryDto,
  PulseAdminMemberBeanLogsResponseDto,
  PulseAdminMemberPointsLogsResponseDto,
  PulseAdminMembersResponseDto,
  PulseMemberDetailDto,
  PulseMemberListItemDto,
} from './dto/pulse-membership.dto';
import { PULSE_ADMIN_MEMBER_LOG_DEFAULT_LIMIT } from './dto/pulse-membership.dto';
import { PulseMembershipAccessService } from './membership-access.service';
import { DAY_MS, PURCHASE_BONUS_POINTS } from './membership.constants';
import type {
  PulseAdminMemberLevel,
  PulseAdminMembershipMutationInput,
  PulseAdminMembershipOrderRecord,
  PulseAdminMembershipProfileRecord,
  PulseAdminPartnerRecord,
  PulseAdminStatusMutationInput,
  PulseAdminSubAccountQuotaMutationInput,
  PulseAdminSubAccountSlotMutationInput,
  PulseAdminStoreIdentityRecord,
  PulseAdminStoreRecord,
  PulseMembershipAdjustmentInput,
} from './membership.types';

type LegacyPulseAdminMembershipProfileRecord = Omit<
  PulseAdminMembershipProfileRecord,
  'subAccountQuota'
>;

type PulseAdminMembershipProfileListRecord =
  PulseAdminMembershipProfileRecord & { storeId: number };

@Injectable()
export class PulseMembershipAdminService {
  constructor(
    private readonly platformMembershipService: PlatformMembershipService,
    private readonly prisma: PrismaService,
    private readonly cacheInvalidatorService: CacheInvalidatorService,
    private readonly accessService: PulseMembershipAccessService,
    private readonly storeSubAccountService: StoreSubAccountService,
    private readonly platformMembershipAccessService: PlatformMembershipAccessService,
  ) {}

  async listAdminPointsLogs(
    user: AuthenticatedUser,
    query: GetPulseAdminMemberLogsQueryDto,
  ): Promise<PulseAdminMemberPointsLogsResponseDto> {
    const storeIds = await this.accessService.resolveAdminMemberStoreIds(user);
    const cursorPagination = this.resolveAdminMemberLogsCursorPagination(query);
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
      items: visibleLogs.map((log) => {
        const userName = this.resolveAdminMemberDisplayName(log.store);
        const userPhone = this.maskAdminMemberPhone(
          this.resolveAdminMemberPhone(log.store),
        );
        const source = log.source as
          | 'purchase_bonus'
          | 'deduct_payment'
          | 'admin_adjust'
          | 'expire';

        return {
          id: String(log.id),
          userId: String(log.storeId),
          userName,
          userPhone,
          amount: log.changeAmount,
          type:
            source === 'expire'
              ? 'expire'
              : log.changeAmount > 0
                ? 'earn'
                : 'spend',
          source,
          description: log.description,
          createdAt: log.createdAt.getTime(),
          expireAt: log.expireAt ? log.expireAt.getTime() : null,
        };
      }),
      hasMore,
      nextCursor: hasMore
        ? this.encodeAdminMemberLogsCursor(visibleLogs.at(-1) ?? null)
        : null,
    };
  }

  async listAdminBeanLogs(
    user: AuthenticatedUser,
    query: GetPulseAdminMemberLogsQueryDto,
  ): Promise<PulseAdminMemberBeanLogsResponseDto> {
    const storeIds = await this.accessService.resolveAdminMemberStoreIds(user);
    const cursorPagination = this.resolveAdminMemberLogsCursorPagination(query);
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
      items: visibleLogs.map((log) => {
        const userName = this.resolveAdminMemberDisplayName(log.store);
        const userPhone = this.maskAdminMemberPhone(
          this.resolveAdminMemberPhone(log.store),
        );
        const source = log.source as
          | 'promo_reward'
          | 'deduct_payment'
          | 'withdrawal'
          | 'admin_adjust';

        return {
          id: String(log.id),
          userId: String(log.storeId),
          userName,
          userPhone,
          amount: log.changeAmount,
          type:
            source === 'withdrawal'
              ? 'withdraw'
              : log.changeAmount > 0
                ? 'earn'
                : 'spend',
          source,
          description: log.description,
          relatedPromoId: log.relatedPromoRecordId
            ? String(log.relatedPromoRecordId)
            : undefined,
          relatedUser: log.relatedUser ?? undefined,
          createdAt: log.createdAt.getTime(),
        };
      }),
      hasMore,
      nextCursor: hasMore
        ? this.encodeAdminMemberLogsCursor(visibleLogs.at(-1) ?? null)
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

  async adjustAdminMemberPoints(
    user: AuthenticatedUser,
    memberId: number,
    dto: PulseMembershipAdjustmentInput,
  ): Promise<PulseMemberDetailDto> {
    await this.assertAdminMemberMutationAccess(user, memberId);

    const delta = this.resolveAdjustmentDelta(dto, '积分');
    const current = await this.loadAdminMemberStateOrThrow(memberId);
    const nextAvailablePoints = current.profile.availablePoints + delta;
    const nextTotalPoints =
      current.profile.totalPoints + (delta > 0 ? delta : 0);

    if (nextAvailablePoints < 0) {
      throw new BadRequestException('当前积分不足，无法扣减');
    }

    await this.prisma.$transaction(async (tx) => {
      const profile = await tx.storeMembershipProfile.upsert({
        where: { storeId: memberId },
        create: {
          storeId: memberId,
          totalPoints: nextTotalPoints,
          availablePoints: nextAvailablePoints,
        },
        update: {
          totalPoints: nextTotalPoints,
          availablePoints: nextAvailablePoints,
        },
        select: { id: true },
      });

      await tx.storeMembershipPointsLog.create({
        data: {
          storeId: memberId,
          profileId: profile.id,
          source: 'admin_adjust',
          changeAmount: delta,
          description: dto.reason.trim(),
        },
      });
    });

    await this.cacheInvalidatorService.invalidatePulseDashboardHome();

    return this.buildAdminMemberDetail(memberId);
  }

  async adjustAdminMemberBeans(
    user: AuthenticatedUser,
    memberId: number,
    dto: PulseMembershipAdjustmentInput,
  ): Promise<PulseMemberDetailDto> {
    await this.assertAdminMemberMutationAccess(user, memberId);

    const delta = this.resolveAdjustmentDelta(dto, '纯利豆');
    const current = await this.loadAdminMemberStateOrThrow(memberId);
    const nextBeanBalance = current.partner.beanBalance + delta;

    if (nextBeanBalance < 0) {
      throw new BadRequestException('当前纯利豆不足，无法扣减');
    }

    await this.prisma.$transaction(async (tx) => {
      const totalEarnedBeans = Math.max(
        current.partner.totalEarnedBeans + (delta > 0 ? delta : 0),
        0,
      );
      const now = new Date();
      const existingPartner = await tx.storePartner.findFirst({
        where: { storeId: memberId, status: 'approved' },
        select: { id: true, status: true },
        orderBy: [{ reviewedAt: 'desc' }, { joinedAt: 'desc' }, { id: 'desc' }],
      });
      const partner = existingPartner
        ? await tx.storePartner.update({
            where: { id: existingPartner.id },
            data: {
              status: 'approved',
              reviewedAt:
                existingPartner.status === 'approved' ? undefined : now,
              joinedAt: existingPartner.status === 'approved' ? undefined : now,
              beanBalance: nextBeanBalance,
              totalEarnedBeans,
            },
            select: { id: true },
          })
        : await tx.storePartner.create({
            data: {
              storeId: memberId,
              status: 'approved',
              reviewedAt: now,
              joinedAt: now,
              beanBalance: nextBeanBalance,
              totalEarnedBeans,
              totalWithdrawnBeans: current.partner.totalWithdrawnBeans,
            },
            select: { id: true },
          });

      await tx.storePartnerBeanLog.create({
        data: {
          storeId: memberId,
          partnerId: partner.id,
          source: 'admin_adjust',
          changeAmount: delta,
          description: dto.reason.trim(),
        },
      });
    });

    await this.cacheInvalidatorService.invalidatePulseDashboardHome();

    return this.buildAdminMemberDetail(memberId);
  }

  async setAdminMemberMembership(
    user: AuthenticatedUser,
    memberId: number,
    dto: PulseAdminMembershipMutationInput,
  ): Promise<PulseMemberDetailDto> {
    await this.assertAdminMemberMutationAccess(user, memberId);

    const nextLevel = this.resolveAdminMemberLevel(dto);
    const nextExpiry = await this.resolveAdminMembershipExpiry(dto, nextLevel);
    const nextPlanId = this.toMembershipPlanId(nextLevel);
    const now = new Date();

    await this.prisma.storeMembershipProfile.upsert({
      where: { storeId: memberId },
      create: {
        storeId: memberId,
        currentPlanId: nextPlanId,
        startsAt: nextPlanId ? now : null,
        expiresAt: nextExpiry,
        totalPoints: 0,
        availablePoints: 0,
      },
      update: {
        currentPlanId: nextPlanId,
        startsAt: nextPlanId ? now : null,
        expiresAt: nextExpiry,
      },
    });

    await this.cacheInvalidatorService.invalidatePulseDashboardHome();

    return this.buildAdminMemberDetail(memberId);
  }

  async banAdminMember(
    user: AuthenticatedUser,
    memberId: number,
    dto: PulseAdminStatusMutationInput,
  ): Promise<PulseMemberDetailDto> {
    await this.assertAdminMemberMutationAccess(user, memberId);

    const reason = this.resolveBanReason(dto);
    await this.prisma.store.update({
      where: { id: memberId },
      data: {
        updatedAt: new Date(),
      },
    });

    await this.accessService.writeAdminMemberBanReason(memberId, reason);
    await this.accessService.kickAllStoreUsers(memberId);

    return this.buildAdminMemberDetail(memberId);
  }

  async unbanAdminMember(
    user: AuthenticatedUser,
    memberId: number,
  ): Promise<PulseMemberDetailDto> {
    await this.assertAdminMemberMutationAccess(user, memberId);

    await this.prisma.store.update({
      where: { id: memberId },
      data: {
        updatedAt: new Date(),
      },
    });

    await this.accessService.clearAdminMemberBanReason(memberId);

    return this.buildAdminMemberDetail(memberId);
  }

  async updateAdminMemberSubAccountQuota(
    user: AuthenticatedUser,
    memberId: number,
    dto: PulseAdminSubAccountQuotaMutationInput,
  ): Promise<PulseMemberDetailDto> {
    await this.assertAdminMemberMutationAccess(user, memberId);

    await this.storeSubAccountService.updateQuota(
      memberId,
      dto.quota,
      user.id,
      dto.reason,
    );
    await this.invalidateAdminMemberDerived(memberId);

    return this.buildAdminMemberDetail(memberId);
  }

  async updateAdminMemberSubAccountSlot(
    user: AuthenticatedUser,
    memberId: number,
    dto: PulseAdminSubAccountSlotMutationInput,
  ): Promise<PulseMemberDetailDto> {
    await this.assertAdminMemberMutationAccess(user, memberId);

    await this.storeSubAccountService.updateSlot(memberId, dto);
    await this.invalidateAdminMemberDerived(memberId);

    return this.buildAdminMemberDetail(memberId);
  }

  private async assertAdminMemberMutationAccess(
    user: AuthenticatedUser,
    memberId: number,
  ): Promise<void> {
    await this.accessService.assertAdminMemberMutationAccess(user, memberId);
  }

  private async invalidateAdminMemberDerived(memberId: number): Promise<void> {
    await Promise.all([
      this.cacheInvalidatorService.invalidatePulseDashboardHome(),
      this.cacheInvalidatorService.invalidatePulseDashboardOverview(memberId),
      this.cacheInvalidatorService.invalidatePulseSessionNotification(memberId),
      this.cacheInvalidatorService.invalidatePulseSessionBootstrap(memberId),
      this.accessService.kickAllStoreUsers(memberId),
    ]);
  }

  private async buildAdminMemberDetail(
    storeId: number,
  ): Promise<PulseMemberDetailDto> {
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
      {
        eligible: boolean;
        quota: number;
        quotaMax: number;
        enabled: boolean;
        usedCount: number;
        availableCount: number;
        roleSummary: Array<{
          role: string;
          activeCount: number;
          inactiveCount: number;
          disabledCount: number;
          assignedCount: number;
        }>;
        slots: Array<{
          id: number;
          slotIndex: number;
          role: string;
          status: string;
          isAssigned: boolean;
          employeeId: number | null;
          employeeName: string | null;
          canAccessHome: boolean;
          canUseHandover: boolean;
        }>;
      },
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

    const ownerName = this.resolveAdminMemberDisplayName(store);
    const phone = this.resolveAdminMemberPhone(store);
    const currentPlanId = profile?.currentPlanId ?? null;
    const level = this.toPulseMemberLevel(
      currentPlanId,
      profile?.expiresAt ?? null,
    );
    const membershipExpiry = profile?.expiresAt?.getTime() ?? null;
    const isBanned = Boolean(banReason);
    const isActive = membershipExpiry !== null && membershipExpiry > Date.now();
    const registeredAt = store.createdAt.getTime();
    const lastActiveAt =
      paidOrders[0]?.createdAt.getTime() ??
      profile?.expiresAt?.getTime() ??
      store.updatedAt.getTime();
    const totalRecharged = paidOrders.reduce(
      (sum, order) => sum + order.amount,
      0,
    );

    return {
      id: String(store.id),
      name: ownerName,
      phone,
      avatarChar: ownerName.slice(0, 1) || '会',
      avatarColorIdx: store.id % 6,
      status: isBanned ? 'banned' : isActive ? 'active' : 'inactive',
      level,
      registeredAt,
      lastActiveAt,
      availablePoints: profile?.availablePoints ?? 0,
      totalPointsEarned: profile?.totalPoints ?? 0,
      beanBalance: partner?.beanBalance ?? 0,
      isPartner: partner?.status === 'approved',
      totalRecharged,
      rechargeCount: paidOrders.length,
      invitedCount: promoCount,
      rechargeHistory: paidOrders.map((order) => ({
        id: String(order.id),
        planName: order.planName,
        amount: order.amount,
        pointsAwarded: PURCHASE_BONUS_POINTS[order.planId] ?? 0,
        channel: 'wechat',
        createdAt: order.createdAt.getTime(),
      })),
      remark: banReason ?? `${store.name} 的平台会员档案`,
      membershipExpiry,
      subAccountEligible: subAccountSummary.eligible,
      subAccountQuota: subAccountSummary.quota,
      subAccountCapabilityEnabled: subAccountSummary.enabled,
      subAccountQuotaMax: subAccountSummary.quotaMax,
      subAccountsUsedCount: subAccountSummary.usedCount,
      subAccountsAvailableCount: subAccountSummary.availableCount,
      subAccountRoleSummary: subAccountSummary.roleSummary.map((item) => ({
        role: item.role as 'cashier' | 'finance',
        activeCount: item.activeCount,
        inactiveCount: item.inactiveCount,
        disabledCount: item.disabledCount,
        assignedCount: item.assignedCount,
      })),
      subAccountSlots: subAccountSummary.slots.map((slot) => ({
        id: String(slot.id),
        slotIndex: slot.slotIndex,
        role: slot.role as 'cashier' | 'finance',
        status: slot.status as 'active' | 'inactive' | 'disabled',
        isAssigned: slot.isAssigned,
        employeeId: slot.employeeId ? String(slot.employeeId) : null,
        employeeName: slot.employeeName,
        canAccessHome: slot.canAccessHome,
        canUseHandover: slot.canUseHandover,
      })),
    };
  }

  private async buildAdminSubAccountDetail(storeId: number): Promise<{
    eligible: boolean;
    quota: number;
    quotaMax: number;
    enabled: boolean;
    usedCount: number;
    availableCount: number;
    roleSummary: Array<{
      role: string;
      activeCount: number;
      inactiveCount: number;
      disabledCount: number;
      assignedCount: number;
    }>;
    slots: Array<{
      id: number;
      slotIndex: number;
      role: string;
      status: string;
      isAssigned: boolean;
      employeeId: number | null;
      employeeName: string | null;
      canAccessHome: boolean;
      canUseHandover: boolean;
    }>;
  }> {
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

  private async loadAdminMemberStateOrThrow(storeId: number): Promise<{
    profile: PulseAdminMembershipProfileRecord;
    partner: PulseAdminPartnerRecord;
  }> {
    const [store, profile, partner]: [
      { id: number } | null,
      PulseAdminMembershipProfileRecord | null,
      PulseAdminPartnerRecord | null,
    ] = await Promise.all([
      this.prisma.store.findUnique({
        where: { id: storeId },
        select: { id: true },
      }),
      this.findMembershipProfileByStoreId(storeId),
      this.prisma.storePartner.findFirst({
        where: { storeId, status: 'approved' },
        select: {
          id: true,
          status: true,
          beanBalance: true,
          totalEarnedBeans: true,
          totalWithdrawnBeans: true,
        },
        orderBy: [{ reviewedAt: 'desc' }, { joinedAt: 'desc' }, { id: 'desc' }],
      }),
    ]);

    if (!store) {
      throw new NotFoundException('会员不存在');
    }

    return {
      profile: profile ?? {
        currentPlanId: null,
        expiresAt: null,
        totalPoints: 0,
        availablePoints: 0,
        subAccountQuota: 0,
      },
      partner: partner ?? {
        id: 0,
        status: 'approved',
        beanBalance: 0,
        totalEarnedBeans: 0,
        totalWithdrawnBeans: 0,
      },
    };
  }

  private resolveAdjustmentDelta(
    input: PulseMembershipAdjustmentInput,
    assetLabel: string,
  ): number {
    if (typeof input.delta === 'number' && input.delta !== 0) {
      return input.delta;
    }

    if (typeof input.amount !== 'number' || input.amount === 0) {
      throw new BadRequestException(`缺少${assetLabel}调整值`);
    }

    switch (input.direction) {
      case 'add':
        return Math.abs(input.amount);
      case 'subtract':
      case 'deduct':
      case 'reduce':
        return -Math.abs(input.amount);
      default:
        return input.amount;
    }
  }

  private resolveAdminMemberLevel(
    dto: PulseAdminMembershipMutationInput,
  ): PulseAdminMemberLevel {
    const nextLevel = dto.level ?? dto.memberLevel ?? dto.membershipLevel;
    if (!nextLevel) {
      throw new BadRequestException('缺少会员等级');
    }

    return nextLevel;
  }

  private async resolveAdminMembershipExpiry(
    dto: PulseAdminMembershipMutationInput,
    nextLevel: PulseAdminMemberLevel,
  ): Promise<Date | null> {
    const rawExpiry = dto.membershipExpiry ?? dto.expireAt ?? dto.expiryAt;
    if (rawExpiry !== null && rawExpiry !== undefined) {
      const explicitExpiry = new Date(rawExpiry);
      if (Number.isNaN(explicitExpiry.getTime())) {
        throw new BadRequestException('会员到期时间不合法');
      }
      return explicitExpiry;
    }

    if (nextLevel === 'free') {
      return null;
    }

    if (nextLevel === 'lifetime') {
      const lifetimePlan =
        await this.platformMembershipService.getPlanConfig('lifetime');
      if (lifetimePlan.validDays !== null && lifetimePlan.validDays > 0) {
        return new Date(Date.now() + lifetimePlan.validDays * DAY_MS);
      }
      return null;
    }

    throw new BadRequestException('缺少会员到期时间');
  }

  private toMembershipPlanId(
    level: PulseAdminMemberLevel,
  ): PulseAdminMembershipProfileRecord['currentPlanId'] {
    switch (level) {
      case 'monthly':
        return 'monthly';
      case 'quarterly':
        return 'quarterly';
      case 'annual':
        return 'yearly';
      case 'lifetime':
        return 'lifetime';
      default:
        return null;
    }
  }

  private resolveBanReason(dto: PulseAdminStatusMutationInput): string {
    const reason = dto.reason?.trim() ?? dto.remark?.trim() ?? '';
    if (!reason) {
      throw new BadRequestException('缺少封禁原因');
    }

    return reason;
  }

  private resolveAdminMemberLogsCursorPagination(
    query: GetPulseAdminMemberLogsQueryDto,
  ): {
    cursor?: { createdAt: Date; id: number };
    limit?: number;
  } {
    if (query.cursor === undefined && query.limit === undefined) {
      return {};
    }

    if (query.cursor === undefined) {
      return {
        limit: query.limit ?? PULSE_ADMIN_MEMBER_LOG_DEFAULT_LIMIT,
      };
    }

    const cursor = this.parseAdminMemberLogsCursor(query.cursor);
    if (!cursor) {
      throw new ConflictException('cursor 格式不合法');
    }

    return {
      cursor,
      limit: query.limit ?? PULSE_ADMIN_MEMBER_LOG_DEFAULT_LIMIT,
    };
  }

  private parseAdminMemberLogsCursor(
    cursor: string,
  ): { createdAt: Date; id: number } | null {
    const match = /^(\d+)_(\d+)$/.exec(cursor);
    if (!match) {
      return null;
    }

    const [, rawCreatedAt, rawId] = match;
    const createdAtMs = Number(rawCreatedAt);
    const id = Number(rawId);
    if (
      !Number.isSafeInteger(createdAtMs) ||
      !Number.isSafeInteger(id) ||
      createdAtMs <= 0 ||
      id <= 0
    ) {
      return null;
    }

    return {
      createdAt: new Date(createdAtMs),
      id,
    };
  }

  private encodeAdminMemberLogsCursor(
    log: Pick<{ createdAt: Date; id: number }, 'createdAt' | 'id'> | null,
  ): string | null {
    if (!log) {
      return null;
    }

    return `${log.createdAt.getTime()}_${log.id}`;
  }

  private async buildAdminMemberListItems(
    storeIds: number[],
    query: GetPulseAdminMembersQueryDto,
  ): Promise<PulseMemberListItemDto[]> {
    if (storeIds.length === 0) {
      return [];
    }

    const stores = await this.prisma.store.findMany({
      where: this.buildAdminMemberListStoreWhere(storeIds, query),
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
      .map((store) => {
        const profile = profileByStoreId.get(store.id) ?? null;
        const orderSummary = orderSummaryByStoreId.get(store.id);
        const partner = partnerByStoreId.get(store.id) ?? null;
        const banReason = banReasons.get(store.id) ?? null;
        const ownerName = this.resolveAdminMemberDisplayName(store);
        const phone = this.resolveAdminMemberPhone(store);
        const membershipExpiry = profile?.expiresAt?.getTime() ?? null;
        const isBanned = Boolean(banReason);
        const isActive =
          membershipExpiry !== null && membershipExpiry > Date.now();

        return {
          id: String(store.id),
          name: ownerName,
          phone,
          avatarChar: ownerName.slice(0, 1) || '会',
          avatarColorIdx: store.id % 6,
          status: isBanned ? 'banned' : isActive ? 'active' : 'inactive',
          level: this.toPulseMemberLevel(
            profile?.currentPlanId ?? null,
            profile?.expiresAt ?? null,
          ),
          availablePoints: profile?.availablePoints ?? 0,
          beanBalance: partner?.beanBalance ?? 0,
          isPartner: partner?.status === 'approved',
          totalRecharged: orderSummary?.totalRecharged ?? 0,
          registeredAt: store.createdAt.getTime(),
          lastActiveAt:
            orderSummary?.lastPaidAt ??
            profile?.expiresAt?.getTime() ??
            store.updatedAt.getTime(),
          subAccountEligible:
            (profile?.currentPlanId ?? null) === 'yearly' ||
            (profile?.currentPlanId ?? null) === 'lifetime',
          subAccountQuota: profile?.subAccountQuota ?? 0,
          subAccountCapabilityEnabled: (profile?.subAccountQuota ?? 0) > 0,
        } satisfies PulseMemberListItemDto;
      })
      .filter((member) => this.matchesAdminMemberFilters(member, query));
  }

  private async findMembershipProfileByStoreId(
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
      if (!this.isMissingSubAccountQuotaSchemaError(error)) {
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
      if (!this.isMissingSubAccountQuotaSchemaError(error)) {
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
        (
          profile,
        ): PulseAdminMembershipProfileListRecord => ({
          ...(profile as LegacyPulseAdminMembershipProfileRecord & {
            storeId: number;
          }),
          subAccountQuota: 0,
        }),
      );
    }
  }

  private isMissingSubAccountQuotaSchemaError(error: unknown): boolean {
    const message =
      error instanceof Error
        ? error.message.toLowerCase()
        : String(error).toLowerCase();

    if (
      !message.includes('sub_account_quota') &&
      !message.includes('subaccountquota')
    ) {
      return false;
    }

    return (
      message.includes('does not exist') ||
      message.includes("doesn't exist") ||
      message.includes('unknown column') ||
      message.includes('no such column') ||
      message.includes('unknown field') ||
      message.includes('column')
    );
  }

  private buildAdminMemberListStoreWhere(
    storeIds: number[],
    query: GetPulseAdminMembersQueryDto,
  ): Prisma.StoreWhereInput {
    const filters: Prisma.StoreWhereInput[] = [{ id: { in: storeIds } }];

    if (query.partner === true) {
      filters.push({
        partners: {
          some: {
            status: 'approved',
          },
        },
      });
    }

    const levelWhere = this.buildAdminMemberLevelStoreWhere(query);
    if (levelWhere) {
      filters.push(levelWhere);
    }

    const statusWhere = this.buildAdminMemberStatusStoreWhere(query);
    if (statusWhere) {
      filters.push(statusWhere);
    }

    const keywordWhere = this.buildAdminMemberKeywordStoreWhere(query);
    if (keywordWhere) {
      filters.push(keywordWhere);
    }

    return filters.length === 1 ? filters[0] : { AND: filters };
  }

  private buildAdminMemberLevelStoreWhere(
    query: GetPulseAdminMembersQueryDto,
  ): Prisma.StoreWhereInput | null {
    switch (query.level) {
      case 'free':
        return {
          OR: [
            { membershipProfile: { is: null } },
            { membershipProfile: { is: { currentPlanId: null } } },
          ],
        };
      case 'monthly':
        return {
          membershipProfile: { is: { currentPlanId: 'monthly' } },
        };
      case 'quarterly':
        return {
          membershipProfile: { is: { currentPlanId: 'quarterly' } },
        };
      case 'annual':
        return {
          membershipProfile: {
            is: {
              currentPlanId: 'yearly',
              expiresAt: { not: null },
            },
          },
        };
      case 'lifetime':
        return {
          OR: [
            { membershipProfile: { is: { currentPlanId: 'lifetime' } } },
            {
              membershipProfile: {
                is: {
                  currentPlanId: 'yearly',
                  expiresAt: null,
                },
              },
            },
          ],
        };
      default:
        return null;
    }
  }

  private buildAdminMemberStatusStoreWhere(
    query: GetPulseAdminMembersQueryDto,
  ): Prisma.StoreWhereInput | null {
    const now = new Date();

    switch (query.status) {
      case 'active':
        return {
          membershipProfile: {
            is: {
              expiresAt: { gt: now },
            },
          },
        };
      case 'inactive':
        return {
          OR: [
            { membershipProfile: { is: null } },
            { membershipProfile: { is: { expiresAt: null } } },
            {
              membershipProfile: {
                is: {
                  expiresAt: { lte: now },
                },
              },
            },
          ],
        };
      default:
        return null;
    }
  }

  private buildAdminMemberKeywordStoreWhere(
    query: GetPulseAdminMembersQueryDto,
  ): Prisma.StoreWhereInput | null {
    const keyword = query.keyword?.trim();
    if (!keyword) {
      return null;
    }

    const normalizedPhoneKeyword = keyword.replace(/\s+/g, '');

    return {
      OR: [
        { name: { contains: keyword, mode: 'insensitive' } },
        { contactPhone: { contains: normalizedPhoneKeyword } },
        { owner: { name: { contains: keyword, mode: 'insensitive' } } },
        { owner: { realName: { contains: keyword, mode: 'insensitive' } } },
        {
          owner: {
            email: { contains: normalizedPhoneKeyword, mode: 'insensitive' },
          },
        },
      ],
    };
  }

  private matchesAdminMemberFilters(
    member: Pick<
      PulseMemberListItemDto,
      'name' | 'phone' | 'status' | 'level' | 'isPartner'
    >,
    query: GetPulseAdminMembersQueryDto,
  ): boolean {
    if (
      query.status &&
      query.status !== 'all' &&
      member.status !== query.status
    ) {
      return false;
    }

    if (query.level && query.level !== 'all' && member.level !== query.level) {
      return false;
    }

    if (query.partner === true && !member.isPartner) {
      return false;
    }

    const keyword = query.keyword?.trim().toLowerCase();
    if (!keyword) {
      return true;
    }

    return (
      member.name.toLowerCase().includes(keyword) ||
      member.phone.toLowerCase().includes(keyword)
    );
  }

  private resolveAdminMemberDisplayName(
    store: Pick<PulseAdminStoreIdentityRecord, 'name' | 'owner'>,
  ): string {
    return store.owner.realName ?? store.owner.name ?? store.name;
  }

  private resolveAdminMemberPhone(
    store: Pick<PulseAdminStoreIdentityRecord, 'contactPhone' | 'owner'>,
  ): string {
    const contactPhone = store.contactPhone?.trim();
    if (contactPhone) {
      return contactPhone;
    }

    const ownerEmail = store.owner.email.trim().toLowerCase();
    const matchedPhone = /^phone_(\d{11})@purelyprofit\.local$/.exec(
      ownerEmail,
    );
    return matchedPhone?.[1] ?? '';
  }

  private maskAdminMemberPhone(phone: string): string {
    const normalizedPhone = phone.replace(/\s+/g, '');
    if (!/^1\d{10}$/.test(normalizedPhone)) {
      return normalizedPhone || '--';
    }

    return `${normalizedPhone.slice(0, 3)}****${normalizedPhone.slice(-4)}`;
  }

  private toPulseMemberLevel(
    planId: PulseAdminMembershipProfileRecord['currentPlanId'],
    expiresAt: Date | null,
  ): PulseAdminMemberLevel {
    if (planId === 'yearly' && expiresAt === null) {
      return 'lifetime';
    }

    switch (planId) {
      case 'monthly':
        return 'monthly';
      case 'quarterly':
        return 'quarterly';
      case 'yearly':
        return 'annual';
      case 'lifetime':
        return 'lifetime';
      default:
        return 'free';
    }
  }
}

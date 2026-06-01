import { StoreSubAccountRole } from '@prisma/client';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PlatformMembershipService } from '../../purely-profit/member/platform-membership/platform-membership.service';
import {
  StoreSubAccountService,
  type UpdateStoreSubAccountSlotInput,
} from '../../purely-profit/member/platform-membership/store-sub-account.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../redis/cache-invalidator.service';
import type { PulseMemberDetailDto } from './dto/pulse-membership-admin-members.response.dto';
import { PulseMembershipAccessService } from './membership-access.service';
import { PulseMembershipAdminQueryService } from './membership-admin-query.service';
import { DAY_MS } from './membership.constants';
import type {
  PulseAdminMemberLevel,
  PulseAdminMembershipMutationInput,
  PulseAdminMembershipProfileRecord,
  PulseAdminPartnerRecord,
  PulseAdminStatusMutationInput,
  PulseAdminSubAccountQuotaMutationInput,
  PulseAdminSubAccountSlotMutationInput,
  PulseMembershipAdjustmentInput,
} from './membership.types';

@Injectable()
export class PulseMembershipAdminMutationService {
  constructor(
    private readonly platformMembershipService: PlatformMembershipService,
    private readonly prisma: PrismaService,
    private readonly cacheInvalidatorService: CacheInvalidatorService,
    private readonly accessService: PulseMembershipAccessService,
    private readonly storeSubAccountService: StoreSubAccountService,
    private readonly queryService: PulseMembershipAdminQueryService,
  ) {}

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

    return this.queryService.buildAdminMemberDetail(memberId);
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

    return this.queryService.buildAdminMemberDetail(memberId);
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

    return this.queryService.buildAdminMemberDetail(memberId);
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

    return this.queryService.buildAdminMemberDetail(memberId);
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

    return this.queryService.buildAdminMemberDetail(memberId);
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

    if (dto.roleSummary?.length) {
      await this.syncAdminMemberSubAccountRoleSummary(memberId, dto.quota, dto);
    }

    await this.invalidateAdminMemberDerived(memberId);

    return this.queryService.buildAdminMemberDetail(memberId);
  }

  async updateAdminMemberSubAccountSlot(
    user: AuthenticatedUser,
    memberId: number,
    dto: PulseAdminSubAccountSlotMutationInput,
  ): Promise<PulseMemberDetailDto> {
    await this.assertAdminMemberMutationAccess(user, memberId);

    await this.storeSubAccountService.updateSlot(
      memberId,
      dto as UpdateStoreSubAccountSlotInput,
    );
    await this.invalidateAdminMemberDerived(memberId);

    return this.queryService.buildAdminMemberDetail(memberId);
  }

  private async syncAdminMemberSubAccountRoleSummary(
    memberId: number,
    quota: number,
    dto: PulseAdminSubAccountQuotaMutationInput,
  ): Promise<void> {
    const roleSummary =
      dto.roleSummary?.filter((item) => item.slot <= quota) ?? [];
    if (roleSummary.length === 0) {
      return;
    }

    const currentSummary =
      await this.storeSubAccountService.getStoreSubAccountSummary(memberId);
    const slotSnapshotMap = new Map(
      currentSummary.slots.map((slot) => [slot.slotIndex, slot] as const),
    );

    for (const item of roleSummary.sort(
      (left, right) => left.slot - right.slot,
    )) {
      const currentSlot = slotSnapshotMap.get(item.slot);
      const shouldKeepAssignedEmployee =
        item.isAssigned ?? currentSlot?.isAssigned ?? false;
      await this.storeSubAccountService.updateSlot(memberId, {
        slotIndex: item.slot,
        role: item.role as StoreSubAccountRole,
        status: item.status ?? currentSlot?.status,
        employeeId: shouldKeepAssignedEmployee
          ? (currentSlot?.employeeId ?? null)
          : null,
        canAccessHome: currentSlot?.canAccessHome,
        canUseHandover: currentSlot?.canUseHandover,
      });
    }
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

  private async loadAdminMemberStateOrThrow(storeId: number): Promise<{
    profile: PulseAdminMembershipProfileRecord;
    partner: PulseAdminPartnerRecord;
  }> {
    const [store, profile, partner]: [
      { id: number } | null,
      Awaited<
        ReturnType<
          PulseMembershipAdminQueryService['findMembershipProfileByStoreId']
        >
      >,
      PulseAdminPartnerRecord | null,
    ] = await Promise.all([
      this.prisma.store.findUnique({
        where: { id: storeId },
        select: { id: true },
      }),
      this.queryService.findMembershipProfileByStoreId(storeId),
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
}

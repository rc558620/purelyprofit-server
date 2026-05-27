import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PlatformMembershipService } from '../../purely-profit/member/platform-membership/platform-membership.service';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  GetPulseAdminMembersQueryDto,
  PulseAdminMemberBeanLogsResponseDto,
  PulseAdminMemberPointsLogsResponseDto,
  PulseAdminMembersResponseDto,
  PulseMemberDetailDto,
  PulseMemberListItemDto,
} from './dto/pulse-membership.dto';
import { PulseMembershipAccessService } from './membership-access.service';
import { DAY_MS, PURCHASE_BONUS_POINTS } from './membership.constants';
import type {
  PulseAdminMemberLevel,
  PulseAdminMembershipMutationInput,
  PulseAdminMembershipOrderRecord,
  PulseAdminMembershipProfileRecord,
  PulseAdminPartnerRecord,
  PulseAdminStatusMutationInput,
  PulseAdminStoreIdentityRecord,
  PulseAdminStoreRecord,
  PulseMembershipAdjustmentInput,
} from './membership.types';

@Injectable()
export class PulseMembershipAdminService {
  constructor(
    private readonly platformMembershipService: PlatformMembershipService,
    private readonly prisma: PrismaService,
    private readonly accessService: PulseMembershipAccessService,
  ) {}

  async listAdminPointsLogs(
    user: AuthenticatedUser,
  ): Promise<PulseAdminMemberPointsLogsResponseDto> {
    const storeIds = await this.accessService.resolveAdminMemberStoreIds(user);
    const logs = await this.prisma.storeMembershipPointsLog.findMany({
      where: {
        storeId: { in: storeIds },
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
    });

    return {
      items: logs.map((log) => {
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
    };
  }

  async listAdminBeanLogs(
    user: AuthenticatedUser,
  ): Promise<PulseAdminMemberBeanLogsResponseDto> {
    const storeIds = await this.accessService.resolveAdminMemberStoreIds(user);
    const logs = await this.prisma.storePartnerBeanLog.findMany({
      where: {
        storeId: { in: storeIds },
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
    });

    return {
      items: logs.map((log) => {
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
    };
  }

  async listAdminMembers(
    user: AuthenticatedUser,
    query: GetPulseAdminMembersQueryDto,
  ): Promise<PulseAdminMembersResponseDto> {
    const storeIds = await this.accessService.resolveAdminMemberStoreIds(user);
    const members = (
      await Promise.all(
        storeIds.map((storeId) => this.buildAdminMemberDetail(storeId)),
      )
    ).filter((member) => this.matchesAdminMemberFilters(member, query));

    return {
      items: members.map((member) => this.toAdminMemberListItem(member)),
      total: members.length,
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
      const partner = await tx.storePartner.upsert({
        where: { storeId: memberId },
        create: {
          storeId: memberId,
          status: 'approved',
          reviewedAt: now,
          joinedAt: now,
          beanBalance: nextBeanBalance,
          totalEarnedBeans,
          totalWithdrawnBeans: current.partner.totalWithdrawnBeans,
        },
        update: {
          status: 'approved',
          reviewedAt: current.partner.status === 'approved' ? undefined : now,
          joinedAt: current.partner.status === 'approved' ? undefined : now,
          beanBalance: nextBeanBalance,
          totalEarnedBeans,
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

  private async assertAdminMemberMutationAccess(
    user: AuthenticatedUser,
    memberId: number,
  ): Promise<void> {
    await this.accessService.assertAdminMemberMutationAccess(user, memberId);
  }

  private async buildAdminMemberDetail(
    storeId: number,
  ): Promise<PulseMemberDetailDto> {
    const banReason = await this.accessService.getAdminMemberBanReason(storeId);
    const [store, profile, paidOrders, partner, promoCount]: [
      PulseAdminStoreRecord | null,
      PulseAdminMembershipProfileRecord | null,
      PulseAdminMembershipOrderRecord[],
      PulseAdminPartnerRecord | null,
      number,
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
      this.prisma.storeMembershipProfile.findUnique({
        where: { storeId },
        select: {
          currentPlanId: true,
          expiresAt: true,
          totalPoints: true,
          availablePoints: true,
        },
      }),
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
        where: { storeId },
        select: {
          id: true,
          beanBalance: true,
          status: true,
          totalEarnedBeans: true,
          totalWithdrawnBeans: true,
        },
      }),
      this.prisma.storeMembershipPromoRecord.count({
        where: { storeId },
      }),
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
      this.prisma.storeMembershipProfile.findUnique({
        where: { storeId },
        select: {
          currentPlanId: true,
          expiresAt: true,
          totalPoints: true,
          availablePoints: true,
        },
      }),
      this.prisma.storePartner.findUnique({
        where: { storeId },
        select: {
          id: true,
          status: true,
          beanBalance: true,
          totalEarnedBeans: true,
          totalWithdrawnBeans: true,
        },
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

  private toAdminMemberListItem(
    detail: PulseMemberDetailDto,
  ): PulseMemberListItemDto {
    return {
      id: detail.id,
      name: detail.name,
      phone: detail.phone,
      avatarChar: detail.avatarChar,
      avatarColorIdx: detail.avatarColorIdx,
      status: detail.status,
      level: detail.level,
      availablePoints: detail.availablePoints,
      beanBalance: detail.beanBalance,
      isPartner: detail.isPartner,
      totalRecharged: detail.totalRecharged,
      registeredAt: detail.registeredAt,
      lastActiveAt: detail.lastActiveAt,
    };
  }

  private matchesAdminMemberFilters(
    member: PulseMemberDetailDto,
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

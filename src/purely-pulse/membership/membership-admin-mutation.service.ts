import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import type { PulseMemberDetailDto } from './dto/pulse-membership-admin-members.response.dto';
import { PulseMembershipAccessService } from './membership-access.service';
import { PulseMembershipAdminBeansMutationService } from './membership-admin-beans-mutation.service';
import { PulseMembershipAdminMemberReadService } from './membership-admin-member-read.service';
import { PulseMembershipAdminMembershipMutationService } from './membership-admin-membership-mutation.service';
import { PulseMembershipAdminMutationStateService } from './membership-admin-mutation-state.service';
import { PulseMembershipAdminPointsMutationService } from './membership-admin-points-mutation.service';
import { PulseMembershipAdminSubAccountMutationService } from './membership-admin-sub-account-mutation.service';
import type {
  PulseAdminMemberLevel,
  PulseAdminMembershipMutationInput,
  PulseAdminMembershipProfileRecord,
  PulseAdminStatusMutationInput,
  PulseAdminSubAccountQuotaMutationInput,
  PulseAdminSubAccountSlotMutationInput,
  PulseMembershipAdjustmentInput,
} from './membership.types';

@Injectable()
export class PulseMembershipAdminMutationService {
  private readonly logger = new Logger(
    PulseMembershipAdminMutationService.name,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly accessService: PulseMembershipAccessService,
    private readonly memberReadService: PulseMembershipAdminMemberReadService,
    private readonly mutationStateService: PulseMembershipAdminMutationStateService,
    private readonly membershipMutationService: PulseMembershipAdminMembershipMutationService,
    private readonly pointsMutationService: PulseMembershipAdminPointsMutationService,
    private readonly beansMutationService: PulseMembershipAdminBeansMutationService,
    private readonly subAccountMutationService: PulseMembershipAdminSubAccountMutationService,
  ) {}

  async adjustAdminMemberPoints(
    user: AuthenticatedUser,
    memberId: number,
    dto: PulseMembershipAdjustmentInput,
  ): Promise<PulseMemberDetailDto> {
    await this.assertAdminMemberMutationAccess(user, memberId);
    await this.pointsMutationService.adjustAdminMemberPoints(memberId, dto);

    return this.memberReadService.buildAdminMemberDetail(memberId);
  }

  async adjustAdminMemberBeans(
    user: AuthenticatedUser,
    memberId: number,
    dto: PulseMembershipAdjustmentInput,
  ): Promise<PulseMemberDetailDto> {
    await this.assertAdminMemberMutationAccess(user, memberId);
    await this.beansMutationService.adjustAdminMemberBeans(memberId, dto);

    return this.memberReadService.buildAdminMemberDetail(memberId);
  }

  async setAdminMemberMembership(
    user: AuthenticatedUser,
    memberId: number,
    dto: PulseAdminMembershipMutationInput,
  ): Promise<PulseMemberDetailDto> {
    await this.assertAdminMemberMutationAccess(user, memberId);

    const nextLevel =
      this.membershipMutationService.resolveAdminMemberLevel(dto);
    const current =
      await this.mutationStateService.loadAdminMemberStateOrThrow(memberId);
    this.membershipMutationService.assertFreeDowngradeConfirmed(
      current.profile,
      dto,
      nextLevel,
    );
    const nextExpiry =
      await this.membershipMutationService.resolveAdminMembershipExpiry(
        dto,
        nextLevel,
      );
    const nextPlanId =
      this.membershipMutationService.toMembershipPlanId(nextLevel);
    const now = new Date();

    this.logMembershipLevelMutation({
      user,
      memberId,
      previousPlanId: current.profile.currentPlanId,
      previousExpiresAt: current.profile.expiresAt,
      nextLevel,
      nextPlanId,
      nextExpiry,
      dto,
    });

    await this.prisma.storeMembershipProfile.upsert({
      where: { storeId: memberId },
      create: {
        storeId: memberId,
        currentPlanId: nextPlanId,
        startsAt: nextPlanId ? now : null,
        expiresAt: nextExpiry,
        totalPoints: current.profile.totalPoints,
        availablePoints: current.profile.availablePoints,
      },
      update: {
        currentPlanId: nextPlanId,
        startsAt: nextPlanId ? now : null,
        expiresAt: nextExpiry,
      },
    });

    await this.mutationStateService.invalidatePulseDashboardHome();

    return this.memberReadService.buildAdminMemberDetail(memberId);
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

    return this.memberReadService.buildAdminMemberDetail(memberId);
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

    return this.memberReadService.buildAdminMemberDetail(memberId);
  }

  async updateAdminMemberSubAccountQuota(
    user: AuthenticatedUser,
    memberId: number,
    dto: PulseAdminSubAccountQuotaMutationInput,
  ): Promise<PulseMemberDetailDto> {
    await this.assertAdminMemberMutationAccess(user, memberId);
    await this.subAccountMutationService.updateAdminMemberSubAccountQuota(
      memberId,
      user.id,
      dto,
    );

    return this.memberReadService.buildAdminMemberDetail(memberId);
  }

  async updateAdminMemberSubAccountSlot(
    user: AuthenticatedUser,
    memberId: number,
    dto: PulseAdminSubAccountSlotMutationInput,
  ): Promise<PulseMemberDetailDto> {
    await this.assertAdminMemberMutationAccess(user, memberId);
    await this.subAccountMutationService.updateAdminMemberSubAccountSlot(
      memberId,
      dto,
    );

    return this.memberReadService.buildAdminMemberDetail(memberId);
  }

  async assertAdminMemberMutationAccess(
    user: AuthenticatedUser,
    memberId: number,
  ): Promise<void> {
    await this.mutationStateService.assertAdminMemberMutationAccess(
      user,
      memberId,
    );
  }

  private logMembershipLevelMutation(params: {
    user: AuthenticatedUser;
    memberId: number;
    previousPlanId: PulseAdminMembershipProfileRecord['currentPlanId'];
    previousExpiresAt: Date | null;
    nextLevel: PulseAdminMemberLevel;
    nextPlanId: PulseAdminMembershipProfileRecord['currentPlanId'];
    nextExpiry: Date | null;
    dto: PulseAdminMembershipMutationInput;
  }): void {
    const {
      user,
      memberId,
      previousPlanId,
      previousExpiresAt,
      nextLevel,
      nextPlanId,
      nextExpiry,
      dto,
    } = params;

    this.logger.warn(
      JSON.stringify({
        event: 'pulse_admin_membership_level_mutation',
        memberId,
        operatorUserId: user.id,
        operatorEmail: user.email,
        previousPlanId,
        previousExpiresAt: previousExpiresAt?.toISOString() ?? null,
        nextLevel,
        nextPlanId,
        nextExpiry: nextExpiry?.toISOString() ?? null,
        confirmDowngradeToFree: dto.confirmDowngradeToFree ?? false,
        actionSource: dto.actionSource ?? 'unknown',
        requestId: dto.auditContext?.requestId ?? null,
        ip: dto.auditContext?.ip ?? null,
        userAgent: dto.auditContext?.userAgent ?? null,
      }),
    );
  }

  private resolveBanReason(dto: PulseAdminStatusMutationInput): string {
    const reason = dto.reason?.trim() ?? dto.remark?.trim() ?? '';
    if (!reason) {
      throw new BadRequestException('缺少封禁原因');
    }

    return reason;
  }
}

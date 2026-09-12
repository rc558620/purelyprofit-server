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
        // startsAt 始终落盘：即使降级为免费也保留，表示档案已被显式管理，
        // 避免 /center 的订单重建逻辑（normalizeMembershipProfileFromPaidOrders）
        // 把「管理员设置的免费」误判为「档案缺失」而用历史付费订单恢复会员
        startsAt: now,
        expiresAt: nextExpiry,
        totalPoints: current.profile.totalPoints,
        availablePoints: current.profile.availablePoints,
      },
      update: {
        currentPlanId: nextPlanId,
        startsAt: now,
        expiresAt: nextExpiry,
      },
    });

    await this.mutationStateService.invalidateAdminMemberDerived(memberId);

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
    await this.mutationStateService.invalidateAdminMemberDerived(memberId);

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
    await this.mutationStateService.invalidateAdminMemberDerived(memberId);

    return this.memberReadService.buildAdminMemberDetail(memberId);
  }

  async cancelAdminMember(
    user: AuthenticatedUser,
    memberId: number,
  ): Promise<PulseMemberDetailDto> {
    await this.assertAdminMemberMutationAccess(user, memberId);

    const now = new Date();

    this.logger.warn(
      JSON.stringify({
        event: 'pulse_admin_member_cancel',
        memberId,
        operatorUserId: user.id,
        operatorEmail: user.email,
        cancelledAt: now.toISOString(),
      }),
    );

    // 软删除：设置 deletedAt 以标记注销状态
    await this.prisma.store.update({
      where: { id: memberId },
      data: {
        deletedAt: now,
        updatedAt: now,
      },
    });

    // 释放登录身份：注销后该手机号视同从未注册，允许重新完整注册
    await this.releaseOwnerLoginIdentity(memberId);

    // 清除封禁原因（注销后封禁信息不再有意义）
    await this.accessService.clearAdminMemberBanReason(memberId);
    // 踢出所有用户 token 并失效相关缓存
    await this.mutationStateService.invalidateAdminMemberDerived(memberId);

    return this.memberReadService.buildAdminMemberDetail(memberId);
  }

  /**
   * 注销后释放 owner 的登录身份，让手机号可以重新注册：
   * - 门店员工行停用，并改写 email/phone/login_account：
   *   数据库有「单账号单门店」唯一索引（staffs_email_key 等）与触发器
   *   （ensure_single_store_binding_for_store_owner），它们不感知软删除，
   *   已注销门店的员工行若仍占用手机号派生邮箱，会阻断同手机号重新注册建店
   * - owner 无其他在营门店时，改写其唯一登录邮箱（手机号派生）并解绑微信手机号，
   *   释放 users 表唯一约束，使「手机号已被注册」不再拦截重新注册
   */
  private async releaseOwnerLoginIdentity(memberId: number): Promise<void> {
    const store = await this.prisma.store.findUnique({
      where: { id: memberId },
      select: { ownerId: true },
    });
    if (!store) {
      return;
    }

    // 释放该门店全部员工行的登录身份（幂等：已改写为 cancelled_ 前缀的行跳过）
    await this.prisma.$executeRaw`
      UPDATE "staffs"
         SET is_active = false,
             email = 'cancelled_s'
                     || store_id::text || '_st' || id::text
                     || '_' || ${String(Date.now())} || '@purelyprofit.invalid',
             phone = NULL,
             login_account = NULL
       WHERE store_id = ${memberId}
         AND email NOT LIKE 'cancelled\_%'
    `;

    // owner 还拥有其他在营门店时，不能动其用户身份
    const activeOwnedStoreCount = await this.prisma.store.count({
      where: { ownerId: store.ownerId, deletedAt: null, id: { not: memberId } },
    });
    if (activeOwnedStoreCount > 0) {
      return;
    }

    await this.prisma.user.update({
      where: { id: store.ownerId },
      data: {
        // 改写为不占手机号语义的唯一邮箱，释放 phone_xxx@... 派生登录邮箱
        email: `cancelled_u${store.ownerId}_${Date.now()}@purelyprofit.invalid`,
        // 解绑微信授权手机号，允许该手机号重新注册/绑定
        wechatPhone: null,
      },
    });
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

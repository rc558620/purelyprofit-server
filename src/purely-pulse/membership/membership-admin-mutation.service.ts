import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import type { PulseMemberDetailDto } from './dto/pulse-membership-admin-member-detail.response.dto';
import { PulseMembershipAdminBeansMutationService } from './membership-admin-beans-mutation.service';
import { PulseMembershipAdminMemberReadService } from './membership-admin-member-read.service';
import { PulseMembershipAdminMembershipMutationService } from './membership-admin-membership-mutation.service';
import { PulseMembershipAdminMutationStateService } from './membership-admin-mutation-state.service';
import { PulseMembershipAdminPointsMutationService } from './membership-admin-points-mutation.service';
import { PulseMembershipAdminStatusMutationService } from './membership-admin-status-mutation.service';
import { PulseMembershipAdminSubAccountMutationService } from './membership-admin-sub-account-mutation.service';
import type {
  PulseAdminMembershipMutationInput,
  PulseAdminStatusMutationInput,
  PulseAdminSubAccountQuotaMutationInput,
  PulseAdminSubAccountSlotMutationInput,
  PulseMembershipAdjustmentInput,
} from './membership.types';

/**
 * 管理员会员写操作的编排入口，自身不含任何领域逻辑：
 *
 * 每个写接口统一走「鉴权 → 委托对应领域的 MutationService 执行 → 重建会员详情」三步，
 * 具体的积分 / 咖豆 / 会员等级 / 会员状态 / 子账号写逻辑下沉到各自的 MutationService。
 */
@Injectable()
export class PulseMembershipAdminMutationService {
  constructor(
    private readonly memberReadService: PulseMembershipAdminMemberReadService,
    private readonly mutationStateService: PulseMembershipAdminMutationStateService,
    private readonly membershipMutationService: PulseMembershipAdminMembershipMutationService,
    private readonly statusMutationService: PulseMembershipAdminStatusMutationService,
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
    await this.membershipMutationService.applyAdminMembershipLevel(
      user,
      memberId,
      dto,
    );

    return this.memberReadService.buildAdminMemberDetail(memberId);
  }

  /** 重置门店的首购锁定价，让运营可以在下一次成交时重新锁价 */
  async resetAdminMemberLockedPrices(
    user: AuthenticatedUser,
    memberId: number,
  ): Promise<PulseMemberDetailDto> {
    await this.assertAdminMemberMutationAccess(user, memberId);
    await this.membershipMutationService.resetAdminMemberLockedPrices(
      user,
      memberId,
    );

    return this.memberReadService.buildAdminMemberDetail(memberId);
  }

  async banAdminMember(
    user: AuthenticatedUser,
    memberId: number,
    dto: PulseAdminStatusMutationInput,
  ): Promise<PulseMemberDetailDto> {
    await this.assertAdminMemberMutationAccess(user, memberId);
    await this.statusMutationService.banAdminMember(memberId, dto);

    return this.memberReadService.buildAdminMemberDetail(memberId);
  }

  async unbanAdminMember(
    user: AuthenticatedUser,
    memberId: number,
  ): Promise<PulseMemberDetailDto> {
    await this.assertAdminMemberMutationAccess(user, memberId);
    await this.statusMutationService.unbanAdminMember(memberId);

    return this.memberReadService.buildAdminMemberDetail(memberId);
  }

  async cancelAdminMember(
    user: AuthenticatedUser,
    memberId: number,
  ): Promise<PulseMemberDetailDto> {
    await this.assertAdminMemberMutationAccess(user, memberId);
    await this.statusMutationService.cancelAdminMember(user, memberId);

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
}

import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
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
} from './dto/pulse-membership-admin-members.response.dto';
import type { PulseAdminMemberClubStatsDto } from './dto/pulse-membership-admin-club-stats.response.dto';
import type { PulseAdminMemberSalesStatsDto } from './dto/pulse-membership-admin-sales-stats.response.dto';
import { PulseMembershipAdminMutationService } from './membership-admin-mutation.service';
import { PulseMembershipAdminQueryService } from './membership-admin-query.service';
import type {
  PulseAdminMembershipMutationInput,
  PulseAdminStatusMutationInput,
  PulseAdminSubAccountQuotaMutationInput,
  PulseAdminSubAccountSlotMutationInput,
  PulseMembershipAdjustmentInput,
} from './membership.types';

@Injectable()
export class PulseMembershipAdminService {
  constructor(
    private readonly queryService: PulseMembershipAdminQueryService,
    private readonly mutationService: PulseMembershipAdminMutationService,
  ) {}

  listAdminPointsLogs(
    user: AuthenticatedUser,
    query: GetPulseAdminMemberLogsQueryDto,
  ): Promise<PulseAdminMemberPointsLogsResponseDto> {
    return this.queryService.listAdminPointsLogs(user, query);
  }

  listAdminBeanLogs(
    user: AuthenticatedUser,
    query: GetPulseAdminMemberLogsQueryDto,
  ): Promise<PulseAdminMemberBeanLogsResponseDto> {
    return this.queryService.listAdminBeanLogs(user, query);
  }

  listAdminMembers(
    user: AuthenticatedUser,
    query: GetPulseAdminMembersQueryDto,
  ): Promise<PulseAdminMembersResponseDto> {
    return this.queryService.listAdminMembers(user, query);
  }

  getAdminMemberDetail(
    user: AuthenticatedUser,
    memberId: number,
  ): Promise<PulseMemberDetailDto> {
    return this.queryService.getAdminMemberDetail(user, memberId);
  }

  listAdminMemberEmployeeCandidates(
    user: AuthenticatedUser,
    memberId: number,
  ): Promise<PulseAdminEmployeeCandidateDto[]> {
    return this.queryService.listAdminMemberEmployeeCandidates(user, memberId);
  }

  getAdminMemberClubStats(
    user: AuthenticatedUser,
    memberId: number,
  ): Promise<PulseAdminMemberClubStatsDto> {
    return this.queryService.getAdminMemberClubStats(user, memberId);
  }

  getAdminMemberSalesStats(
    user: AuthenticatedUser,
    memberId: number,
  ): Promise<PulseAdminMemberSalesStatsDto> {
    return this.queryService.getAdminMemberSalesStats(user, memberId);
  }

  adjustAdminMemberPoints(
    user: AuthenticatedUser,
    memberId: number,
    dto: PulseMembershipAdjustmentInput,
  ): Promise<PulseMemberDetailDto> {
    return this.mutationService.adjustAdminMemberPoints(user, memberId, dto);
  }

  adjustAdminMemberBeans(
    user: AuthenticatedUser,
    memberId: number,
    dto: PulseMembershipAdjustmentInput,
  ): Promise<PulseMemberDetailDto> {
    return this.mutationService.adjustAdminMemberBeans(user, memberId, dto);
  }

  setAdminMemberMembership(
    user: AuthenticatedUser,
    memberId: number,
    dto: PulseAdminMembershipMutationInput,
  ): Promise<PulseMemberDetailDto> {
    return this.mutationService.setAdminMemberMembership(user, memberId, dto);
  }

  banAdminMember(
    user: AuthenticatedUser,
    memberId: number,
    dto: PulseAdminStatusMutationInput,
  ): Promise<PulseMemberDetailDto> {
    return this.mutationService.banAdminMember(user, memberId, dto);
  }

  unbanAdminMember(
    user: AuthenticatedUser,
    memberId: number,
  ): Promise<PulseMemberDetailDto> {
    return this.mutationService.unbanAdminMember(user, memberId);
  }

  cancelAdminMember(
    user: AuthenticatedUser,
    memberId: number,
  ): Promise<PulseMemberDetailDto> {
    return this.mutationService.cancelAdminMember(user, memberId);
  }

  updateAdminMemberSubAccountQuota(
    user: AuthenticatedUser,
    memberId: number,
    dto: PulseAdminSubAccountQuotaMutationInput,
  ): Promise<PulseMemberDetailDto> {
    return this.mutationService.updateAdminMemberSubAccountQuota(
      user,
      memberId,
      dto,
    );
  }

  updateAdminMemberSubAccountSlot(
    user: AuthenticatedUser,
    memberId: number,
    dto: PulseAdminSubAccountSlotMutationInput,
  ): Promise<PulseMemberDetailDto> {
    return this.mutationService.updateAdminMemberSubAccountSlot(
      user,
      memberId,
      dto,
    );
  }
}

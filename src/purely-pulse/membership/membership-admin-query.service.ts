import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
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
import { PulseMembershipAccessService } from './membership-access.service';
import { PulseMembershipAdminClubStatsService } from './membership-admin-club-stats.service';
import { PulseMembershipAdminLogsQueryService } from './membership-admin-logs-query.service';
import { PulseMembershipAdminMemberReadService } from './membership-admin-member-read.service';
import { PulseMembershipAdminSalesStatsService } from './membership-admin-sales-stats.service';
import { PulseMembershipAdminSubAccountReadService } from './membership-admin-sub-account-read.service';

@Injectable()
export class PulseMembershipAdminQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessService: PulseMembershipAccessService,
    private readonly memberReadService: PulseMembershipAdminMemberReadService,
    private readonly subAccountReadService: PulseMembershipAdminSubAccountReadService,
    private readonly logsQueryService: PulseMembershipAdminLogsQueryService,
    private readonly clubStatsService: PulseMembershipAdminClubStatsService,
    private readonly salesStatsService: PulseMembershipAdminSalesStatsService,
  ) {}

  async listAdminPointsLogs(
    user: AuthenticatedUser,
    query: GetPulseAdminMemberLogsQueryDto,
  ): Promise<PulseAdminMemberPointsLogsResponseDto> {
    return this.logsQueryService.listAdminPointsLogs(user, query);
  }

  async listAdminBeanLogs(
    user: AuthenticatedUser,
    query: GetPulseAdminMemberLogsQueryDto,
  ): Promise<PulseAdminMemberBeanLogsResponseDto> {
    return this.logsQueryService.listAdminBeanLogs(user, query);
  }

  async listAdminMembers(
    user: AuthenticatedUser,
    query: GetPulseAdminMembersQueryDto,
  ): Promise<PulseAdminMembersResponseDto> {
    const storeIds = await this.accessService.resolveAdminMemberStoreIds(user);
    const items = await this.memberReadService.buildAdminMemberListItems(
      storeIds,
      query,
    );

    return {
      items,
      // 使用内存过滤后的数量作为 total，因为封禁状态存储在 Redis 中，
      // 数据库层过滤无法完整排除 banned 会员，需要二次过滤补全。
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

    return this.memberReadService.buildAdminMemberDetail(memberId);
  }

  async getAdminMemberClubStats(
    user: AuthenticatedUser,
    memberId: number,
  ): Promise<PulseAdminMemberClubStatsDto> {
    return this.clubStatsService.getAdminMemberClubStats(user, memberId);
  }

  async listAdminMemberEmployeeCandidates(
    user: AuthenticatedUser,
    memberId: number,
  ): Promise<PulseAdminEmployeeCandidateDto[]> {
    // 先确认 store 是否存在
    const store = await this.prisma.store.findUnique({
      where: { id: memberId },
      select: { id: true },
    });
    if (!store) {
      throw new NotFoundException('会员不存在');
    }

    // 再确认当前用户是否有权限访问
    const canAccess = await this.accessService.canAccessAdminMember(
      user,
      memberId,
    );
    if (!canAccess) {
      throw new ForbiddenException('暂无权限查看员工候选列表');
    }

    return this.subAccountReadService.listAdminMemberEmployeeCandidates(
      memberId,
    );
  }

  async getAdminMemberSalesStats(
    user: AuthenticatedUser,
    memberId: number,
  ): Promise<PulseAdminMemberSalesStatsDto> {
    return this.salesStatsService.getAdminMemberSalesStats(user, memberId);
  }
}

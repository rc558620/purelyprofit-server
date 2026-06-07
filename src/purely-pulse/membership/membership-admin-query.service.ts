import { Injectable, NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
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
} from './dto/pulse-membership-admin-members.response.dto';
import { PulseMembershipAccessService } from './membership-access.service';
import { PulseMembershipAdminMemberReadService } from './membership-admin-member-read.service';
import { PulseMembershipAdminSubAccountReadService } from './membership-admin-sub-account-read.service';
import {
  buildPulseAdminBeanLogItem,
  buildPulseAdminPointsLogItem,
} from './membership-admin-member.builder';
import {
  encodeAdminMemberLogsCursor,
  resolveAdminMemberLogsCursorPagination,
} from './membership-admin-query.helper';

@Injectable()
export class PulseMembershipAdminQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessService: PulseMembershipAccessService,
    private readonly memberReadService: PulseMembershipAdminMemberReadService,
    private readonly subAccountReadService: PulseMembershipAdminSubAccountReadService,
  ) {}

  async listAdminPointsLogs(
    user: AuthenticatedUser,
    query: GetPulseAdminMemberLogsQueryDto,
  ): Promise<PulseAdminMemberPointsLogsResponseDto> {
    const result = await this.listAdminLogs(
      user,
      query,
      async (storeIds, cursorPagination) =>
        this.prisma.storeMembershipPointsLog.findMany({
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
        }),
    );

    return {
      items: result.items.map(buildPulseAdminPointsLogItem),
      hasMore: result.hasMore,
      nextCursor: result.nextCursor,
    };
  }

  async listAdminBeanLogs(
    user: AuthenticatedUser,
    query: GetPulseAdminMemberLogsQueryDto,
  ): Promise<PulseAdminMemberBeanLogsResponseDto> {
    const result = await this.listAdminLogs(
      user,
      query,
      async (storeIds, cursorPagination) =>
        this.prisma.storePartnerBeanLog.findMany({
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
        }),
    );

    return {
      items: result.items.map(buildPulseAdminBeanLogItem),
      hasMore: result.hasMore,
      nextCursor: result.nextCursor,
    };
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

    return this.subAccountReadService.listAdminMemberEmployeeCandidates(
      memberId,
    );
  }

  private async listAdminLogs<
    TLogRecord extends { id: number; createdAt: Date },
  >(
    user: AuthenticatedUser,
    query: GetPulseAdminMemberLogsQueryDto,
    fetchLogs: (
      storeIds: number[],
      cursorPagination: ReturnType<
        typeof resolveAdminMemberLogsCursorPagination
      >,
    ) => Promise<TLogRecord[]>,
  ): Promise<{
    items: TLogRecord[];
    hasMore: boolean;
    nextCursor: string | null;
  }> {
    const storeIds = await this.accessService.resolveAdminMemberStoreIds(user);
    const cursorPagination = resolveAdminMemberLogsCursorPagination(query);
    const logs = await fetchLogs(storeIds, cursorPagination);
    const hasMore =
      cursorPagination.limit !== undefined &&
      logs.length > cursorPagination.limit;
    const visibleLogs = hasMore ? logs.slice(0, cursorPagination.limit) : logs;

    return {
      items: visibleLogs,
      hasMore,
      nextCursor: hasMore
        ? encodeAdminMemberLogsCursor(visibleLogs.at(-1) ?? null)
        : null,
    };
  }
}

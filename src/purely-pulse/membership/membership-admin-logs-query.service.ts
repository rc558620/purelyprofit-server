import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import type { GetPulseAdminMemberLogsQueryDto } from './dto/pulse-membership-admin-logs.request.dto';
import type {
  PulseAdminMemberBeanLogsResponseDto,
  PulseAdminMemberPointsLogsResponseDto,
} from './dto/pulse-membership-admin-logs.response.dto';
import { PulseMembershipAccessService } from './membership-access.service';
import {
  buildPulseAdminBeanLogItem,
  buildPulseAdminPointsLogItem,
} from './membership-admin-member.builder';
import {
  encodeAdminMemberLogsCursor,
  resolveAdminMemberLogsCursorPagination,
} from './membership-admin-query.helper';

@Injectable()
export class PulseMembershipAdminLogsQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessService: PulseMembershipAccessService,
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
            changeType: true,
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
                    avatar: true,
                    wechatPhone: true,
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
                    avatar: true,
                    wechatPhone: true,
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

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PrismaService } from '../prisma/prisma.service';
import {
  AdjustMemberBeansDto,
  AdjustMemberBeansResponseDto,
  AdjustMemberPointsDto,
  AdjustMemberPointsResponseDto,
  ListMemberBeansLogsQueryDto,
  ListMemberPointsLogsQueryDto,
  MemberBeansOverviewResponseDto,
  MemberLogsOverviewQueryDto,
  MemberPointsOverviewResponseDto,
  PaginatedMemberBeansLogsResponseDto,
  PaginatedMemberPointsLogsResponseDto,
} from './dto/adjust-member-points.dto';
import { MembersAccessService } from './members-access.service';
import { type MemberRecord, toMemberResponse } from './members.mapper';
import {
  type MemberBeanLogRecord,
  type MemberPointsLogRecord,
  toMemberBeansLogResponse,
  toMemberPointsLogResponse,
} from './members-points.mapper';
import { buildPaginationMeta, resolvePagination } from './members.utils';

interface CountRow {
  count: number;
}

const MEMBER_RETURNING_SQL = Prisma.sql`
  RETURNING
    id,
    store_id AS "storeId",
    name,
    phone,
    gender,
    level,
    note,
    birthday,
    last_consume_at AS "lastConsumeAt",
    points,
    total_points_earned AS "totalPointsEarned",
    bean_balance AS "beanBalance",
    is_partner AS "isPartner",
    partner_level AS "partnerLevel",
    total_recharged AS "totalRecharged",
    recharge_count AS "rechargeCount",
    invited_count AS "invitedCount",
    banned_reason AS "bannedReason",
    status,
    created_at AS "createdAt",
    updated_at AS "updatedAt"
`;

@Injectable()
export class MembersPointsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly membersAccessService: MembersAccessService,
    private readonly configService: ConfigService,
  ) {}

  async getPointsOverview(
    user: AuthenticatedUser,
    query: MemberLogsOverviewQueryDto,
  ): Promise<MemberPointsOverviewResponseDto> {
    const storeId = await this.resolveViewStoreId(
      user,
      query.storeId,
      '无权查看该门店积分记录概览',
    );

    if (storeId === null) {
      return {
        totalCount: 0,
        adminAdjustCount: 0,
        todayChangeCount: 0,
      };
    }

    const rows = await this.prisma.$queryRaw<
      Array<{
        totalCount: number;
        adminAdjustCount: number;
        todayChangeCount: number;
      }>
    >`
      SELECT
        COUNT(*)::int AS "totalCount",
        COUNT(*) FILTER (
          WHERE source = 'admin_adjust'::"MemberPointsSource"
        )::int AS "adminAdjustCount",
        COUNT(*) FILTER (
          WHERE created_at >= DATE_TRUNC('day', NOW())
        )::int AS "todayChangeCount"
      FROM member_points_logs
      WHERE store_id = ${storeId}
    `;

    return (
      rows[0] ?? {
        totalCount: 0,
        adminAdjustCount: 0,
        todayChangeCount: 0,
      }
    );
  }

  async listPointsLogs(
    user: AuthenticatedUser,
    query: ListMemberPointsLogsQueryDto,
  ): Promise<PaginatedMemberPointsLogsResponseDto> {
    const storeId = await this.resolveViewStoreId(
      user,
      query.storeId,
      '无权查看该门店积分记录',
    );

    return this.queryPointsLogs({
      storeId,
      page: query.page,
      pageSize: query.pageSize,
      type: query.type,
      source: query.source,
      keyword: query.keyword,
    });
  }

  async listPointsLogsForMember(
    user: AuthenticatedUser,
    memberId: number,
    query: ListMemberPointsLogsQueryDto,
  ): Promise<PaginatedMemberPointsLogsResponseDto> {
    const member = await this.membersAccessService.findManageableMemberOrThrow(
      user,
      memberId,
      'members:view',
    );

    return this.queryPointsLogs({
      storeId: member.storeId,
      memberId: member.id,
      page: query.page,
      pageSize: query.pageSize,
      type: query.type,
      source: query.source,
      keyword: query.keyword,
    });
  }

  async adjustPoints(
    user: AuthenticatedUser,
    dto: AdjustMemberPointsDto,
    memberId?: number,
  ): Promise<AdjustMemberPointsResponseDto> {
    const resolvedMemberId = memberId ?? this.parseMemberId(dto.userId);
    const existingMember =
      await this.membersAccessService.findManageableMemberOrThrow(
        user,
        resolvedMemberId,
        'members:update',
      );
    const operatorStaffId =
      await this.membersAccessService.findOperatorStaffIdForStore(
        user,
        existingMember.storeId,
      );
    const beforePoints = existingMember.points;
    const afterPoints = beforePoints + dto.delta;

    if (afterPoints < 0) {
      throw new BadRequestException('会员当前积分不足，无法扣减');
    }

    const [member, log] = await this.prisma.$transaction(
      async (transaction) => {
        const memberRows = (await transaction.$queryRaw<MemberRecord[]>`
        UPDATE members
        SET
          points = ${afterPoints},
          total_points_earned = total_points_earned + ${dto.delta > 0 ? dto.delta : 0},
          updated_at = NOW()
        WHERE id = ${existingMember.id}
        ${MEMBER_RETURNING_SQL}
      `) as MemberRecord[];
        const logRows = (await transaction.$queryRaw<MemberPointsLogRecord[]>`
        INSERT INTO member_points_logs (
          member_id,
          store_id,
          operator_staff_id,
          change_type,
          source,
          change_amount,
          before_points,
          after_points,
          reason
        )
        VALUES (
          ${existingMember.id},
          ${existingMember.storeId},
          ${operatorStaffId},
          ${dto.delta > 0 ? 'INCREASE' : 'DECREASE'}::"MemberPointsChangeType",
          'admin_adjust'::"MemberPointsSource",
          ${Math.abs(dto.delta)},
          ${beforePoints},
          ${afterPoints},
          ${dto.reason.trim()}
        )
        RETURNING
          id,
          member_id AS "memberId",
          ${existingMember.name}::text AS "memberName",
          ${existingMember.phone}::text AS "memberPhone",
          ${dto.delta}::int AS amount,
          source::text AS source,
          reason AS description,
          created_at AS "createdAt",
          expires_at AS "expireAt"
      `) as MemberPointsLogRecord[];

        return [
          this.requireMemberRow(memberRows[0]),
          this.requirePointsLogRow(logRows[0]),
        ] as const;
      },
    );

    return {
      user: toMemberResponse(member),
      record: toMemberPointsLogResponse(log),
    };
  }

  async getBeansOverview(
    user: AuthenticatedUser,
    query: MemberLogsOverviewQueryDto,
  ): Promise<MemberBeansOverviewResponseDto> {
    const storeId = await this.resolveViewStoreId(
      user,
      query.storeId,
      '无权查看该门店纯利豆记录概览',
    );

    if (storeId === null) {
      return {
        totalCount: 0,
        adminAdjustCount: 0,
        promoRewardCount: 0,
        withdrawCount: 0,
      };
    }

    const rows = await this.prisma.$queryRaw<
      Array<{
        totalCount: number;
        adminAdjustCount: number;
        promoRewardCount: number;
        withdrawCount: number;
      }>
    >`
      SELECT
        COUNT(*)::int AS "totalCount",
        COUNT(*) FILTER (
          WHERE source = 'admin_adjust'::"MemberBeanSource"
        )::int AS "adminAdjustCount",
        COUNT(*) FILTER (
          WHERE source = 'promo_reward'::"MemberBeanSource"
        )::int AS "promoRewardCount",
        COUNT(*) FILTER (
          WHERE source = 'withdrawal'::"MemberBeanSource"
        )::int AS "withdrawCount"
      FROM member_bean_logs
      WHERE store_id = ${storeId}
    `;

    return (
      rows[0] ?? {
        totalCount: 0,
        adminAdjustCount: 0,
        promoRewardCount: 0,
        withdrawCount: 0,
      }
    );
  }

  async listBeanLogs(
    user: AuthenticatedUser,
    query: ListMemberBeansLogsQueryDto,
  ): Promise<PaginatedMemberBeansLogsResponseDto> {
    const storeId = await this.resolveViewStoreId(
      user,
      query.storeId,
      '无权查看该门店纯利豆记录',
    );

    return this.queryBeanLogs({
      storeId,
      page: query.page,
      pageSize: query.pageSize,
      type: query.type,
      source: query.source,
      keyword: query.keyword,
    });
  }

  async listBeanLogsForMember(
    user: AuthenticatedUser,
    memberId: number,
    query: ListMemberBeansLogsQueryDto,
  ): Promise<PaginatedMemberBeansLogsResponseDto> {
    const member = await this.membersAccessService.findManageableMemberOrThrow(
      user,
      memberId,
      'members:view',
    );

    return this.queryBeanLogs({
      storeId: member.storeId,
      memberId: member.id,
      page: query.page,
      pageSize: query.pageSize,
      type: query.type,
      source: query.source,
      keyword: query.keyword,
    });
  }

  async adjustBeans(
    user: AuthenticatedUser,
    dto: AdjustMemberBeansDto,
    memberId?: number,
  ): Promise<AdjustMemberBeansResponseDto> {
    const resolvedMemberId = memberId ?? this.parseMemberId(dto.userId);
    const existingMember =
      await this.membersAccessService.findManageableMemberOrThrow(
        user,
        resolvedMemberId,
        'members:update',
      );
    const operatorStaffId =
      await this.membersAccessService.findOperatorStaffIdForStore(
        user,
        existingMember.storeId,
      );
    const beforeBalance = existingMember.beanBalance;
    const afterBalance = beforeBalance + dto.delta;

    if (afterBalance < 0) {
      throw new BadRequestException('会员当前纯利豆不足，无法扣减');
    }

    const [member, log] = await this.prisma.$transaction(
      async (transaction) => {
        const memberRows = (await transaction.$queryRaw<MemberRecord[]>`
        UPDATE members
        SET
          bean_balance = ${afterBalance},
          updated_at = NOW()
        WHERE id = ${existingMember.id}
        ${MEMBER_RETURNING_SQL}
      `) as MemberRecord[];
        const logRows = (await transaction.$queryRaw<MemberBeanLogRecord[]>`
        INSERT INTO member_bean_logs (
          member_id,
          store_id,
          operator_staff_id,
          source,
          change_amount,
          before_balance,
          after_balance,
          reason
        )
        VALUES (
          ${existingMember.id},
          ${existingMember.storeId},
          ${operatorStaffId},
          'admin_adjust'::"MemberBeanSource",
          ${dto.delta},
          ${beforeBalance},
          ${afterBalance},
          ${dto.reason.trim()}
        )
        RETURNING
          id,
          member_id AS "memberId",
          ${existingMember.name}::text AS "memberName",
          ${existingMember.phone}::text AS "memberPhone",
          change_amount AS amount,
          source::text AS source,
          reason AS description,
          related_promo_id AS "relatedPromoId",
          related_user AS "relatedUser",
          created_at AS "createdAt"
      `) as MemberBeanLogRecord[];

        return [
          this.requireMemberRow(memberRows[0]),
          this.requireBeanLogRow(logRows[0]),
        ] as const;
      },
    );

    return {
      user: toMemberResponse(member),
      record: toMemberBeansLogResponse(log),
    };
  }

  private async queryPointsLogs(params: {
    storeId: number | null;
    memberId?: number;
    page?: number;
    pageSize?: number;
    type?: ListMemberPointsLogsQueryDto['type'];
    source?: ListMemberPointsLogsQueryDto['source'];
    keyword?: string;
  }): Promise<PaginatedMemberPointsLogsResponseDto> {
    const { storeId, memberId, page, pageSize, type, source, keyword } = params;
    const { page: currentPage, skip, take } = this.resolvePage(page, pageSize);

    if (storeId === null) {
      return {
        items: [],
        meta: buildPaginationMeta(0, currentPage, take),
      };
    }

    const filters: Prisma.Sql[] = [Prisma.sql`l.store_id = ${storeId}`];

    if (memberId) {
      filters.push(Prisma.sql`l.member_id = ${memberId}`);
    }

    if (type === 'earn') {
      filters.push(
        Prisma.sql`l.source <> 'expire'::"MemberPointsSource" AND l.change_type = 'INCREASE'`,
      );
    }

    if (type === 'spend') {
      filters.push(
        Prisma.sql`l.source <> 'expire'::"MemberPointsSource" AND l.change_type = 'DECREASE'`,
      );
    }

    if (type === 'expire') {
      filters.push(Prisma.sql`l.source = 'expire'::"MemberPointsSource"`);
    }

    if (source) {
      filters.push(Prisma.sql`l.source = ${source}::"MemberPointsSource"`);
    }

    if (keyword) {
      filters.push(
        Prisma.sql`(
          m.name ILIKE ${`%${keyword}%`}
          OR m.phone LIKE ${`%${keyword}%`}
          OR l.reason ILIKE ${`%${keyword}%`}
        )`,
      );
    }

    const whereClause = Prisma.join(filters, ' AND ');
    const [items, countRows] = (await Promise.all([
      this.prisma.$queryRaw<MemberPointsLogRecord[]>`
        SELECT
          l.id,
          l.member_id AS "memberId",
          m.name AS "memberName",
          m.phone AS "memberPhone",
          CASE
            WHEN l.source = 'expire'::"MemberPointsSource" THEN -l.change_amount
            WHEN l.change_type = 'INCREASE' THEN l.change_amount
            ELSE -l.change_amount
          END AS amount,
          l.source::text AS source,
          l.reason AS description,
          l.created_at AS "createdAt",
          l.expires_at AS "expireAt"
        FROM member_points_logs l
        JOIN members m ON m.id = l.member_id
        WHERE ${whereClause}
        ORDER BY l.created_at DESC, l.id DESC
        OFFSET ${skip}
        LIMIT ${take}
      `,
      this.prisma.$queryRaw<CountRow[]>`
        SELECT COUNT(*)::int AS count
        FROM member_points_logs l
        JOIN members m ON m.id = l.member_id
        WHERE ${whereClause}
      `,
    ])) as [MemberPointsLogRecord[], CountRow[]];

    return {
      items: items.map((item) => toMemberPointsLogResponse(item)),
      meta: buildPaginationMeta(countRows[0]?.count ?? 0, currentPage, take),
    };
  }

  private async queryBeanLogs(params: {
    storeId: number | null;
    memberId?: number;
    page?: number;
    pageSize?: number;
    type?: ListMemberBeansLogsQueryDto['type'];
    source?: ListMemberBeansLogsQueryDto['source'];
    keyword?: string;
  }): Promise<PaginatedMemberBeansLogsResponseDto> {
    const { storeId, memberId, page, pageSize, type, source, keyword } = params;
    const { page: currentPage, skip, take } = this.resolvePage(page, pageSize);

    if (storeId === null) {
      return {
        items: [],
        meta: buildPaginationMeta(0, currentPage, take),
      };
    }

    const filters: Prisma.Sql[] = [Prisma.sql`l.store_id = ${storeId}`];

    if (memberId) {
      filters.push(Prisma.sql`l.member_id = ${memberId}`);
    }

    if (type === 'earn') {
      filters.push(Prisma.sql`l.change_amount > 0`);
    }

    if (type === 'spend') {
      filters.push(
        Prisma.sql`l.change_amount < 0 AND l.source <> 'withdrawal'::"MemberBeanSource"`,
      );
    }

    if (type === 'withdraw') {
      filters.push(Prisma.sql`l.source = 'withdrawal'::"MemberBeanSource"`);
    }

    if (source) {
      filters.push(Prisma.sql`l.source = ${source}::"MemberBeanSource"`);
    }

    if (keyword) {
      filters.push(
        Prisma.sql`(
          m.name ILIKE ${`%${keyword}%`}
          OR m.phone LIKE ${`%${keyword}%`}
          OR l.reason ILIKE ${`%${keyword}%`}
          OR COALESCE(l.related_user, '') ILIKE ${`%${keyword}%`}
        )`,
      );
    }

    const whereClause = Prisma.join(filters, ' AND ');
    const [items, countRows] = (await Promise.all([
      this.prisma.$queryRaw<MemberBeanLogRecord[]>`
        SELECT
          l.id,
          l.member_id AS "memberId",
          m.name AS "memberName",
          m.phone AS "memberPhone",
          l.change_amount AS amount,
          l.source::text AS source,
          l.reason AS description,
          l.related_promo_id AS "relatedPromoId",
          l.related_user AS "relatedUser",
          l.created_at AS "createdAt"
        FROM member_bean_logs l
        JOIN members m ON m.id = l.member_id
        WHERE ${whereClause}
        ORDER BY l.created_at DESC, l.id DESC
        OFFSET ${skip}
        LIMIT ${take}
      `,
      this.prisma.$queryRaw<CountRow[]>`
        SELECT COUNT(*)::int AS count
        FROM member_bean_logs l
        JOIN members m ON m.id = l.member_id
        WHERE ${whereClause}
      `,
    ])) as [MemberBeanLogRecord[], CountRow[]];

    return {
      items: items.map((item) => toMemberBeansLogResponse(item)),
      meta: buildPaginationMeta(countRows[0]?.count ?? 0, currentPage, take),
    };
  }

  private resolveViewStoreId(
    user: AuthenticatedUser,
    storeId: number | undefined,
    forbiddenMessage: string,
  ): Promise<number | null> {
    const resolver = this.membersAccessService.resolveMembersViewStoreId as (
      user: AuthenticatedUser,
      storeId: number | undefined,
      forbiddenMessage: string,
    ) => Promise<number | null>;

    return resolver(user, storeId, forbiddenMessage);
  }

  private parseMemberId(userId?: string): number {
    if (!userId) {
      throw new NotFoundException('缺少会员 ID');
    }

    const parsedMemberId = Number.parseInt(userId, 10);
    if (!Number.isInteger(parsedMemberId) || parsedMemberId <= 0) {
      throw new NotFoundException('会员 ID 不合法');
    }

    return parsedMemberId;
  }

  private resolvePage(
    page?: number,
    pageSize?: number,
  ): { page: number; skip: number; take: number } {
    const defaultPageSize =
      this.configService.get<number>('app.defaultPageSize') ?? 20;
    const maxPageSize =
      this.configService.get<number>('app.maxPageSize') ?? 100;

    return resolvePagination(page, pageSize, defaultPageSize, maxPageSize);
  }

  private requireMemberRow(member?: MemberRecord): MemberRecord {
    if (!member) {
      throw new ConflictException('会员数据读取失败，请稍后重试');
    }

    return member;
  }

  private requirePointsLogRow(
    log?: MemberPointsLogRecord,
  ): MemberPointsLogRecord {
    if (!log) {
      throw new ConflictException('积分记录写入失败，请稍后重试');
    }

    return log;
  }

  private requireBeanLogRow(log?: MemberBeanLogRecord): MemberBeanLogRecord {
    if (!log) {
      throw new ConflictException('纯利豆记录写入失败，请稍后重试');
    }

    return log;
  }
}

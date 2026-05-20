import { ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MemberGender, Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateMemberDto } from './dto/create-member.dto';
import {
  MemberMetaQueryDto,
  MembersMetaResponseDto,
} from './dto/member-meta.dto';
import {
  MemberOverviewQueryDto,
  MembersOverviewResponseDto,
} from './dto/member-overview.dto';
import {
  ListMembersQueryDto,
  MemberRechargeRecordDto,
  MemberResponseDto,
  MemberSnapshotDto,
  PaginatedMembersResponseDto,
} from './dto/member-response.dto';
import { UpdateMemberDto } from './dto/update-member.dto';
import { MembersAccessService } from './members-access.service';
import {
  type MemberRecord,
  type MemberRechargeRecord,
  toMemberResponse,
} from './members.mapper';
import {
  buildPaginationMeta,
  normalizeOptionalText,
  normalizePhone,
  resolvePagination,
  toApiMemberStatus,
  toDbMemberStatus,
  type MemberStatusDb,
} from './members.utils';

const MEMBER_SELECT_SQL = Prisma.sql`
  SELECT
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
  FROM members
`;

interface CountRow {
  count: number;
}

interface MemberLevelMetaRow {
  value: string;
  count: number;
}

interface MemberOverviewRow {
  totalCount: number;
  activeCount: number;
  partnerCount: number;
  bannedCount: number;
}

interface MemberStatusMetaRow {
  value: MemberStatusDb;
  count: number;
}

interface MemberSnapshotRow {
  id: number;
  name: string;
  phone: string | null;
  points: number;
  beanBalance: number;
  isPartner: boolean;
}

interface MemberSnapshotsQuery {
  storeId?: number;
  keyword?: string;
  onlyPartners?: boolean;
}

type ApiMemberStatus = 'active' | 'inactive' | 'banned';
type ApiMemberLevel = 'free' | 'monthly' | 'quarterly' | 'annual';

@Injectable()
export class MembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly membersAccessService: MembersAccessService,
    private readonly configService: ConfigService,
  ) {}

  async create(
    user: AuthenticatedUser,
    dto: CreateMemberDto,
  ): Promise<MemberResponseDto> {
    await this.membersAccessService.ensureCanManageMembers(
      user,
      dto.storeId,
      'members:create',
    );

    const payload = this.toPayload(dto);
    const normalizedPhone = normalizePhone(
      this.readOptionalString(payload, 'phone'),
    );
    await this.ensurePhoneUnique(dto.storeId, normalizedPhone);

    const level = this.readOptionalLevel(payload, 'level') ?? 'free';
    const points = this.readOptionalNumber(payload, 'availablePoints') ?? 0;
    const totalPointsEarnedInput =
      this.readOptionalNumber(payload, 'totalPointsEarned') ?? points;
    const totalPointsEarned = Math.max(totalPointsEarnedInput, points, 0);
    const beanBalance = this.readOptionalNumber(payload, 'beanBalance') ?? 0;
    const isPartner = this.readOptionalBoolean(payload, 'isPartner') ?? false;
    const partnerLevel = isPartner
      ? (this.readTrimmedString(payload, 'partnerLevel') ?? null)
      : null;
    const rechargeHistory = this.readRechargeHistory(payload) ?? [];
    const totalRecharged =
      this.readOptionalNumber(payload, 'totalRecharged') ??
      this.sumRechargeAmounts(rechargeHistory);
    const rechargeCount =
      this.readOptionalNumber(payload, 'rechargeCount') ??
      rechargeHistory.length;

    const invitedCount = this.readOptionalNumber(payload, 'invitedCount') ?? 0;
    const status =
      toDbMemberStatus(this.readOptionalStatus(payload, 'status')) ?? 'ACTIVE';
    const gender = this.readOptionalGender(payload, 'gender') ?? 'UNKNOWN';
    const requestedRemark = this.readOptionalString(payload, 'remark');
    const requestedBannedReason = this.readOptionalString(
      payload,
      'bannedReason',
    );
    const note =
      status === 'BANNED' && requestedBannedReason === undefined
        ? null
        : (normalizeOptionalText(requestedRemark) ?? null);
    const normalizedBanReason = normalizeOptionalText(
      requestedBannedReason ?? requestedRemark,
    );
    const bannedReason =
      status === 'BANNED' ? (normalizedBanReason ?? null) : null;
    const operatorStaffId =
      rechargeHistory.length > 0
        ? await this.membersAccessService.findOperatorStaffIdForStore(
            user,
            dto.storeId,
          )
        : null;

    const member = await this.prisma.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<MemberRecord[]>`
        INSERT INTO members (
          store_id,
          name,
          phone,
          gender,
          level,
          note,
          birthday,
          last_consume_at,
          points,
          total_points_earned,
          bean_balance,
          is_partner,
          partner_level,
          total_recharged,
          recharge_count,
          invited_count,
          banned_reason,
          status
        )
        VALUES (
          ${dto.storeId},
          ${dto.name.trim()},
          ${normalizedPhone ?? null},
          ${gender},
          ${level},
          ${note},
          ${this.toNullableDate(this.readOptionalString(payload, 'birthday'))},
          ${this.toNullableDate(this.readOptionalString(payload, 'lastActiveAt'))},
          ${points},
          ${totalPointsEarned},
          ${beanBalance},
          ${isPartner},
          ${partnerLevel},
          ${totalRecharged},
          ${rechargeCount},
          ${invitedCount},
          ${bannedReason},
          ${status}::"MemberStatus"
        )
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
      const createdMember = this.requireMemberRow(rows[0]);

      if (rechargeHistory.length > 0) {
        await this.replaceRechargeHistory(
          transaction,
          createdMember.id,
          createdMember.storeId,
          rechargeHistory,
          operatorStaffId,
        );
      }

      return createdMember;
    });

    return this.buildMemberResponse(member);
  }

  async list(
    user: AuthenticatedUser,
    query: ListMembersQueryDto,
  ): Promise<PaginatedMembersResponseDto> {
    const storeId = await this.resolveViewStoreId(
      user,
      query.storeId,
      '无权查看该门店会员列表',
    );

    if (storeId === null) {
      const { page: currentPage, take } = this.resolvePage(
        query.page,
        query.pageSize,
      );
      return {
        items: [],
        meta: buildPaginationMeta(0, currentPage, take),
      };
    }

    const {
      page: currentPage,
      skip,
      take,
    } = this.resolvePage(query.page, query.pageSize);
    const whereClause = this.buildListWhereClause(
      storeId,
      toDbMemberStatus(query.status),
      query.level,
      query.keyword,
    );

    const [items, countRows] = await Promise.all([
      this.prisma.$queryRaw<MemberRecord[]>`
        ${MEMBER_SELECT_SQL}
        WHERE ${whereClause}
        ORDER BY updated_at DESC, id DESC
        OFFSET ${skip}
        LIMIT ${take}
      `,
      this.prisma.$queryRaw<CountRow[]>`
        SELECT COUNT(*)::int AS count
        FROM members
        WHERE ${whereClause}
      `,
    ]);

    return {
      items: items.map((item) => toMemberResponse(item)),
      meta: buildPaginationMeta(countRows[0]?.count ?? 0, currentPage, take),
    };
  }

  async getMeta(
    user: AuthenticatedUser,
    query: MemberMetaQueryDto,
  ): Promise<MembersMetaResponseDto> {
    const storeId = await this.resolveViewStoreId(
      user,
      query.storeId,
      '无权查看该门店会员筛选项',
    );

    if (storeId === null) {
      return {
        levels: [],
        statuses: this.buildStatusMetaRows([]),
      };
    }

    const whereClause = this.buildStoreIdWhereClause(storeId);
    const [levelRows, statusRows] = await Promise.all([
      this.prisma.$queryRaw<MemberLevelMetaRow[]>`
        SELECT level AS value, COUNT(*)::int AS count
        FROM members
        WHERE ${whereClause}
        GROUP BY level
        ORDER BY count DESC, value ASC
      `,
      this.prisma.$queryRaw<MemberStatusMetaRow[]>`
        SELECT status AS value, COUNT(*)::int AS count
        FROM members
        WHERE ${whereClause}
        GROUP BY status
      `,
    ]);

    return {
      levels: this.buildLevelMetaRows(levelRows),
      statuses: this.buildStatusMetaRows(statusRows),
    };
  }

  async getOverview(
    user: AuthenticatedUser,
    query: MemberOverviewQueryDto,
  ): Promise<MembersOverviewResponseDto> {
    const storeId = await this.resolveViewStoreId(
      user,
      query.storeId,
      '无权查看该门店会员概览',
    );

    if (storeId === null) {
      return {
        totalCount: 0,
        activeCount: 0,
        partnerCount: 0,
        bannedCount: 0,
      };
    }

    const whereClause = this.buildStoreIdWhereClause(storeId);
    const rows = await this.prisma.$queryRaw<MemberOverviewRow[]>`
      SELECT
        COUNT(*)::int AS "totalCount",
        COUNT(*) FILTER (WHERE status = 'ACTIVE')::int AS "activeCount",
        COUNT(*) FILTER (WHERE is_partner = true)::int AS "partnerCount",
        COUNT(*) FILTER (WHERE status = 'BANNED')::int AS "bannedCount"
      FROM members
      WHERE ${whereClause}
    `;

    return (
      rows[0] ?? {
        totalCount: 0,
        activeCount: 0,
        partnerCount: 0,
        bannedCount: 0,
      }
    );
  }

  async listSnapshots(
    user: AuthenticatedUser,
    query: MemberSnapshotsQuery,
  ): Promise<MemberSnapshotDto[]> {
    const payload: Record<string, unknown> = {
      storeId: query.storeId,
      keyword: query.keyword,
      onlyPartners: query.onlyPartners,
    };
    const storeId = await this.resolveViewStoreId(
      user,
      this.readOptionalNumber(payload, 'storeId'),
      '无权查看该门店会员快照',
    );

    if (storeId === null) {
      return [];
    }

    const whereClause = this.buildSnapshotWhereClause(
      storeId,
      this.readOptionalString(payload, 'keyword'),
      this.readOptionalBoolean(payload, 'onlyPartners'),
    );
    const rows = await this.prisma.$queryRaw<MemberSnapshotRow[]>`
      SELECT
        id,
        name,
        phone,
        points,
        bean_balance AS "beanBalance",
        is_partner AS "isPartner"
      FROM members
      WHERE ${whereClause}
      ORDER BY is_partner DESC, updated_at DESC, id DESC
    `;

    return rows.map((row) => ({
      id: String(row.id),
      name: row.name,
      phone: row.phone ?? '',
      availablePoints: row.points,
      beanBalance: row.beanBalance,
      isPartner: row.isPartner,
    }));
  }

  async getDetail(
    user: AuthenticatedUser,
    memberId: number,
  ): Promise<MemberResponseDto> {
    const member = await this.membersAccessService.findManageableMemberOrThrow(
      user,
      memberId,
      'members:view',
    );
    return this.buildMemberResponse(member);
  }

  async update(
    user: AuthenticatedUser,
    memberId: number,
    dto: UpdateMemberDto,
  ): Promise<MemberResponseDto> {
    const existingMember =
      await this.membersAccessService.findManageableMemberOrThrow(
        user,
        memberId,
        'members:update',
      );
    const payload = this.toPayload(dto);
    const normalizedPhone = normalizePhone(
      this.readOptionalString(payload, 'phone'),
    );
    await this.ensurePhoneUnique(
      existingMember.storeId,
      normalizedPhone,
      existingMember.id,
    );

    const requestedStatus: ApiMemberStatus | undefined =
      this.readOptionalStatus(payload, 'status');
    const nextStatus = requestedStatus
      ? (toDbMemberStatus(requestedStatus) ?? existingMember.status)
      : existingMember.status;
    const requestedRemark = this.readOptionalString(payload, 'remark');
    const requestedBannedReason = this.readOptionalString(
      payload,
      'bannedReason',
    );
    const rechargeHistory = this.readRechargeHistory(payload);
    const nextPoints =
      this.readOptionalNumber(payload, 'availablePoints') ??
      existingMember.points;
    const requestedTotalPointsEarned =
      this.readOptionalNumber(payload, 'totalPointsEarned') ??
      existingMember.totalPointsEarned;
    const nextTotalPointsEarned = Math.max(
      requestedTotalPointsEarned,
      nextPoints,
      0,
    );
    const nextTotalRecharged =
      this.readOptionalNumber(payload, 'totalRecharged') ??
      (rechargeHistory
        ? this.sumRechargeAmounts(rechargeHistory)
        : existingMember.totalRecharged);
    const nextRechargeCount =
      this.readOptionalNumber(payload, 'rechargeCount') ??
      (rechargeHistory ? rechargeHistory.length : existingMember.rechargeCount);
    const nextBannedReason = this.resolveNextBannedReason(
      existingMember.status,
      existingMember.bannedReason,
      nextStatus,
      requestedBannedReason ??
        (nextStatus === 'BANNED' ? requestedRemark : undefined),
    );

    const updates: Prisma.Sql[] = [];

    if (dto.name !== undefined) {
      updates.push(Prisma.sql`name = ${dto.name.trim()}`);
    }
    if (dto.phone !== undefined) {
      updates.push(Prisma.sql`phone = ${normalizedPhone ?? null}`);
    }
    if (dto.gender !== undefined) {
      updates.push(Prisma.sql`gender = ${dto.gender}::"MemberGender"`);
    }
    if (dto.level !== undefined) {
      const level = this.readOptionalLevel(payload, 'level') ?? 'free';
      updates.push(Prisma.sql`level = ${level}`);
    }
    if (
      dto.remark !== undefined &&
      !(nextStatus === 'BANNED' && requestedBannedReason === undefined)
    ) {
      updates.push(
        Prisma.sql`note = ${normalizeOptionalText(requestedRemark) ?? null}`,
      );
    }
    if (dto.birthday !== undefined) {
      updates.push(
        Prisma.sql`birthday = ${this.toNullableDate(this.readOptionalString(payload, 'birthday'))}`,
      );
    }
    if (dto.lastActiveAt !== undefined) {
      updates.push(
        Prisma.sql`last_consume_at = ${this.toNullableDate(this.readOptionalString(payload, 'lastActiveAt'))}`,
      );
    }
    if (
      dto.availablePoints !== undefined ||
      dto.totalPointsEarned !== undefined
    ) {
      updates.push(Prisma.sql`points = ${nextPoints}`);
      updates.push(Prisma.sql`total_points_earned = ${nextTotalPointsEarned}`);
    }
    if (dto.beanBalance !== undefined) {
      updates.push(Prisma.sql`bean_balance = ${dto.beanBalance}`);
    }
    if (dto.isPartner !== undefined) {
      updates.push(Prisma.sql`is_partner = ${dto.isPartner}`);
      if (!dto.isPartner) {
        updates.push(Prisma.sql`partner_level = NULL`);
      }
    }
    if (dto.partnerLevel !== undefined) {
      const partnerLevel = this.readTrimmedString(payload, 'partnerLevel');
      updates.push(Prisma.sql`partner_level = ${partnerLevel ?? null}`);
    }
    if (dto.totalRecharged !== undefined || rechargeHistory !== undefined) {
      updates.push(Prisma.sql`total_recharged = ${nextTotalRecharged}`);
    }
    if (dto.rechargeCount !== undefined || rechargeHistory !== undefined) {
      updates.push(Prisma.sql`recharge_count = ${nextRechargeCount}`);
    }
    if (dto.invitedCount !== undefined) {
      updates.push(Prisma.sql`invited_count = ${dto.invitedCount}`);
    }
    if (dto.status !== undefined) {
      updates.push(Prisma.sql`status = ${nextStatus}::"MemberStatus"`);
    }
    if (dto.status !== undefined || dto.bannedReason !== undefined) {
      updates.push(Prisma.sql`banned_reason = ${nextBannedReason ?? null}`);
    }

    if (updates.length === 0 && rechargeHistory === undefined) {
      return this.buildMemberResponse(existingMember);
    }

    const operatorStaffId =
      rechargeHistory !== undefined
        ? await this.membersAccessService.findOperatorStaffIdForStore(
            user,
            existingMember.storeId,
          )
        : null;

    const member = await this.prisma.$transaction(async (transaction) => {
      const rows = updates.length
        ? await transaction.$queryRaw<MemberRecord[]>`
            UPDATE members
            SET ${Prisma.join(updates, ', ')},
                updated_at = NOW()
            WHERE id = ${existingMember.id}
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
          `
        : [existingMember];
      const updatedMember = this.requireMemberRow(rows[0]);

      if (rechargeHistory !== undefined) {
        await this.replaceRechargeHistory(
          transaction,
          updatedMember.id,
          updatedMember.storeId,
          rechargeHistory,
          operatorStaffId,
        );
      }

      return updatedMember;
    });

    return this.buildMemberResponse(member);
  }

  async remove(user: AuthenticatedUser, memberId: number): Promise<void> {
    const existingMember =
      await this.membersAccessService.findManageableMemberOrThrow(
        user,
        memberId,
        'members:update',
      );

    await this.prisma.$executeRaw`
      DELETE FROM members
      WHERE id = ${existingMember.id}
    `;
  }

  private resolveViewStoreId(
    user: AuthenticatedUser,
    storeId: number | undefined,
    forbiddenMessage: string,
  ): Promise<number | null> {
    return this.membersAccessService.resolveMembersViewStoreId(
      user,
      storeId,
      forbiddenMessage,
    );
  }

  private buildStoreIdWhereClause(storeId: number): Prisma.Sql {
    return Prisma.sql`store_id = ${storeId}`;
  }

  private buildListWhereClause(
    storeId: number,
    status: MemberStatusDb | undefined,
    level: string | undefined,
    keyword: string | undefined,
  ): Prisma.Sql {
    const filters: Prisma.Sql[] = [this.buildStoreIdWhereClause(storeId)];

    if (status) {
      filters.push(Prisma.sql`status = ${status}::"MemberStatus"`);
    }

    if (level) {
      filters.push(Prisma.sql`LOWER(level) = LOWER(${level})`);
    }

    if (keyword) {
      filters.push(
        Prisma.sql`(
          name ILIKE ${`%${keyword}%`}
          OR phone LIKE ${`%${keyword}%`}
        )`,
      );
    }

    return Prisma.join(filters, ' AND ');
  }

  private buildSnapshotWhereClause(
    storeId: number,
    keyword: string | undefined,
    onlyPartners: boolean | undefined,
  ): Prisma.Sql {
    const filters: Prisma.Sql[] = [this.buildStoreIdWhereClause(storeId)];

    if (onlyPartners) {
      filters.push(Prisma.sql`is_partner = true`);
    }

    if (keyword) {
      filters.push(
        Prisma.sql`(
          name ILIKE ${`%${keyword}%`}
          OR phone LIKE ${`%${keyword}%`}
        )`,
      );
    }

    return Prisma.join(filters, ' AND ');
  }

  private buildLevelMetaRows(
    rows: MemberLevelMetaRow[],
  ): Array<{ value: ApiMemberLevel; count: number }> {
    const countMap = new Map<ApiMemberLevel, number>([
      ['free', 0],
      ['monthly', 0],
      ['quarterly', 0],
      ['annual', 0],
    ]);

    for (const row of rows) {
      if (this.isMemberLevel(row.value)) {
        countMap.set(row.value, row.count);
      }
    }

    return Array.from(countMap.entries()).map(
      ([value, count]): { value: ApiMemberLevel; count: number } => ({
        value,
        count,
      }),
    );
  }

  private buildStatusMetaRows(
    rows: MemberStatusMetaRow[],
  ): Array<{ value: ApiMemberStatus; count: number }> {
    const countMap = new Map<ApiMemberStatus, number>([
      ['active', 0],
      ['inactive', 0],
      ['banned', 0],
    ]);

    for (const row of rows) {
      const value = toApiMemberStatus(row.value);
      countMap.set(value, row.count);
    }

    return Array.from(countMap.entries()).map(
      ([value, count]): { value: ApiMemberStatus; count: number } => ({
        value,
        count,
      }),
    );
  }

  private resolveNextBannedReason(
    previousStatus: MemberStatusDb,
    previousBannedReason: string | null,
    nextStatus: MemberStatusDb,
    requestedBannedReason: string | undefined,
  ): string | null {
    if (nextStatus !== 'BANNED') {
      return null;
    }

    if (requestedBannedReason !== undefined) {
      return normalizeOptionalText(requestedBannedReason) ?? null;
    }

    return previousStatus === 'BANNED' ? (previousBannedReason ?? null) : null;
  }

  private async ensurePhoneUnique(
    storeId: number,
    phone?: string,
    excludeMemberId?: number,
  ): Promise<void> {
    const existingMember = await this.prisma.member.findFirst({
      where: {
        storeId,
        phone,
        ...(excludeMemberId ? { id: { not: excludeMemberId } } : {}),
      },
      select: { id: true },
    });

    if (existingMember) {
      throw new ConflictException('该门店下会员手机号已存在');
    }
  }

  private async buildMemberResponse(
    member: MemberRecord,
  ): Promise<MemberResponseDto> {
    const rechargeRecords = await this.loadRechargeHistory(member.id);
    return toMemberResponse(member, rechargeRecords);
  }

  private async loadRechargeHistory(
    memberId: number,
  ): Promise<MemberRechargeRecord[]> {
    return await this.prisma.$queryRaw<MemberRechargeRecord[]>`
      SELECT
        id,
        plan_name AS "planName",
        amount,
        points_awarded AS "pointsAwarded",
        channel,
        created_at AS "createdAt"
      FROM member_recharge_logs
      WHERE member_id = ${memberId}
      ORDER BY created_at DESC, id DESC
    `;
  }

  private async replaceRechargeHistory(
    client: Prisma.TransactionClient,
    memberId: number,
    storeId: number,
    rechargeHistory: MemberRechargeRecordDto[],
    operatorStaffId: number | null,
  ): Promise<void> {
    await client.$executeRaw`
      DELETE FROM member_recharge_logs
      WHERE member_id = ${memberId}
    `;

    for (const record of rechargeHistory) {
      await client.$executeRaw`
        INSERT INTO member_recharge_logs (
          member_id,
          store_id,
          operator_staff_id,
          plan_name,
          amount,
          points_awarded,
          channel,
          created_at
        )
        VALUES (
          ${memberId},
          ${storeId},
          ${operatorStaffId},
          ${record.planName},
          ${record.amount},
          ${record.pointsAwarded},
          ${record.channel}::"MemberRechargeChannel",
          ${new Date(record.createdAt)}
        )
      `;
    }
  }

  private sumRechargeAmounts(
    rechargeHistory: MemberRechargeRecordDto[],
  ): number {
    return rechargeHistory.reduce((sum, record) => sum + record.amount, 0);
  }

  private readRechargeHistory(
    payload: Record<string, unknown>,
  ): MemberRechargeRecordDto[] | undefined {
    const value = payload.rechargeHistory;
    if (!Array.isArray(value)) {
      return undefined;
    }

    return value.flatMap((item): MemberRechargeRecordDto[] => {
      if (!item || typeof item !== 'object') {
        return [];
      }

      const record = item as Record<string, unknown>;
      const id = typeof record.id === 'string' ? record.id : '';
      const planName =
        typeof record.planName === 'string' ? record.planName : undefined;
      const amount =
        typeof record.amount === 'number' ? record.amount : undefined;
      const pointsAwarded =
        typeof record.pointsAwarded === 'number'
          ? record.pointsAwarded
          : undefined;
      const createdAt =
        typeof record.createdAt === 'number' ? record.createdAt : undefined;
      const channel =
        record.channel === 'wechat' ||
        record.channel === 'alipay' ||
        record.channel === 'card'
          ? record.channel
          : undefined;

      if (
        planName === undefined ||
        amount === undefined ||
        pointsAwarded === undefined ||
        createdAt === undefined ||
        channel === undefined
      ) {
        return [];
      }

      return [
        {
          id,
          planName,
          amount,
          pointsAwarded,
          channel,
          createdAt,
        },
      ];
    });
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

  private toPayload(dto: object): Record<string, unknown> {
    return dto as Record<string, unknown>;
  }

  private readOptionalString(
    payload: Record<string, unknown>,
    key: string,
  ): string | undefined {
    const value = payload[key];
    return typeof value === 'string' ? value : undefined;
  }

  private readTrimmedString(
    payload: Record<string, unknown>,
    key: string,
  ): string | undefined {
    const value = this.readOptionalString(payload, key);
    return value?.trim();
  }

  private readOptionalNumber(
    payload: Record<string, unknown>,
    key: string,
  ): number | undefined {
    const value = payload[key];
    return typeof value === 'number' ? value : undefined;
  }

  private readOptionalBoolean(
    payload: Record<string, unknown>,
    key: string,
  ): boolean | undefined {
    const value = payload[key];
    return typeof value === 'boolean' ? value : undefined;
  }

  private readOptionalStatus(
    payload: Record<string, unknown>,
    key: string,
  ): ApiMemberStatus | undefined {
    const value = this.readOptionalString(payload, key);
    if (value === 'active' || value === 'inactive' || value === 'banned') {
      return value;
    }

    return undefined;
  }

  private readOptionalLevel(
    payload: Record<string, unknown>,
    key: string,
  ): ApiMemberLevel | undefined {
    const value = this.readOptionalString(payload, key);
    return this.isMemberLevel(value) ? value : undefined;
  }

  private isMemberLevel(value: string | undefined): value is ApiMemberLevel {
    return (
      value === 'free' ||
      value === 'monthly' ||
      value === 'quarterly' ||
      value === 'annual'
    );
  }

  private readOptionalGender(
    payload: Record<string, unknown>,
    key: string,
  ): MemberGender | undefined {
    const value = this.readOptionalString(payload, key);
    if (value === 'UNKNOWN' || value === 'MALE' || value === 'FEMALE') {
      return value;
    }

    return undefined;
  }

  private toNullableDate(value?: string): Date | null {
    return value ? new Date(value) : null;
  }
}

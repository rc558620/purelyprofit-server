import { ConflictException, Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { PULSE_ADMIN_MEMBER_LOG_DEFAULT_LIMIT } from './dto/pulse-membership-admin-logs.shared.dto';
import type { GetPulseAdminMemberRecordsQueryDto } from './dto/pulse-membership-admin-member-records.request.dto';
import type { PulseAdminMemberRecordsResponseDto } from './dto/pulse-membership-admin-member-records.response.dto';
import { PulseMembershipAccessService } from './membership-access.service';
import { buildMemberRecordItems } from './membership-admin-member-records.builder';
import {
  encodeMemberRecordCursor,
  parseMemberRecordCursor,
} from './membership-admin-member-records.cursor';
import {
  fetchMemberRecordRows,
  resolveMemberRecordStoreIds,
} from './membership-admin-member-records.query';

const EMPTY_PAGE: PulseAdminMemberRecordsResponseDto = {
  items: [],
  hasMore: false,
  nextCursor: null,
};

/**
 * 会员记录管理：跨会员聚合四类记录的时间轴（游标分页）。
 *
 * 只做编排：门店权限 → 会员维度收敛 → 取数归并 → 截断 → 映射成 DTO。
 * 四类记录的取数与归并见 `membership-admin-member-records.query`，
 * 行 → DTO 的补齐见 `membership-admin-member-records.builder`。
 */
@Injectable()
export class PulseMembershipAdminMemberRecordsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessService: PulseMembershipAccessService,
  ) {}

  async listMemberRecords(
    user: AuthenticatedUser,
    query: GetPulseAdminMemberRecordsQueryDto,
  ): Promise<PulseAdminMemberRecordsResponseDto> {
    const storeIds = await this.accessService.resolveAdminMemberStoreIds(user);
    if (storeIds.length === 0) {
      return EMPTY_PAGE;
    }

    const cursor = parseMemberRecordCursor(query.cursor);
    if (query.cursor && !cursor) {
      throw new ConflictException('cursor 格式不合法');
    }

    const limit = query.limit ?? PULSE_ADMIN_MEMBER_LOG_DEFAULT_LIMIT;

    // 电话 / 姓名 / 等级都是会员（门店）维度的条件，先收敛成门店 id 集合，
    // 后面的四类查询统一用 storeId in (...) —— 改价审计表没有 store 关系，只能这么过滤
    const memberStoreIds = await resolveMemberRecordStoreIds(
      this.prisma,
      storeIds,
      query,
    );
    if (memberStoreIds.length === 0) {
      return EMPTY_PAGE;
    }

    const rows = await fetchMemberRecordRows(this.prisma, {
      storeIds: memberStoreIds,
      query,
      cursor,
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;

    return {
      items: await buildMemberRecordItems(this.prisma, pageRows),
      hasMore,
      nextCursor: hasMore
        ? encodeMemberRecordCursor(pageRows.at(-1) ?? null)
        : null,
    };
  }
}

import type { Prisma } from '@prisma/client';
import { Money } from '../../shared/money.utils';
import {
  buildDateRange,
  buildSingleDayRange,
} from '../dashboard/dashboard-time.utils';
import type { GetPulseAdminMemberRecordsQueryDto } from './dto/pulse-membership-admin-member-records.request.dto';
import {
  PULSE_ADMIN_MEMBER_RECORD_TYPE_VALUES,
  type PulseAdminMemberRecordTypeValue,
} from './dto/pulse-membership-admin-member-records.shared.dto';
import { buildAdminMemberLevelStoreWhere } from './membership-admin-store-where.utils';
import type { MemberRecordCreatedAtWhere } from './membership-admin-member-records.types';

/** 分（库存储单位）→ 元展示串；审计行缺列（旧数据 / 残行）时为 undefined，不能渲染成 NaN。 */
export function formatCents(cents: number | null | undefined): string | null {
  if (typeof cents !== 'number') {
    return null;
  }

  return Money.fromDbCents(cents).toFixedOutputYuan().replace(/\.00$/, '');
}

/** 类型筛选：all 时四类都查，否则只查选中的那一类。 */
export function resolveWantedTypes(
  type: GetPulseAdminMemberRecordsQueryDto['type'],
): Set<PulseAdminMemberRecordTypeValue> {
  if (!type || type === 'all') {
    return new Set(PULSE_ADMIN_MEMBER_RECORD_TYPE_VALUES);
  }

  return new Set([type]);
}

/**
 * 日期条件：单独日期优先于区间（前端保证两组互斥，这里再兜一层）。
 * 按上海时区取整天，区间两端都填时闭区间、早填晚填会自动互换。
 *
 * 只填一端是**开放区间**（「从这天起」/「到这天止」），不能退化成「这一天」：
 * 前端明确按开放区间提示（摘要写「不限 ~ 某天」），退化成单日会让
 * 「查 9 月以来的记录」查出一个空列表，运营会读成「这段时间真没记录」。
 */
export function resolveMemberRecordCreatedAtWhere(
  query: GetPulseAdminMemberRecordsQueryDto,
): MemberRecordCreatedAtWhere | null {
  if (query.date) {
    const range = buildSingleDayRange(query.date);
    return {
      createdAt: { gte: new Date(range.start), lte: new Date(range.end) },
    };
  }

  const { startDate, endDate } = query;

  if (startDate && endDate) {
    const range = buildDateRange(startDate, endDate);
    return {
      createdAt: { gte: new Date(range.start), lte: new Date(range.end) },
    };
  }

  if (startDate) {
    const range = buildSingleDayRange(startDate);
    return { createdAt: { gte: new Date(range.start) } };
  }

  if (endDate) {
    const range = buildSingleDayRange(endDate);
    return { createdAt: { lte: new Date(range.end) } };
  }

  return null;
}

/**
 * 会员维度的门店过滤条件（电话 / 姓名 / 等级）。
 *
 * 返回空数组表示「没有会员维度条件」——调用方直接复用权限门店集合，省一次往返。
 * 这些条件都收敛到门店维度，是因为改价审计表没有 store 关系，四类查询只能统一用
 * `storeId in (...)` 过滤。
 */
export function buildMemberRecordStoreFilters(
  query: GetPulseAdminMemberRecordsQueryDto,
): Prisma.StoreWhereInput[] {
  const phone = query.phone?.trim();
  const name = query.name?.trim();
  const filters: Prisma.StoreWhereInput[] = [];

  if (phone) {
    const normalizedPhone = phone.replace(/\s+/g, '');
    filters.push({
      OR: [
        { contactPhone: { contains: normalizedPhone } },
        { owner: { wechatPhone: { contains: normalizedPhone } } },
        {
          owner: {
            email: { contains: normalizedPhone, mode: 'insensitive' },
          },
        },
      ],
    });
  }

  if (name) {
    filters.push({
      OR: [
        { name: { contains: name, mode: 'insensitive' } },
        { owner: { name: { contains: name, mode: 'insensitive' } } },
        { owner: { realName: { contains: name, mode: 'insensitive' } } },
      ],
    });
  }

  const levelWhere = buildAdminMemberLevelStoreWhere({ level: query.level });
  if (levelWhere) {
    filters.push(levelWhere);
  }

  return filters;
}

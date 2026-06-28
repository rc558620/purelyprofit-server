import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { GetPulseAdminMemberLogsQueryDto } from './dto/pulse-membership-admin-logs.request.dto';
import { PULSE_ADMIN_MEMBER_LOG_DEFAULT_LIMIT } from './dto/pulse-membership-admin-logs.shared.dto';
import type { GetPulseAdminMembersQueryDto } from './dto/pulse-membership-admin-members.request.dto';
import type { PulseMemberListItemDto } from './dto/pulse-membership-admin-members.response.dto';
import type {
  PulseAdminMemberLevel,
  PulseAdminMembershipProfileRecord,
  PulseAdminStoreIdentityRecord,
} from './membership.types';

export type LegacyPulseAdminMembershipProfileRecord = Omit<
  PulseAdminMembershipProfileRecord,
  'subAccountQuota'
>;

export type PulseAdminMembershipProfileListRecord =
  PulseAdminMembershipProfileRecord & { storeId: number };

type AdminMemberLogsCursor = {
  createdAt: Date;
  id: number;
};

type AdminMemberLogsCursorPagination = {
  cursor?: AdminMemberLogsCursor;
  limit?: number;
};

export function resolveAdminMemberLogsCursorPagination(
  query: GetPulseAdminMemberLogsQueryDto,
): AdminMemberLogsCursorPagination {
  if (query.cursor === undefined && query.limit === undefined) {
    return {};
  }

  if (query.cursor === undefined) {
    return {
      limit: query.limit ?? PULSE_ADMIN_MEMBER_LOG_DEFAULT_LIMIT,
    };
  }

  const cursor = parseAdminMemberLogsCursor(query.cursor);
  if (!cursor) {
    throw new ConflictException('cursor 格式不合法');
  }

  return {
    cursor,
    limit: query.limit ?? PULSE_ADMIN_MEMBER_LOG_DEFAULT_LIMIT,
  };
}

export function encodeAdminMemberLogsCursor(
  log: Pick<AdminMemberLogsCursor, 'createdAt' | 'id'> | null,
): string | null {
  if (!log) {
    return null;
  }

  return `${log.createdAt.getTime()}_${log.id}`;
}

export function isMissingSubAccountQuotaSchemaError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message.toLowerCase()
      : String(error).toLowerCase();

  if (
    !message.includes('sub_account_quota') &&
    !message.includes('subaccountquota')
  ) {
    return false;
  }

  return (
    message.includes('does not exist') ||
    message.includes("doesn't exist") ||
    message.includes('unknown column') ||
    message.includes('no such column') ||
    message.includes('unknown field') ||
    message.includes('column')
  );
}

export function buildAdminMemberListStoreWhere(
  storeIds: number[],
  query: GetPulseAdminMembersQueryDto,
): Prisma.StoreWhereInput {
  // 始终过滤已注销（deletedAt 非 null）的门店，确保其不出现在会员列表中。
  const filters: Prisma.StoreWhereInput[] = [
    { id: { in: storeIds } },
    { deletedAt: null },
  ];

  if (query.partner === true) {
    filters.push({
      partners: {
        some: {
          status: 'approved',
        },
      },
    });
  }

  const levelWhere = buildAdminMemberLevelStoreWhere(query);
  if (levelWhere) {
    filters.push(levelWhere);
  }

  const statusWhere = buildAdminMemberStatusStoreWhere(query);
  if (statusWhere) {
    filters.push(statusWhere);
  }

  const expiryWhere = buildAdminMemberExpiryStoreWhere(query);
  if (expiryWhere) {
    filters.push(expiryWhere);
  }

  const keywordWhere = buildAdminMemberKeywordStoreWhere(query);
  if (keywordWhere) {
    filters.push(keywordWhere);
  }

  return filters.length === 1 ? filters[0] : { AND: filters };
}

export function matchesAdminMemberFilters(
  member: Pick<
    PulseMemberListItemDto,
    'name' | 'phone' | 'status' | 'level' | 'isPartner' | 'membershipExpiry'
  >,
  query: GetPulseAdminMembersQueryDto,
): boolean {
  if (
    query.status &&
    query.status !== 'all' &&
    member.status !== query.status
  ) {
    return false;
  }

  if (query.level && query.level !== 'all' && member.level !== query.level) {
    return false;
  }

  if (query.partner === true && !member.isPartner) {
    return false;
  }

  if (query.expiry && query.expiry !== 'all') {
    if (!shouldIncludeByExpiry(member.membershipExpiry, query.expiry)) {
      return false;
    }
  }

  const keyword = query.keyword?.trim().toLowerCase();
  if (!keyword) {
    return true;
  }

  return (
    member.name.toLowerCase().includes(keyword) ||
    member.phone.toLowerCase().includes(keyword)
  );
}

function shouldIncludeByExpiry(
  membershipExpiry: number | null | undefined,
  expiry: string,
): boolean {
  if (!membershipExpiry || membershipExpiry === null) {
    return false;
  }

  const now = Date.now();
  const dayMs = 86_400_000;
  let days = 0;

  switch (expiry) {
    case '1m':
      days = 30;
      break;
    case '3m':
      days = 90;
      break;
    case '6m':
      days = 180;
      break;
    case '1y':
      days = 365;
      break;
    case '2y':
      days = 730;
      break;
    default:
      return false;
  }

  // 精准过滤：到期时间 > 当前时间 且 <= 阈值时间
  const thresholdTime = now + days * dayMs;
  return membershipExpiry > now && membershipExpiry <= thresholdTime;
}

export function resolveAdminMemberDisplayName(
  store: Pick<PulseAdminStoreIdentityRecord, 'name' | 'owner'>,
): string {
  return store.owner.realName ?? store.owner.name ?? store.name;
}

export function resolveAdminMemberPhone(
  store: Pick<PulseAdminStoreIdentityRecord, 'contactPhone' | 'owner'>,
): string {
  // 1. 门店联系电话（用户手动填写的联系方式）
  const contactPhone = store.contactPhone?.trim();
  if (contactPhone) {
    return contactPhone;
  }

  // 2. 微信授权手机号（微信登录时自动获取的真实手机号）
  const wechatPhone = store.owner.wechatPhone?.trim();
  if (wechatPhone) {
    return wechatPhone;
  }

  // 3. 从 email 中提取手机号（占位邮箱格式：{profit|club}_phone_XXXXXXXXXXX@purelyprofit.local）
  const ownerEmail = store.owner.email.trim().toLowerCase();
  const matchedPhone = /(?:profit_|club_)?phone_(\d{11})@purelyprofit\.local$/.exec(ownerEmail);
  return matchedPhone?.[1] ?? '';
}

// maskAdminMemberPhone 已移除：purelyPulse 为商家管理后台，需完整展示用户手机号，不再脱敏。

/**
 * 将数据库中的会员计划ID + 过期时间映射为 Pulse 管理端的会员等级。
 *
 * ⚠️ 历史数据约定：早期 lifetime 会员在数据库中存储为
 * currentPlanId='yearly' + expiresAt=null。此函数通过此隐式约定
 * 识别 lifetime 会员。新创建的 lifetime 会员已使用 currentPlanId='lifetime'，
 * 不再依赖此约定。
 */
export function toPulseMemberLevel(
  planId: PulseAdminMembershipProfileRecord['currentPlanId'],
  expiresAt: Date | null,
): PulseAdminMemberLevel {
  // 历史数据兼容：yearly + null expiresAt = lifetime
  if (planId === 'yearly' && expiresAt === null) {
    return 'lifetime';
  }

  switch (planId) {
    case 'monthly':
      return 'monthly';
    case 'quarterly':
      return 'quarterly';
    case 'yearly':
      return 'annual';
    case 'lifetime':
      return 'lifetime';
    default:
      return 'free';
  }
}

function parseAdminMemberLogsCursor(
  cursor: string,
): AdminMemberLogsCursor | null {
  const match = /^(\d+)_(\d+)$/.exec(cursor);
  if (!match) {
    return null;
  }

  const [, rawCreatedAt, rawId] = match;
  const createdAtMs = Number(rawCreatedAt);
  const id = Number(rawId);
  if (
    !Number.isSafeInteger(createdAtMs) ||
    !Number.isSafeInteger(id) ||
    createdAtMs <= 0 ||
    id <= 0
  ) {
    return null;
  }

  return {
    createdAt: new Date(createdAtMs),
    id,
  };
}

function buildAdminMemberLevelStoreWhere(
  query: GetPulseAdminMembersQueryDto,
): Prisma.StoreWhereInput | null {
  switch (query.level) {
    case 'free':
      return {
        OR: [
          { membershipProfile: { is: null } },
          { membershipProfile: { is: { currentPlanId: null } } },
        ],
      };
    case 'monthly':
      return {
        membershipProfile: { is: { currentPlanId: 'monthly' } },
      };
    case 'quarterly':
      return {
        membershipProfile: { is: { currentPlanId: 'quarterly' } },
      };
    case 'annual':
      return {
        membershipProfile: {
          is: {
            currentPlanId: 'yearly',
            expiresAt: { not: null },
          },
        },
      };
    case 'lifetime':
      return {
        OR: [
          { membershipProfile: { is: { currentPlanId: 'lifetime' } } },
          {
            membershipProfile: {
              is: {
                currentPlanId: 'yearly',
                expiresAt: null,
              },
            },
          },
        ],
      };
    default:
      return null;
  }
}

function buildAdminMemberStatusStoreWhere(
  query: GetPulseAdminMembersQueryDto,
): Prisma.StoreWhereInput | null {
  const now = new Date();

  switch (query.status) {
    case 'active':
      return {
        membershipProfile: {
          is: {
            expiresAt: { gt: now },
          },
        },
      };
    case 'inactive':
      return {
        OR: [
          { membershipProfile: { is: null } },
          { membershipProfile: { is: { expiresAt: null } } },
          {
            membershipProfile: {
              is: {
                expiresAt: { lte: now },
              },
            },
          },
        ],
      };
    default:
      return null;
  }
}

function buildAdminMemberExpiryStoreWhere(
  query: GetPulseAdminMembersQueryDto,
): Prisma.StoreWhereInput | null {
  if (!query.expiry || query.expiry === 'all') {
    return null;
  }

  const now = new Date();
  const dayMs = 86_400_000;
  let days = 0;

  switch (query.expiry) {
    case '1m':
      days = 30;
      break;
    case '3m':
      days = 90;
      break;
    case '6m':
      days = 180;
      break;
    case '1y':
      days = 365;
      break;
    case '2y':
      days = 730;
      break;
    default:
      return null;
  }

  const thresholdDate = new Date(now.getTime() + days * dayMs);

  return {
    membershipProfile: {
      is: {
        AND: [
          // 会员到期时间在当前时间和阈值时间之间
          { expiresAt: { gt: now } },
          { expiresAt: { lte: thresholdDate } },
          // 排除 free（无计划）和 lifetime 会员，其余计划类型均参与到期筛选
          { currentPlanId: { not: null } },
          { currentPlanId: { not: 'lifetime' } },
        ],
      },
    },
  };
}

function buildAdminMemberKeywordStoreWhere(
  query: GetPulseAdminMembersQueryDto,
): Prisma.StoreWhereInput | null {
  const keyword = query.keyword?.trim();
  if (!keyword) {
    return null;
  }

  const normalizedPhoneKeyword = keyword.replace(/\s+/g, '');

  return {
    OR: [
      { name: { contains: keyword, mode: 'insensitive' } },
      { contactPhone: { contains: normalizedPhoneKeyword } },
      { owner: { name: { contains: keyword, mode: 'insensitive' } } },
      { owner: { realName: { contains: keyword, mode: 'insensitive' } } },
      {
        owner: {
          email: { contains: normalizedPhoneKeyword, mode: 'insensitive' },
        },
      },
    ],
  };
}

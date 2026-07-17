import type {
  PulseAdminMemberLevel,
  PulseAdminMembershipProfileRecord,
  PulseAdminStoreIdentityRecord,
} from './membership.types';
import type { PulseMemberListItemDto } from './dto/pulse-membership-admin-members.response.dto';
import type { GetPulseAdminMembersQueryDto } from './dto/pulse-membership-admin-members.request.dto';

// ─── Re-exports for backward compatibility ───────────────────────────────────
export {
  resolveAdminMemberLogsCursorPagination,
  encodeAdminMemberLogsCursor,
} from './membership-admin-cursor.utils';

export { buildAdminMemberListStoreWhere } from './membership-admin-store-where.utils';

// ─── Types ───────────────────────────────────────────────────────────────────

export type LegacyPulseAdminMembershipProfileRecord = Omit<
  PulseAdminMembershipProfileRecord,
  'subAccountQuota' | 'pulseSubAccountQuota'
>;

export type PulseAdminMembershipProfileListRecord =
  PulseAdminMembershipProfileRecord & { storeId: number };

// ─── Schema error detection ──────────────────────────────────────────────────

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

// ─── In-memory filter matching ───────────────────────────────────────────────

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

// ─── Identity resolvers ──────────────────────────────────────────────────────

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
  const matchedPhone =
    /(?:profit_|club_)?phone_(\d{11})@purelyprofit\.local$/.exec(ownerEmail);
  return matchedPhone?.[1] ?? '';
}

// maskAdminMemberPhone 已移除：purelyPulse 为商家管理后台，需完整展示用户手机号，不再脱敏。

// ─── Member level mapping ────────────────────────────────────────────────────

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

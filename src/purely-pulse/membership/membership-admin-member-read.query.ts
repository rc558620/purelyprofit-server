import type { PrismaExecutor } from '../../purely-profit/member/platform-membership/platform-membership.types';
import type { GetPulseAdminMembersQueryDto } from './dto/pulse-membership-admin-members.query.request.dto';
import {
  isMissingSubAccountQuotaSchemaError,
  loadAdminOperatorNames,
  type LegacyPulseAdminMembershipProfileRecord,
  type PulseAdminMembershipProfileListRecord,
} from './membership-admin-query.helper';
import { buildAdminMemberListStoreWhere } from './membership-admin-store-where.utils';
import type {
  PulseAdminMembershipOrderRecord,
  PulseAdminMembershipProfileRecord,
  PulseAdminPartnerRecord,
  PulseAdminStoreRecord,
  PulseAdminSubAccountQuotaAuditRecord,
} from './membership.types';
import type {
  PulseAdminPaidOrderSummaryGroup,
  PulseAdminRenewalPriceAuditRow,
} from './membership-admin-member-read.types';

/**
 * 会员读模型的取数层：只负责「把库里的行捞出来」，不做任何金额 / 展示口径的折算。
 *
 * 所有函数都以 `prisma` 为首参（事务 / 直连均可），便于在 service 里自由并发编排。
 */

/** 列表与详情共用的门店 + owner 身份字段（展示名 / 手机号 / 在线态都靠它）。 */
const ADMIN_MEMBER_STORE_SELECT = {
  id: true,
  name: true,
  contactPhone: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  owner: {
    select: {
      email: true,
      name: true,
      realName: true,
      avatar: true,
      wechatPhone: true,
      lastActiveAt: true,
    },
  },
} as const;

/** 子账号额度两列（sub_account_quota / pulse_sub_account_quota）尚未迁移时的字段集。 */
const LEGACY_ADMIN_MEMBERSHIP_PROFILE_SELECT = {
  currentPlanId: true,
  previousPlanId: true,
  startsAt: true,
  expiresAt: true,
  totalPoints: true,
  availablePoints: true,
} as const;

const ADMIN_MEMBERSHIP_PROFILE_SELECT = {
  ...LEGACY_ADMIN_MEMBERSHIP_PROFILE_SELECT,
  subAccountQuota: true,
  pulseSubAccountQuota: true,
} as const;

/** 子账号额度列缺失时的告警文案（统一在此，调用方只决定怎么记）。 */
const SUB_ACCOUNT_QUOTA_SCHEMA_FALLBACK_MESSAGES = {
  profile:
    '[pulse-membership-admin] store_membership_profiles.sub_account_quota schema not ready, fallback to legacy profile query',
  profileList:
    '[pulse-membership-admin] store_membership_profiles.sub_account_quota schema not ready, fallback to legacy profile list query',
} as const;

// ─── Stores ─────────────────────────────────────────────────────────────────

export async function fetchAdminMemberListStores(
  prisma: PrismaExecutor,
  storeIds: number[],
  query: GetPulseAdminMembersQueryDto,
): Promise<PulseAdminStoreRecord[]> {
  return prisma.store.findMany({
    where: buildAdminMemberListStoreWhere(storeIds, query),
    select: ADMIN_MEMBER_STORE_SELECT,
    orderBy: [{ id: 'asc' }],
  });
}

export async function fetchAdminMemberStore(
  prisma: PrismaExecutor,
  storeId: number,
): Promise<PulseAdminStoreRecord | null> {
  return prisma.store.findUnique({
    where: { id: storeId },
    select: ADMIN_MEMBER_STORE_SELECT,
  });
}

// ─── Membership profiles ────────────────────────────────────────────────────

/**
 * 单个门店的会员档案。
 *
 * 子账号额度两列是后加的：迁移未落地时 Prisma 会抛「列不存在」，
 * 此时回落成不含这两列的查询并把额度当成 0，保证读路径不被 schema 时序卡死。
 */
export async function fetchAdminMembershipProfile(
  prisma: PrismaExecutor,
  storeId: number,
  onLegacyFallback?: (message: string) => void,
): Promise<PulseAdminMembershipProfileRecord | null> {
  try {
    return await prisma.storeMembershipProfile.findUnique({
      where: { storeId },
      select: ADMIN_MEMBERSHIP_PROFILE_SELECT,
    });
  } catch (error: unknown) {
    if (!isMissingSubAccountQuotaSchemaError(error)) {
      throw error;
    }

    onLegacyFallback?.(SUB_ACCOUNT_QUOTA_SCHEMA_FALLBACK_MESSAGES.profile);

    const profile = await prisma.storeMembershipProfile.findUnique({
      where: { storeId },
      select: LEGACY_ADMIN_MEMBERSHIP_PROFILE_SELECT,
    });

    return profile
      ? {
          ...profile,
          subAccountQuota: 0,
          pulseSubAccountQuota: null,
        }
      : null;
  }
}

/** 批量版：与 `fetchAdminMembershipProfile` 同一套 schema 兼容策略。 */
export async function fetchAdminMembershipProfiles(
  prisma: PrismaExecutor,
  storeIds: number[],
  onLegacyFallback?: (message: string) => void,
): Promise<PulseAdminMembershipProfileListRecord[]> {
  try {
    return await prisma.storeMembershipProfile.findMany({
      where: { storeId: { in: storeIds } },
      select: { ...ADMIN_MEMBERSHIP_PROFILE_SELECT, storeId: true } as const,
    });
  } catch (error: unknown) {
    if (!isMissingSubAccountQuotaSchemaError(error)) {
      throw error;
    }

    onLegacyFallback?.(SUB_ACCOUNT_QUOTA_SCHEMA_FALLBACK_MESSAGES.profileList);

    const profiles = await prisma.storeMembershipProfile.findMany({
      where: { storeId: { in: storeIds } },
      select: {
        ...LEGACY_ADMIN_MEMBERSHIP_PROFILE_SELECT,
        storeId: true,
      } as const,
    });

    return profiles.map(
      (profile): PulseAdminMembershipProfileListRecord => ({
        ...(profile as LegacyPulseAdminMembershipProfileRecord & {
          storeId: number;
        }),
        subAccountQuota: 0,
        pulseSubAccountQuota: null,
      }),
    );
  }
}

// ─── Orders / partners ──────────────────────────────────────────────────────

/**
 * 会员订单（含后台设置记录）。
 *
 * 取出 `paymentChannel` 后交给 builder 按渠道拆成两组：
 * - wechat：商家端充值 → 「充值记录」
 * - admin / gift：管理端设置会员等级 → 「设置会员等级记录」（gift 显示「赠送」）
 */
export async function fetchAdminPaidOrders(
  prisma: PrismaExecutor,
  storeId: number,
): Promise<PulseAdminMembershipOrderRecord[]> {
  return prisma.storeMembershipOrder.findMany({
    where: { storeId, status: 'paid' },
    select: {
      id: true,
      planId: true,
      planName: true,
      amount: true,
      paymentChannel: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
}

/** 列表用：按门店聚合商家端充值（次数 / 总额 / 最近一次）。 */
export async function groupAdminPaidOrderSummaries(
  prisma: PrismaExecutor,
  storeIds: number[],
): Promise<PulseAdminPaidOrderSummaryGroup[]> {
  const summaries = await prisma.storeMembershipOrder.groupBy({
    by: ['storeId'],
    where: {
      storeId: { in: storeIds },
      status: 'paid',
      // 只统计商家端真实充值：后台设置会员等级（admin / gift）单独成组展示，
      // 不能虚增列表的「充值次数 / 累计充值」
      paymentChannel: 'wechat',
    },
    _count: { _all: true },
    _sum: { amount: true },
    _max: { createdAt: true },
  });

  return summaries;
}

export async function fetchAdminApprovedPartner(
  prisma: PrismaExecutor,
  storeId: number,
): Promise<PulseAdminPartnerRecord | null> {
  return prisma.storePartner.findFirst({
    where: { storeId, deletedAt: null, status: 'approved' },
    select: {
      id: true,
      beanBalance: true,
      status: true,
      totalEarnedBeans: true,
      totalWithdrawnBeans: true,
    },
    orderBy: [{ reviewedAt: 'desc' }, { joinedAt: 'desc' }, { id: 'desc' }],
  });
}

/** 列表用：每家门店只保留一条已通过的合伙人记录（按审核 / 加入时间取最新）。 */
export async function fetchAdminApprovedPartners(
  prisma: PrismaExecutor,
  storeIds: number[],
): Promise<Array<PulseAdminPartnerRecord & { storeId: number }>> {
  return prisma.storePartner.findMany({
    where: {
      storeId: { in: storeIds },
      deletedAt: null,
      status: 'approved',
    },
    select: {
      storeId: true,
      id: true,
      status: true,
      beanBalance: true,
      totalEarnedBeans: true,
      totalWithdrawnBeans: true,
    },
    orderBy: [
      { storeId: 'asc' },
      { reviewedAt: 'desc' },
      { joinedAt: 'desc' },
      { id: 'desc' },
    ],
  });
}

export async function countAdminPromoRecords(
  prisma: PrismaExecutor,
  storeId: number,
): Promise<number> {
  return prisma.storeMembershipPromoRecord.count({
    where: { storeId },
  });
}

// ─── Audits ─────────────────────────────────────────────────────────────────

/** 调整续费价审计（新→旧）；只存 planId，档位名由套餐目录补全。 */
export async function fetchAdminRenewalPriceAuditRows(
  prisma: PrismaExecutor,
  storeId: number,
): Promise<PulseAdminRenewalPriceAuditRow[]> {
  return prisma.storeMembershipPriceOverrideAudit.findMany({
    where: { storeId },
    select: {
      id: true,
      planId: true,
      oldPrice: true,
      newPrice: true,
      operatorName: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
}

/**
 * 子账号额度变更审计（新→旧）。
 *
 * 审计行只有 `operatorUserId`：用户改名后历史行会跟着变，但至少比显示一串 id 强；
 * 查不到用户（已注销 / 早期数据）时回落 null，前端按「平台操作」兜底展示。
 */
export async function fetchAdminSubAccountQuotaAudits(
  prisma: PrismaExecutor,
  storeId: number,
): Promise<PulseAdminSubAccountQuotaAuditRecord[]> {
  const rows = await prisma.storeSubAccountQuotaAudit.findMany({
    where: { storeId },
    select: {
      id: true,
      oldQuota: true,
      newQuota: true,
      operatorUserId: true,
      reason: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });

  const operatorIds = [
    ...new Set(
      rows
        .map((row) => row.operatorUserId)
        .filter((id): id is number => typeof id === 'number'),
    ),
  ];
  // 空 id 集合不查库：既省一次往返，也避免 mock 环境下多打一枪
  const nameById =
    operatorIds.length === 0
      ? new Map<number, string>()
      : await loadAdminOperatorNames(prisma, operatorIds);

  return rows.map((row) => ({
    id: row.id,
    oldQuota: row.oldQuota,
    newQuota: row.newQuota,
    operatorName:
      typeof row.operatorUserId === 'number'
        ? (nameById.get(row.operatorUserId) ?? null)
        : null,
    reason: row.reason,
    createdAt: row.createdAt,
  }));
}

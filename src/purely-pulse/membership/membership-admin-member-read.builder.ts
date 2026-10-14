import type { MembershipPlanConfig } from '../../purely-profit/member/platform-membership/platform-membership.types';
import { Money } from '../../shared/money.utils';
import type { PulseAdminMembershipProfileListRecord } from './membership-admin-query.helper';
import type {
  PulseAdminMemberDetailRawData,
  PulseAdminMemberDetailSnapshot,
  PulseAdminMemberListDependencies,
  PulseAdminPaidOrderSummaryGroup,
  PulseAdminRenewalPriceAuditRow,
} from './membership-admin-member-read.types';
import type {
  PulseAdminMemberOrderSummary,
  PulseAdminPartnerRecord,
  PulseAdminRenewalPriceAdjustRecord,
} from './membership.types';

/**
 * 会员读模型的装配层：把取数层拿到的行折成 builder 直接能吃的形态。
 *
 * 全部是纯函数（不碰库、不计时），金额一律过 `Money` 折算，便于单独测。
 */

export interface PulseAdminMemberListDependencyInput {
  profiles: PulseAdminMembershipProfileListRecord[];
  paidOrderSummaries: PulseAdminPaidOrderSummaryGroup[];
  partners: Array<PulseAdminPartnerRecord & { storeId: number }>;
  banReasons: Map<number, string>;
}

/** 列表依赖：四份门店维度数据各自按 storeId 建成索引，供逐行装配 O(1) 取用。 */
export function buildAdminMemberListDependencies(
  input: PulseAdminMemberListDependencyInput,
): PulseAdminMemberListDependencies {
  const { profiles, paidOrderSummaries, partners, banReasons } = input;

  return {
    profileByStoreId: new Map(
      profiles.map((profile) => [profile.storeId, profile]),
    ),
    orderSummaryByStoreId: buildOrderSummaryByStoreId(paidOrderSummaries),
    partnerByStoreId: buildPartnerByStoreId(partners),
    banReasons,
  };
}

export function buildOrderSummaryByStoreId(
  paidOrderSummaries: PulseAdminPaidOrderSummaryGroup[],
): Map<number, PulseAdminMemberOrderSummary> {
  return new Map(
    paidOrderSummaries.map((summary) => [
      summary.storeId,
      {
        rechargeCount: summary._count._all,
        totalRecharged: Money.fromDbCents(summary._sum.amount ?? 0).toDbCents(),
        lastPaidAt: summary._max.createdAt?.getTime() ?? null,
      },
    ]),
  );
}

/** 一家门店只认一条合伙人记录：查询已按审核 / 加入时间倒序，取首条即可。 */
export function buildPartnerByStoreId(
  partners: Array<PulseAdminPartnerRecord & { storeId: number }>,
): Map<number, PulseAdminPartnerRecord> {
  const partnerByStoreId = new Map<number, PulseAdminPartnerRecord>();
  for (const partner of partners) {
    if (!partnerByStoreId.has(partner.storeId)) {
      partnerByStoreId.set(partner.storeId, {
        id: partner.id,
        status: partner.status,
        beanBalance: partner.beanBalance,
        totalEarnedBeans: partner.totalEarnedBeans,
        totalWithdrawnBeans: partner.totalWithdrawnBeans,
      });
    }
  }

  return partnerByStoreId;
}

/** 把原始材料折成详情 builder 的入参（档位名 / 配置价在此补齐）。 */
export function buildAdminMemberDetailSnapshot(
  raw: PulseAdminMemberDetailRawData,
): PulseAdminMemberDetailSnapshot {
  const {
    store,
    profile,
    paidOrders,
    partner,
    promoCount,
    subAccountSummary,
    lockedPrices,
    planCatalog,
    renewalPriceAuditRows,
    subAccountQuotaAudits,
    banReason,
  } = raw;

  return {
    store,
    profile,
    paidOrders,
    partner,
    promoCount,
    subAccountSummary,
    lockedPrices,
    renewalPriceAdjustments: buildRenewalPriceAdjustments(
      renewalPriceAuditRows,
      planCatalog,
    ),
    subAccountQuotaAudits,
    planPrices: buildPlanPriceByPlanId(planCatalog),
    banReason,
  };
}

/**
 * 调整续费价审计 → 详情行：补上档位展示名。
 *
 * 审计行只存 planId，目录里查不到（档位已下架）时回落成 planId，至少不丢这条痕。
 */
export function buildRenewalPriceAdjustments(
  rows: PulseAdminRenewalPriceAuditRow[],
  planCatalog: MembershipPlanConfig[],
): PulseAdminRenewalPriceAdjustRecord[] {
  const planNameById = buildPlanNameByPlanId(planCatalog);

  return rows.map((row) => ({
    id: row.id,
    planId: row.planId,
    planName: planNameById.get(row.planId) ?? row.planId,
    oldPrice: row.oldPrice,
    newPrice: row.newPrice,
    operatorName: row.operatorName,
    createdAt: row.createdAt,
  }));
}

export function buildPlanNameByPlanId(
  planCatalog: MembershipPlanConfig[],
): Map<string, string> {
  return new Map(planCatalog.map((plan) => [plan.id, plan.name]));
}

/** 各档位当前配置价（分）：折算「配置价 + 子账号加价 = 续费价」用。 */
export function buildPlanPriceByPlanId(
  planCatalog: MembershipPlanConfig[],
): Map<string, number> {
  return new Map(planCatalog.map((plan) => [plan.id, plan.price]));
}

import type { MembershipPlanCycle } from '@prisma/client';
import type { MembershipPlanConfig } from '../../purely-profit/member/platform-membership/platform-membership.types';
import type { LockedPriceSnapshot } from '../../purely-profit/member/platform-membership/store-membership-locked-price.service';
import type {
  PulseAdminMemberOrderSummary,
  PulseAdminMembershipOrderRecord,
  PulseAdminMembershipProfileRecord,
  PulseAdminPartnerRecord,
  PulseAdminRenewalPriceAdjustRecord,
  PulseAdminStoreRecord,
  PulseAdminSubAccountDetail,
  PulseAdminSubAccountQuotaAuditRecord,
} from './membership.types';

/**
 * `storeMembershipOrder.groupBy` 的充值聚合行。
 *
 * 只统计商家端（wechat）已支付订单：后台设置会员等级（admin / gift）是平台侧
 * 动作，不能虚增列表的「充值次数 / 累计充值」。
 */
export type PulseAdminPaidOrderSummaryGroup = {
  storeId: number;
  _count: { _all: number };
  _sum: { amount: number | null };
  _max: { createdAt: Date | null };
};

/** 列表装配所需的门店维度依赖，一律按 storeId 索引。 */
export type PulseAdminMemberListDependencies = {
  profileByStoreId: Map<number, PulseAdminMembershipProfileRecord>;
  orderSummaryByStoreId: Map<number, PulseAdminMemberOrderSummary>;
  partnerByStoreId: Map<number, PulseAdminPartnerRecord>;
  banReasons: Map<number, string>;
};

/** 调整续费价审计原始行（`store_membership_price_override_audits`）。 */
export type PulseAdminRenewalPriceAuditRow = {
  id: number;
  planId: MembershipPlanCycle;
  oldPrice: number | null;
  newPrice: number | null;
  operatorName: string | null;
  createdAt: Date;
};

/** 详情页一次 `Promise.all` 取回的原始材料，尚未折算成 builder 入参。 */
export interface PulseAdminMemberDetailRawData {
  store: PulseAdminStoreRecord;
  profile: PulseAdminMembershipProfileRecord | null;
  paidOrders: PulseAdminMembershipOrderRecord[];
  partner: PulseAdminPartnerRecord | null;
  promoCount: number;
  subAccountSummary: PulseAdminSubAccountDetail;
  lockedPrices: LockedPriceSnapshot[];
  /** 套餐目录：既提供档位展示名，也提供各档位当前配置价 */
  planCatalog: MembershipPlanConfig[];
  renewalPriceAuditRows: PulseAdminRenewalPriceAuditRow[];
  subAccountQuotaAudits: PulseAdminSubAccountQuotaAuditRecord[];
  banReason: string | null;
}

/** 详情页 builder 的最终入参（由 `buildAdminMemberDetailSnapshot` 产出）。 */
export interface PulseAdminMemberDetailSnapshot {
  store: PulseAdminStoreRecord;
  profile: PulseAdminMembershipProfileRecord | null;
  paidOrders: PulseAdminMembershipOrderRecord[];
  partner: PulseAdminPartnerRecord | null;
  promoCount: number;
  subAccountSummary: PulseAdminSubAccountDetail;
  lockedPrices: LockedPriceSnapshot[];
  /** 调整续费价格审计（新→旧排序）：详情页「调整续费记录」tab 的数据源 */
  renewalPriceAdjustments: PulseAdminRenewalPriceAdjustRecord[];
  /** 子账号额度变更审计（新→旧排序）：详情页「子账号设置记录」tab 的数据源 */
  subAccountQuotaAudits: PulseAdminSubAccountQuotaAuditRecord[];
  /** 各档位当前配置价（分）：供 builder 折算「配置价 + 子账号加价 = 续费价」 */
  planPrices: Map<string, number>;
  banReason: string | null;
}

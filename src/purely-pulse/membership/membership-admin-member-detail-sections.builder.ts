import { resolveRenewalPriceFen } from '../../purely-profit/member/platform-membership/platform-membership.constants';
import type { LockedPriceSnapshot } from '../../purely-profit/member/platform-membership/store-membership-locked-price.service';
import { Money } from '../../shared/money.utils';
import type { PulseMemberDetailDto } from './dto/pulse-membership-admin-member-detail.response.dto';
import {
  formatAdminMemberFenDisplay,
  formatAdminMemberFenDisplayOrNull,
} from './membership-admin-money.utils';
import { PURCHASE_BONUS_POINTS } from './membership.constants';
import type {
  PulseAdminMembershipOrderRecord,
  PulseAdminRenewalPriceAdjustRecord,
  PulseAdminSubAccountDetail,
  PulseAdminSubAccountQuotaAuditRecord,
} from './membership.types';

/**
 * 会员详情各分区（成交记录 / 续费改价 / 子账号 / 锁定价）的行 → DTO 映射。
 *
 * 从 `membership-admin-member-detail.builder` 抽出的纯映射，只负责单个分区，
 * 不参与「取哪些数据」的编排，便于单测每个 Tab 的口径。
 */

type PulseRechargeRecordDto = PulseMemberDetailDto['rechargeHistory'][number];
type PulseRenewalPriceAdjustDto =
  PulseMemberDetailDto['renewalPriceAdjustHistory'][number];
type PulseSubAccountQuotaRecordDto =
  PulseMemberDetailDto['subAccountQuotaRecordHistory'][number];
type PulseLockedPriceDto = PulseMemberDetailDto['lockedPrices'][number];
type PulseSubAccountSlotDto = PulseMemberDetailDto['subAccountSlots'][number];
type PulseSubAccountRoleSummaryDto =
  PulseMemberDetailDto['subAccountRoleSummary'][number];
type PulseSubAccountCapabilityDto =
  PulseMemberDetailDto['subAccountCapability'];

/** 子账号相关字段：详情里扁平展示 + 嵌套能力结构共用同一份数据 */
export type PulseDetailSubAccountFields = Pick<
  PulseMemberDetailDto,
  | 'subAccountEligible'
  | 'subAccountQuota'
  | 'subAccountCapabilityEnabled'
  | 'subAccountQuotaMax'
  | 'subAccountsUsedCount'
  | 'subAccountsAvailableCount'
  | 'subAccountRoleSummary'
  | 'subAccountSlots'
  | 'subAccountCapability'
>;

// ─── 成交记录 ────────────────────────────────────────────────────────────────

/** 「充值记录」：商家端微信充值，积分按档位赠送表计算 */
export function buildRechargeHistoryItems(
  rechargeOrders: PulseAdminMembershipOrderRecord[],
): PulseRechargeRecordDto[] {
  return rechargeOrders.map((order) => ({
    id: String(order.id),
    planName: order.planName,
    amount: Money.fromDbCents(order.amount).toDbCents(),
    amountDisplay: formatAdminMemberFenDisplay(order.amount),
    pointsAwarded: PURCHASE_BONUS_POINTS[order.planId] ?? 0,
    channel: 'wechat' as const,
    createdAt: order.createdAt.getTime(),
  }));
}

/** 「设置会员等级记录」：admin=勾选了计入收入（显示金额）；gift=赠送（显示「赠送」） */
export function buildAdminGrantHistoryItems(
  adminGrantOrders: PulseAdminMembershipOrderRecord[],
): PulseRechargeRecordDto[] {
  return adminGrantOrders.map((order) => ({
    id: String(order.id),
    planName: order.planName,
    amount: Money.fromDbCents(order.amount).toDbCents(),
    amountDisplay:
      order.paymentChannel === 'gift'
        ? '赠送'
        : formatAdminMemberFenDisplay(order.amount),
    pointsAwarded: 0,
    channel:
      order.paymentChannel === 'gift' ? ('gift' as const) : ('admin' as const),
    createdAt: order.createdAt.getTime(),
  }));
}

// ─── 续费改价 ────────────────────────────────────────────────────────────────

/**
 * 「调整续费记录」：与「设置会员等级记录」严格分工——那条是一次成交，
 * 这条是运营为**未来每次续费**议定的基础价，改价留痕单独成 tab。
 */
export function buildRenewalPriceAdjustHistoryItems(
  renewalPriceAdjustments: PulseAdminRenewalPriceAdjustRecord[],
): PulseRenewalPriceAdjustDto[] {
  return renewalPriceAdjustments.map((audit) => ({
    id: String(audit.id),
    planId: audit.planId,
    planName: audit.planName,
    // 缺列（旧数据 / mock 残行）时值为 undefined，必须保持 null 而不是 NaN
    oldPriceDisplay: formatAdminMemberFenDisplayOrNull(audit.oldPrice),
    newPriceDisplay: formatAdminMemberFenDisplayOrNull(audit.newPrice),
    operatorName: audit.operatorName,
    createdAt: audit.createdAt.getTime(),
  }));
}

// ─── 子账号额度留痕 ──────────────────────────────────────────────────────────

/**
 * 「子账号设置记录」：只覆盖额度数值变更（newQuota=0 即关闭子账号），
 * 槽位角色 / 状态 / 分配员工的改动没有审计，不在本列表里。
 */
export function buildSubAccountQuotaHistoryItems(
  subAccountQuotaAudits: PulseAdminSubAccountQuotaAuditRecord[],
): PulseSubAccountQuotaRecordDto[] {
  return subAccountQuotaAudits.map((audit) => ({
    id: String(audit.id),
    oldQuota: audit.oldQuota,
    newQuota: audit.newQuota,
    operatorName: audit.operatorName,
    reason: audit.reason,
    createdAt: audit.createdAt.getTime(),
  }));
}

// ─── 成交价快照 ──────────────────────────────────────────────────────────────

/**
 * 成交价快照：让运营看得到「当前是什么价、子账号加价补录了没有」，
 * 而不只是一个重置按钮。subAccountAmountDisplay 为 null 即提示需要补录。
 */
export function buildLockedPriceItems(
  lockedPrices: LockedPriceSnapshot[],
  planPrices: Map<string, number>,
): PulseLockedPriceDto[] {
  return lockedPrices.map((item) => buildLockedPriceItem(item, planPrices));
}

function buildLockedPriceItem(
  item: LockedPriceSnapshot,
  planPrices: Map<string, number>,
): PulseLockedPriceDto {
  return {
    planId: item.planId,
    price: item.price,
    priceDisplay: formatAdminMemberFenDisplay(item.price),
    subAccountAmountDisplay: formatAdminMemberFenDisplayOrNull(
      item.subAccountAmount,
    ),
    subAccountCount:
      typeof item.subAccountCount === 'number' ? item.subAccountCount : null,
    // 该档位被「调整续费价格」覆盖过的基础价；null = 未覆盖
    renewalPriceOverrideDisplay: formatAdminMemberFenDisplayOrNull(
      item.renewalPriceOverride,
    ),
    renewalPriceDisplay: buildLockedPriceRenewalDisplay(item, planPrices),
    source: item.source,
    lockedAt: item.lockedAt.getTime(),
  };
}

/**
 * 续费价 = max(当前配置价, 议定价) + 子账号加价，仅在「录了加价」或
 * 「有议定价」时下发，供管理端快照展示「加价 ¥100 = ¥498」。
 *
 * ⚠️ 必须走 resolveRenewalPriceFen 而不是手抄公式：子账号加价只对
 * 年 / 永久档位生效，月 / 季带上它就会显示一个客户永远付不到的价格。
 */
function buildLockedPriceRenewalDisplay(
  item: LockedPriceSnapshot,
  planPrices: Map<string, number>,
): string | null {
  const hasSubAccountAmount = typeof item.subAccountAmount === 'number';
  const hasOverride = typeof item.renewalPriceOverride === 'number';

  if (!planPrices.has(item.planId) || (!hasSubAccountAmount && !hasOverride)) {
    return null;
  }

  return formatAdminMemberFenDisplay(
    resolveRenewalPriceFen({
      planId: item.planId,
      configPrice: planPrices.get(item.planId) ?? 0,
      overridePrice: item.renewalPriceOverride,
      subAccountAmount: item.subAccountAmount,
    }),
  );
}

// ─── 子账号能力 ──────────────────────────────────────────────────────────────

/** 子账号扁平字段 + 对齐前端 MemberDetail.subAccountCapability 的嵌套结构 */
export function buildSubAccountFields(
  summary: PulseAdminSubAccountDetail,
): PulseDetailSubAccountFields {
  return {
    subAccountEligible: summary.eligible,
    subAccountQuota: summary.quota,
    subAccountCapabilityEnabled: summary.enabled,
    subAccountQuotaMax: summary.quotaMax,
    subAccountsUsedCount: summary.usedCount,
    subAccountsAvailableCount: summary.availableCount,
    subAccountRoleSummary: buildSubAccountRoleSummary(summary.roleSummary),
    subAccountSlots: summary.slots.map(toSubAccountSlot),
    subAccountCapability: buildSubAccountCapability(summary),
  };
}

function buildSubAccountRoleSummary(
  roleSummary: PulseAdminSubAccountDetail['roleSummary'],
): PulseSubAccountRoleSummaryDto[] {
  return roleSummary.map((item) => ({
    role: item.role as 'cashier' | 'finance' | 'manager',
    activeCount: item.activeCount,
    inactiveCount: item.inactiveCount,
    disabledCount: item.disabledCount,
    assignedCount: item.assignedCount,
  }));
}

function toSubAccountSlot(
  slot: PulseAdminSubAccountDetail['slots'][number],
): PulseSubAccountSlotDto {
  return {
    id: String(slot.id),
    slotIndex: slot.slotIndex,
    role: slot.role as 'cashier' | 'finance' | 'manager',
    status: slot.status as 'active' | 'inactive' | 'disabled',
    isAssigned: slot.isAssigned,
    employeeId: slot.employeeId ? String(slot.employeeId) : null,
    employeeName: slot.employeeName,
    canAccessHome: slot.canAccessHome,
    canUseHandover: slot.canUseHandover,
  };
}

/** 嵌套能力结构：槽位按 slot 序号逐条列，供前端「子账号能力」卡片直接渲染 */
function buildSubAccountCapability(
  summary: PulseAdminSubAccountDetail,
): PulseSubAccountCapabilityDto {
  return {
    subAccountQuota: summary.quota,
    subAccountEligible: summary.eligible,
    subAccountCapabilityEnabled: summary.enabled,
    subAccountQuotaMax: summary.quotaMax,
    subAccountsUsedCount: summary.usedCount,
    subAccountsAvailableCount: summary.availableCount,
    subAccountRoleSummary: summary.slots.map((slot) => ({
      slot: slot.slotIndex,
      role: slot.role as 'cashier' | 'finance' | 'manager',
      status: slot.status as 'active' | 'inactive' | 'disabled',
      isAssigned: slot.isAssigned,
    })),
  };
}

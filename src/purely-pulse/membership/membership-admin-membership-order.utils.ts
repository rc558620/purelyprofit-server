import { isSubAccountPricingPlan } from '../../purely-profit/member/platform-membership/platform-membership.constants';
import {
  resolveAmountFen,
  resolvePriceFen,
} from './membership-admin-money.utils';
import type {
  PulseAdminMemberLevel,
  PulseMembershipPlanId,
} from './membership.types';

/** 订单渠道：admin=计入收入，gift=赠送 */
export type AdminMembershipOrderChannel = 'admin' | 'gift';

/**
 * 计算管理端「设置会员等级」订单的金额与渠道。
 *
 * - 勾选计入收入：金额取成交价（解析不出则回落所选档位配置价），渠道 admin；
 * - 否则按赠送处理：金额 0，渠道 gift。
 *
 * 关键护栏：填了价却解析不出（'0' / 非法串）或配置价为 0 时**绝不回落配置价**，
 * 而是退回赠送——0 元落一笔 paid/admin 只会虚增成交笔数、营收一分没涨。
 */
export function resolveAdminMembershipOrderAmount(params: {
  /** 所选档位的配置价（分） */
  planPrice: number;
  /** 运营填的成交价展示值（元字符串），未填则回落配置价 */
  priceDisplay?: string;
  /** 是否计入收入 */
  countAsIncome: boolean;
}): {
  amount: number;
  paymentChannel: AdminMembershipOrderChannel;
  isIncome: boolean;
  /** 勾了「计入收入」但系统算不出金额，被按赠送处理 */
  forcedGift: boolean;
} {
  const hasPriceInput =
    typeof params.priceDisplay === 'string' &&
    params.priceDisplay.trim() !== '';
  const requestedAmount = hasPriceInput
    ? resolvePriceFen(params.priceDisplay)
    : params.planPrice;
  // 算不出来钱（填了 0、配置价为 0 等异常）却仍勾了「计入收入」：退回赠送处理
  const isIncome =
    params.countAsIncome && requestedAmount !== null && requestedAmount > 0;
  const amount = isIncome ? (requestedAmount as number) : 0;

  return {
    amount,
    paymentChannel: isIncome ? 'admin' : 'gift',
    isIncome,
    forcedGift: params.countAsIncome && !isIncome,
  };
}

/**
 * 构建管理端「设置会员等级」的成交价快照参数（不含事务执行器）。
 *
 * 仅对年 / 永久档位写入子账号分量；未录入字段 / 数量为 0 都不写，避免污染快照。
 * 价格解析不出（缺失 / 非法）时返回 null，表示本次不落成交价快照。
 */
export function buildDealPriceSnapshot(params: {
  /** 目标档位；为空（降级为免费）时不落成交价快照 */
  planId: PulseMembershipPlanId | null;
  priceDisplay?: string;
  subAccountCount?: number;
  subAccountAmountDisplay?: string;
}): {
  price: number;
  subAccountAmount?: number;
  subAccountCount?: number;
} | null {
  const price = resolvePriceFen(params.priceDisplay);
  const subAccountAmount = resolveAmountFen(params.subAccountAmountDisplay);

  if (!params.planId || price === null) {
    return null;
  }

  // 子账号分量只对年 / 永久档位有意义：月 / 季开不了子账号，
  // 即便请求里带了这两个字段也不得写入，避免污染快照
  const subAccountAllowed = isSubAccountPricingPlan(params.planId);
  const snapshot: {
    price: number;
    subAccountAmount?: number;
    subAccountCount?: number;
  } = { price };

  // 未录入的字段保持原值，不要把 NULL 写回去
  if (subAccountAllowed && subAccountAmount !== null) {
    snapshot.subAccountAmount = subAccountAmount;
  }
  // 数量 0 不写库：与「填了数量才同步开通配额」保持同一语义。
  // 写 0 会让续费卡显示「包含 0 个子账号」，而门店的实时配额并没被清掉
  if (
    subAccountAllowed &&
    params.subAccountCount !== undefined &&
    params.subAccountCount > 0
  ) {
    snapshot.subAccountCount = params.subAccountCount;
  }

  return snapshot;
}

/** 序列化「设置会员等级」审计事件（供 `logger.warn` 落日志）。 */
export function buildMembershipLevelMutationAuditEvent(params: {
  memberId: number;
  operatorUserId: number;
  operatorEmail: string;
  previousPlanId: PulseMembershipPlanId | null;
  previousExpiresAt: Date | null;
  nextLevel: PulseAdminMemberLevel;
  nextPlanId: PulseMembershipPlanId | null;
  nextExpiry: Date | null;
  confirmDowngradeToFree: boolean;
  actionSource: string;
  requestId: string | null;
  ip: string | null;
  userAgent: string | null;
}): Record<string, unknown> {
  return {
    event: 'pulse_admin_membership_level_mutation',
    memberId: params.memberId,
    operatorUserId: params.operatorUserId,
    operatorEmail: params.operatorEmail,
    previousPlanId: params.previousPlanId,
    previousExpiresAt: params.previousExpiresAt?.toISOString() ?? null,
    nextLevel: params.nextLevel,
    nextPlanId: params.nextPlanId,
    nextExpiry: params.nextExpiry?.toISOString() ?? null,
    confirmDowngradeToFree: params.confirmDowngradeToFree,
    actionSource: params.actionSource,
    requestId: params.requestId,
    ip: params.ip,
    userAgent: params.userAgent,
  };
}

/** 序列化「设置会员等级已落单」审计事件（供 `logger.warn` 落日志）。 */
export function buildMembershipOrderRecordedAuditEvent(params: {
  memberId: number;
  operatorUserId: number;
  operatorEmail: string;
  planId: PulseMembershipPlanId;
  amount: number;
  paymentChannel: AdminMembershipOrderChannel;
  countAsIncome: boolean;
  forcedGift: boolean;
}): Record<string, unknown> {
  return {
    event: 'pulse_admin_membership_order_recorded',
    memberId: params.memberId,
    operatorUserId: params.operatorUserId,
    operatorEmail: params.operatorEmail,
    planId: params.planId,
    amount: params.amount,
    paymentChannel: params.paymentChannel,
    countAsIncome: params.countAsIncome,
    forcedGift: params.forcedGift,
  };
}

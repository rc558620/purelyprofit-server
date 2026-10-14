// 新用户额度领域类型（单位统一为「位新客」）

/** 额度概览：余额与累计统计 */
export interface NewCustomerQuotaOverview {
  storeId: number;
  /** 剩余额度：还能服务多少位新客 */
  remaining: number;
  /** 预警阈值，低于该值触发首页提醒 */
  warningThreshold: number;
  /** 累计充值获得 */
  totalRecharged: number;
  /** 累计会员赠送 */
  totalGranted: number;
  /** 累计已服务新客 */
  totalConsumed: number;
}

/** 充值档位：金额与可得新客数均由后端计算 */
export interface NewCustomerQuotaTier {
  /** 充值金额（分） */
  amountFen: number;
  /** 金额展示值（如 ¥10） */
  amountDisplay: string;
  /** 可服务的新客数 */
  quotaCount: number;
}

/**
 * 流水类型。
 * `admin_adjust` = 平台运营在 purelyPulse 代商家发放 / 回收，
 * 与商家自付的 `recharge`、会员赠送的 `grant` 分属三个不同来源。
 */
export type NewCustomerQuotaLogTypeValue =
  | 'recharge'
  | 'grant'
  | 'consume'
  | 'clear'
  | 'admin_adjust';

/** 额度流水条目 */
export interface NewCustomerQuotaLogItem {
  id: number;
  type: NewCustomerQuotaLogTypeValue;
  /** 变动数量：正数为增加，负数为消耗 */
  changeAmount: number;
  /** 变动后的余额 */
  balanceAfter: number;
  /** 流水说明 */
  description: string;
  /** 变动时间（ISO 字符串） */
  createdAt: string;
}

/** 额度消耗结果 */
export interface ConsumeNewCustomerQuotaResult {
  /** 是否实际扣减；false 表示该顾客此前已在任意门店扣过（重复下单 / 换店 / 重复绑定） */
  consumed: boolean;
  /** 扣减后的余额 */
  remaining: number;
}

// ─── 写路径入参（.write.ts 事务体的参数，全部由 service 组装） ───────────

/** 充值到账：写额度 + 充值流水 */
export interface QuotaRechargeWriteParams {
  storeId: number;
  /** 充值金额（分），仅用于流水留痕 */
  amountFen: number;
  /** 本次到账的新客数，由金额换算而来 */
  quotaCount: number;
  /** 支付单号，用于与微信支付对账 */
  orderId: string;
}

/** 会员赠送：写额度 + 赠送流水 */
export interface QuotaGrantWriteParams {
  storeId: number;
  /** 会员档位，仅用于流水文案 */
  planId: string | null;
  /** 赠送的新客数（已含期数倍率） */
  quotaCount: number;
  /** 购买期数，> 1 时流水标注「×N」 */
  periodCount: number;
}

/** 清零：写余额 0 + 清零流水 */
export interface QuotaClearWriteParams {
  storeId: number;
  description: string;
}

/** 运营调额：按增量调整余额（不会低于 0）+ admin_adjust 流水 */
export interface QuotaAdjustWriteParams {
  storeId: number;
  /** 增量，负数为回收 */
  delta: number;
  description: string;
}

/** 新客消耗：扣 1 个额度 + 写消耗留痕与流水 */
export interface QuotaConsumeWriteParams {
  storeId: number;
  clubUserId: number;
  /** 手机号快照，仅用于运营追溯；未绑定时传 null */
  phone: string | null;
}

/** C 端额度预检结果：供 purelyClub 在下单前判断是否放行 */
export interface NewCustomerQuotaCheckResult {
  /** 当前顾客是否为新客（全局口径：任意门店都未消耗过额度） */
  isNewCustomer: boolean;
  /** 是否阻止下单：仅新客且本店额度耗尽时为 true，老客恒为 false */
  blocked: boolean;
  /** 本店剩余额度（位新客） */
  remaining: number;
}

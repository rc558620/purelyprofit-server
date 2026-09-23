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

/** 流水类型 */
export type NewCustomerQuotaLogTypeValue =
  | 'recharge'
  | 'grant'
  | 'consume'
  | 'clear';

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

/** 新客消耗额度结果 */
export interface ConsumeNewCustomerQuotaResult {
  /** 是否实际扣减；false 表示该手机号在本店已扣过（重复绑定） */
  consumed: boolean;
  /** 扣减后的余额 */
  remaining: number;
}

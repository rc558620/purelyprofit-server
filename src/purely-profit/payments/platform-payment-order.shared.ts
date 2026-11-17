// 平台支付单的常量、入参/出参结构与单号生成（纯函数，无副作用）
import { randomBytes } from 'node:crypto';
import type { PrismaExecutor } from '../member/platform-membership/platform-membership.types';

/** 支付单有效期（秒）：与短信充值订单同口径，超时后由轮询惰性置 closed */
export const PLATFORM_PAYMENT_ORDER_TTL_SECONDS = 15 * 60;

/** 各业务的支付单号前缀（与既有 SM / QUOTA 等本地单号区分开，便于对账识别） */
export const PLATFORM_PAYMENT_NO_PREFIX = {
  membership: 'PM',
  new_customer_quota: 'PQ',
  sms_recharge: 'PS',
} as const;

export interface CreatePlatformPaymentOrderParams {
  bizType: keyof typeof PLATFORM_PAYMENT_NO_PREFIX;
  storeId: number;
  operatorUserId: number;
  /** 应付金额（分），由后端业务计算，前端不得提供 */
  amountFen: number;
  /** 下单时的支付模式：测试单必须与真实单可区分 */
  payMode: 'test' | 'live';
  /** 关联的业务单据（会员订单 ID / 额度流水单号等） */
  bizOrderId?: string;
  /** 复用的事务客户端 */
  executor?: PrismaExecutor;
}

export interface PlatformPaymentOrderView {
  orderNo: string;
  bizType: string;
  bizOrderId: string | null;
  storeId: number;
  amountFen: number;
  payMode: string;
  status: string;
  codeUrl: string | null;
  expiresAt: Date;
}

/** 支付单视图的落库返回列（创建与查询共用同一份字段顺序） */
export const PLATFORM_PAYMENT_ORDER_VIEW_SELECT = {
  orderNo: true,
  bizType: true,
  bizOrderId: true,
  storeId: true,
  amountFen: true,
  payMode: true,
  status: true,
  codeUrl: true,
  expiresAt: true,
} as const;

/** 生成支付单号：业务前缀 + 时间戳 + 随机串，保证同商户号下唯一 */
export function buildPlatformPaymentOrderNo(
  bizType: keyof typeof PLATFORM_PAYMENT_NO_PREFIX,
  now: Date,
): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  const stamp =
    `${now.getFullYear()}` +
    `${pad(now.getMonth() + 1)}` +
    `${pad(now.getDate())}` +
    `${pad(now.getHours())}` +
    `${pad(now.getMinutes())}` +
    `${pad(now.getSeconds())}`;

  // 随机段 6 字节（12 位 hex）：2 字节只有 65536 种可能，单号会被逐秒枚举出来，
  // 而轮询接口正是靠「猜不到单号」兜底的，太短等于把别人的支付单暴露出去
  return `${PLATFORM_PAYMENT_NO_PREFIX[bizType]}${stamp}${randomBytes(6).toString('hex').toUpperCase()}`;
}

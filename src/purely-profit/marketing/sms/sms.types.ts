import type {
  SmsSegmentCountMode,
  SmsWalletLogTypeValue,
} from './sms.constants';

/** 询价快照：写入 Redis / 内存缓存，broadcasts 时用它做二次校验 */
export interface SmsQuoteSnapshot {
  quoteId: string;
  storeId: number;
  /** 提交时的收件人数（含无手机号者） */
  recipientCount: number;
  /** 有效手机号人数 */
  validMobileCount: number;
  /** 计费总条数 = 每人分段数 × 有效收件人数 */
  smsSegments: number;
  /**
   * 询价时用的字数统计口径。
   *
   * 发送时必须**沿用快照里的口径**而不是重新读配置：否则在切换
   * `sms.segmentCountMode` 的瞬间，飞行中的询价单会按新口径重算，
   * 出现「询价显示 ¥10、实际扣 ¥12」的价格漂移。
   */
  segmentMode: SmsSegmentCountMode;
  unitPriceFen: number;
  estimatedAmountFen: number;
  content: string;
  /**
   * **提交时传入的全部**顾客 ID（Int，含无手机号者）。
   * 刻意不存「有效收件人」子集：broadcasts 需要用它和前端再次提交的 ID 做集合比对，
   * 存子集会让「20 人里 5 人没手机号」这种正常场景被误判成「收件人已变更」。
   */
  customerIds: number[];
  expiresAtMs: number;
}

/** 通道返回的逐条发送结果 */
export interface SmsSendResultItem {
  /** 归一化后的 11 位手机号 */
  phone: string;
  ok: boolean;
  /** 通道返回码，如 Ok / LimitExceeded.PhoneNumberCountLimit */
  code: string | null;
  message: string | null;
  /**
   * 腾讯云返回的 RequestId（一次 SendSms 请求一个）。
   * 成功也必须落库：没有它，事后无法拿业务单号去通道侧对账排障。
   */
  requestId: string | null;
  /**
   * 腾讯云返回的 SerialNo（**一个号码一条**）。
   *
   * 异步送达回执只带这个号，靠它才能把「运营商说没送到」对回具体明细，
   * 进而把那部分钱退给商户（腾讯云对送达失败不计费，我们不退还就是多收）。
   */
  serialNo: string | null;
}

/** 已解析的收件人（手机号必然有效） */
export interface SmsResolvedRecipient {
  customerId: number;
  phone: string;
}

/** 扣费事务内需要写入的群发任务入参 */
export interface SmsChargeParams {
  storeId: number;
  operatorStaffId: number | null;
  broadcastId: string;
  idempotencyKey: string;
  content: string;
  recipientCount: number;
  validMobileCount: number;
  smsSegments: number;
  unitPriceFen: number;
  chargedAmountFen: number;
  recipients: SmsResolvedRecipient[];
}

/** 钱包概览 */
export interface SmsWalletSummary {
  balanceFen: number;
  unitPriceFen: number;
  warningThresholdFen: number;
  totalRechargedFen: number;
  totalConsumedFen: number;
  sentSmsCount: number;
}

/** 钱包流水行 */
export interface SmsWalletLogItem {
  id: number;
  type: SmsWalletLogTypeValue;
  changeFen: number;
  balanceAfterFen: number;
  description: string;
  createdAt: string;
}

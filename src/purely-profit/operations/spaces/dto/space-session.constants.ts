export const SPACE_COUNTDOWN_FEE_MODE_VALUES = ['timed', 'fixed'] as const;
export type SpaceCountdownFeeModeValue =
  (typeof SPACE_COUNTDOWN_FEE_MODE_VALUES)[number];

export const SPACE_TIME_FEE_MODE_VALUES = ['timed', 'unit_price'] as const;
export type SpaceTimeFeeModeValue = (typeof SPACE_TIME_FEE_MODE_VALUES)[number];

export const SPACE_SESSION_CONTACT_PATTERN = /^[0-9+\-\s]{6,20}$/;

export const SPACE_CUSTOMER_PAYMENT_METHOD_VALUES = [
  'cash',
  'wechat',
  'alipay',
  'card',
  'groupon_voucher',
] as const;
export type SpaceCustomerPaymentMethodValue =
  (typeof SPACE_CUSTOMER_PAYMENT_METHOD_VALUES)[number];

export const SPACE_SETTLEMENT_CHANNEL_VALUES = [
  'direct_cashier',
  'meituan_groupon',
  'douyin_groupon',
  'other_platform',
] as const;
export type SpaceSettlementChannelValue =
  (typeof SPACE_SETTLEMENT_CHANNEL_VALUES)[number];

export const SPACE_SETTLEMENT_STATUS_VALUES = [
  'not_applicable',
  'pending',
  'partially_settled',
  'settled',
  'cancelled',
] as const;
export type SpaceSettlementStatusValue =
  (typeof SPACE_SETTLEMENT_STATUS_VALUES)[number];

/** 团购平台枚举值列表 */
export const GROUPON_PLATFORM_VALUES = [
  'meituan',
  'douyin',
  'kuaishou',
  'xiaohongshu',
  'dianping',
  'eleme',
  'pinduoduo',
  'taobao',
  'jd',
  'wechat_store',
  'other',
] as const;
export type GrouponPlatformValue = (typeof GROUPON_PLATFORM_VALUES)[number];

/** 团购平台选项列表（含中文标签，供前端下拉框与展示使用） */
export const GROUPON_PLATFORM_OPTIONS: Array<{
  value: GrouponPlatformValue;
  label: string;
}> = [
  { value: 'meituan', label: '美团' },
  { value: 'douyin', label: '抖音' },
  { value: 'kuaishou', label: '快手' },
  { value: 'xiaohongshu', label: '小红书' },
  { value: 'dianping', label: '大众点评' },
  { value: 'eleme', label: '饿了么' },
  { value: 'pinduoduo', label: '拼多多' },
  { value: 'taobao', label: '淘宝' },
  { value: 'jd', label: '京东' },
  { value: 'wechat_store', label: '微信小商店' },
  { value: 'other', label: '其他' },
];

export function transformOptionalBoolean({
  value,
}: {
  value: unknown;
}): boolean | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    if (value === 1) {
      return true;
    }
    if (value === 0) {
      return false;
    }
  }

  if (typeof value === 'string') {
    if (value === 'true' || value === '1') {
      return true;
    }

    if (value === 'false' || value === '0') {
      return false;
    }
  }

  return undefined;
}

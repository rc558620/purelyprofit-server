import type { SmsWalletLog } from '@prisma/client';
import type { SmsWalletLogTypeValue } from './sms.constants';
import type { SmsWalletLogItem } from './sms.types';

const SMS_WALLET_LOG_TYPE_SET = new Set<string>([
  'recharge',
  'consume',
  'refund',
  'grant',
  'admin_adjust',
]);

/**
 * Prisma 枚举 → 前端类型。
 *
 * DB 枚举就是前端要的 5 个值，不存在映射差异；这里仍做一次兜底，
 * 防止将来加了新枚举值却忘了同步前端，把 `null` 直接透出去导致前端白屏。
 */
export function toSmsWalletLogType(value: string): SmsWalletLogTypeValue {
  return SMS_WALLET_LOG_TYPE_SET.has(value)
    ? (value as SmsWalletLogTypeValue)
    : 'admin_adjust';
}

export function toSmsWalletLogItem(
  row: Pick<
    SmsWalletLog,
    | 'id'
    | 'type'
    | 'changeFen'
    | 'balanceAfterFen'
    | 'description'
    | 'createdAt'
  >,
): SmsWalletLogItem {
  return {
    id: row.id,
    type: toSmsWalletLogType(row.type),
    changeFen: row.changeFen,
    balanceAfterFen: row.balanceAfterFen,
    description: row.description,
    createdAt: row.createdAt.toISOString(),
  };
}

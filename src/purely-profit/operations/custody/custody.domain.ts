// 客存领域纯函数：状态判定、到期计算、单号生成与入参解析（不依赖 Prisma / Redis）
import { BadRequestException } from '@nestjs/common';
import {
  CUSTODY_ORDER_NO_PREFIX,
  CUSTODY_EXPIRING_SOON_DAYS,
} from './custody.constants';

/** 客存单状态取值（对齐 Prisma 枚举，避免 service 层依赖生成类型做字符串比较） */
export type CustodyStatusValue =
  | 'draft'
  | 'stored'
  | 'finished'
  | 'expired'
  | 'void';

/** 库存口径取值 */
export type CustodyStockModeValue = 'sold' | 'frozen';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 惰性判定 effective status：DB 不落 expired，读取时按到期时间推导。
 *
 * 只有 stored 状态会随时间流转为 expired，其余终态（finished/void/draft）保持不变。
 */
export function resolveEffectiveStatus(
  status: CustodyStatusValue,
  expireAt: Date | null,
  now: Date,
): CustodyStatusValue {
  if (status !== 'stored' || !expireAt) {
    return status;
  }
  return expireAt.getTime() <= now.getTime() ? 'expired' : status;
}

/** 是否处于可取状态（用于核销前置校验与冻结库存聚合） */
export function isPickable(
  status: CustodyStatusValue,
  expireAt: Date | null,
  now: Date,
): boolean {
  return resolveEffectiveStatus(status, expireAt, now) === 'stored';
}

/** 是否临近过期（统计口径：stored 且 N 天内到期） */
export function isExpiringSoon(
  status: CustodyStatusValue,
  expireAt: Date | null,
  now: Date,
): boolean {
  if (status !== 'stored' || !expireAt) {
    return false;
  }
  const remainMs = expireAt.getTime() - now.getTime();
  return remainMs > 0 && remainMs <= CUSTODY_EXPIRING_SOON_DAYS * DAY_MS;
}

/**
 * 计算到期时间。
 *
 * 优先级：表单显式到期时间 > 门店默认有效期天数 > 长期有效（null）。
 */
export function resolveExpireAt(
  rawExpireAt: string | undefined,
  defaultExpireDays: number | null,
  storedAt: Date,
): Date | null {
  if (rawExpireAt) {
    return parseIsoDate(rawExpireAt, 'expireAt');
  }
  if (typeof defaultExpireDays === 'number' && defaultExpireDays > 0) {
    return new Date(storedAt.getTime() + defaultExpireDays * DAY_MS);
  }
  return null;
}

/** 解析 ISO 日期字符串，格式非法时抛出参数异常 */
export function parseIsoDate(value: string, fieldName: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`${fieldName} 时间格式不合法`);
  }
  return parsed;
}

/** 解析可选 ISO 日期字符串，空值返回 null */
export function parseOptionalIsoDate(
  value: string | undefined,
  fieldName: string,
): Date | null {
  if (!value) {
    return null;
  }
  return parseIsoDate(value, fieldName);
}

/** 北京时间（UTC+8）日期串生成单号：`CO` + yyyyMMdd + 毫秒后 6 位 + 随机位 */
export function buildOrderNo(now: Date): string {
  const utc8 = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const datePart = [
    utc8.getUTCFullYear(),
    String(utc8.getUTCMonth() + 1).padStart(2, '0'),
    String(utc8.getUTCDate()).padStart(2, '0'),
  ].join('');
  const seq = String(now.getTime() % 1_000_000).padStart(6, '0');
  const random = String(Math.floor(Math.random() * 100)).padStart(2, '0');
  return `${CUSTODY_ORDER_NO_PREFIX}${datePart}${seq}${random}`;
}

/** 日期 → ISO 字符串；空值统一返回空串，避免前端 null 分支 */
export function toIsoString(value: Date | null): string {
  return value ? value.toISOString() : '';
}

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

/**
 * 操作员角色（存入经手 / 取出核销）：owner=主账号，manager=店长，staff=操作员。
 *
 * 取值由后端从 `staffs.role` 解析后下发，前端只按此决定标签文案与配色，
 * 不在本地复制任何角色名到文案的映射规则。
 */
export type CustodyOperatorRole = 'owner' | 'manager' | 'staff';

/**
 * StaffRole → 操作员角色口径。
 *
 * 兜底规则：店员档案缺失（已删除 / 系统行为写入）或角色不可识别时统一按
 * staff（操作员）处理，保证前端永远拿到可渲染的角色，不需要处理未知分支。
 */
export function resolveCustodyOperatorRole(
  rawRole: string | null | undefined,
): CustodyOperatorRole {
  if (rawRole === 'owner' || rawRole === 'manager') {
    return rawRole;
  }
  return 'staff';
}

/** 角色解析所需的店员行快照（userId / 子账号角色由调用方联表带出） */
export interface CustodyOperatorStaffSnapshot {
  /** 店员档案角色（历史数据可能未同步，仅作兜底） */
  role: string;
  /** 店员归属登录用户 ID：与 store.ownerId 比对判定主账号 */
  userId: number | null;
  /** 关联子账号角色（店长子账号在 staff.role 上可能不是 manager） */
  subAccountRole?: string | null;
}

/**
 * 店员行 → 操作员角色，口径与交班模块 resolveOperatorRole 对齐：
 *
 * 1. staff.userId === store.ownerId → 主账号（ownerId 是权威依据，
 *    历史店员行的 role 可能仍是 manager，直接信 role 会把老板判成店长）
 * 2. staff.role === owner → 主账号
 * 3. 关联子账号角色为 manager → 店长
 * 4. 其余（含档案缺失）→ 操作员
 */
export function resolveCustodyOperatorRoleFromStaff(
  staff: CustodyOperatorStaffSnapshot | null | undefined,
  storeOwnerUserId: number | null,
): CustodyOperatorRole {
  if (!staff) {
    return 'staff';
  }
  if (storeOwnerUserId !== null && staff.userId === storeOwnerUserId) {
    return 'owner';
  }
  if (staff.role === 'owner') {
    return 'owner';
  }
  if (staff.subAccountRole === 'manager') {
    return 'manager';
  }
  return resolveCustodyOperatorRole(staff.role);
}

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

/** ISO 瞬时后缀：Z 或 ±HH:mm。用于拒绝「无时区」的时间串 */
const ISO_TIMEZONE_SUFFIX = /(?:Z|[+-]\d{2}:?\d{2})$/;

/**
 * 解析带时区的 ISO 瞬时字符串，格式非法时抛出参数异常。
 *
 * 强制要求时区后缀（Z 或 ±HH:mm）：不带时区的串（如 '2026-10-31'）会被 `new Date()`
 * 按 UTC 解释、'2026-10-31 23:59' 又被按进程本地时区解释，跨时区部署下到期时刻会
 * 凭空偏移 8 小时。DTO 层已用同一口径挡过一道，这里作为写入前的最后一道闸门。
 */
export function parseIsoDate(value: string, fieldName: string): Date {
  const trimmed = value.trim();
  if (!ISO_TIMEZONE_SUFFIX.test(trimmed)) {
    throw new BadRequestException(
      `${fieldName} 必须是带时区的 ISO 瞬时时间（如 2026-10-31T15:59:00.000Z）`,
    );
  }
  const parsed = new Date(trimmed);
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

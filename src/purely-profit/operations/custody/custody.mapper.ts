// 客存 B 端映射：Prisma 实体 → 出参 DTO，负责空值兜底、时间口径与状态派生
import type {
  CustodyOrder,
  CustodyPickup,
  CustodySetting,
  Prisma,
} from '@prisma/client';
import { maskPhone } from '../../marketing/marketing.utils';
import { CUSTODY_DEFAULT_UNIT_OPTIONS } from './custody.constants';
import {
  isExpiringSoon,
  resolveEffectiveStatus,
  toIsoString,
  type CustodyOperatorRole,
  type CustodyStockModeValue,
  type CustodyStatusValue,
} from './custody.domain';
import type {
  CustodyOrderResponseDto,
  CustodyPickupRecordDto,
  CustodySettingsDto,
  VerifyPickupPreviewDto,
} from './dto/custody-response.dto';

/**
 * 实体 → 存单 DTO（状态按到期时间惰性派生）。
 *
 * createdByRole 由调用方解析后传入：读链路按店员档案联表解析，
 * 写链路直接取当前登录主体的角色，mapper 不自行查库。
 */
export function mapCustodyOrder(
  record: CustodyOrder,
  now: Date,
  createdByRole: CustodyOperatorRole,
): CustodyOrderResponseDto {
  // 状态与临期同用一个 now 与同一份派生口径：状态已流转到 expired 时不再算临期
  const status = resolveEffectiveStatus(
    record.status as CustodyStatusValue,
    record.expireAt,
    now,
  );
  return {
    id: String(record.id),
    orderNo: record.orderNo,
    memberName: record.memberNameSnapshot ?? '',
    phone: record.memberPhoneSnapshot ?? '',
    productName: record.productName,
    specName: record.specName ?? '',
    unit: record.unit,
    totalQty: record.totalQty,
    remainingQty: record.remainingQty,
    location: record.location ?? '',
    storedAt: toIsoString(record.storedAt),
    expireAt: toIsoString(record.expireAt),
    status,
    expiringSoon: isExpiringSoon(status, record.expireAt, now),
    stockMode: record.stockMode as CustodyStockModeValue,
    createdByName: record.createdByNameSnapshot ?? '',
    createdByRole,
    voidReason: record.voidReason ?? '',
    remark: record.note ?? '',
    image: record.image ?? '',
  };
}

/**
 * 实体 → 取出流水 DTO。
 *
 * operatorRole 由调用方解析后传入，口径与 mapCustodyOrder 一致。
 */
export function mapPickupRecord(
  record: CustodyPickup,
  operatorRole: CustodyOperatorRole,
): CustodyPickupRecordDto {
  return {
    id: String(record.id),
    qty: record.qty,
    pickedAt: toIsoString(record.pickedAt),
    operatorName: record.operatorNameSnapshot ?? '',
    operatorRole,
  };
}

/** 实体 → 门店配置 DTO（无配置时返回默认口径） */
export function mapCustodySettings(
  record: CustodySetting | null,
): CustodySettingsDto {
  return {
    enabled: record?.enabled ?? true,
    stockMode: (record?.stockMode ?? 'sold') as CustodyStockModeValue,
    defaultExpireDays: record?.defaultExpireDays ?? null,
    allowCrossStorePickup: record?.allowCrossStorePickup ?? false,
    requireMemberConfirm: record?.requireMemberConfirm ?? true,
    pickupPhoneVerifyEnabled: record?.pickupPhoneVerifyEnabled ?? false,
    pickupPhoneVerifyThreshold: record?.pickupPhoneVerifyThreshold ?? null,
    unitOptions: parseUnitOptions(record?.unitOptions),
  };
}

/** 存单 + 核销令牌 → 核销预览 DTO */
export function mapVerifyPreview(
  record: CustodyOrder,
  verifyToken: string,
): VerifyPickupPreviewDto {
  return {
    id: String(record.id),
    orderNo: record.orderNo,
    memberName: record.memberNameSnapshot ?? '',
    phoneMasked: maskPhone(record.memberPhoneSnapshot ?? ''),
    productName: record.productName,
    specName: record.specName ?? '',
    unit: record.unit,
    remainingQty: record.remainingQty,
    location: record.location ?? '',
    verifyToken,
  };
}

/** 解析 Json 字段为单位数组（脏数据兜底为默认单位） */
function parseUnitOptions(raw: Prisma.JsonValue | null | undefined): string[] {
  if (!Array.isArray(raw)) {
    return [...CUSTODY_DEFAULT_UNIT_OPTIONS];
  }
  const values = raw.filter((item): item is string => typeof item === 'string');
  return values.length > 0 ? values : [...CUSTODY_DEFAULT_UNIT_OPTIONS];
}

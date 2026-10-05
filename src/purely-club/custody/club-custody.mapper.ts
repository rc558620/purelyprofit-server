// 客存 C 端映射：Prisma 实体 → 会员视角 DTO，负责门店名回填、时间口径与状态派生
import type { CustodyOrder, CustodyPickup } from '@prisma/client';
import type { CustodyStatusValue } from '../../purely-profit/operations/custody/custody.domain';
import {
  resolveEffectiveStatus,
  toIsoString,
} from '../../purely-profit/operations/custody/custody.domain';
import type {
  ClubCustodyOrderDto,
  ClubCustodyPickupRecordDto,
  ClubCustodyStatus,
} from './dto/club-custody.dto';

/** 不透出状态（void）的兜底展示口径 */
const UNDISCLOSED_FALLBACK_STATUS: ClubCustodyStatus = 'stored';

/** 存单 → 会员视角存单 DTO（storeName 由调用方回填门店名快照） */
export function mapClubCustodyOrder(
  record: CustodyOrder,
  storeName: string,
  now: Date,
): ClubCustodyOrderDto {
  return {
    id: String(record.id),
    storeId: record.storeId,
    storeName,
    productName: record.productName,
    specName: record.specName ?? '',
    unit: record.unit,
    totalQty: record.totalQty,
    remainingQty: record.remainingQty,
    location: record.location ?? '',
    storedAt: toIsoString(record.storedAt),
    expireAt: toIsoString(record.expireAt),
    status: resolveClubStatus(record, now),
    remark: record.note ?? '',
    image: record.image ?? '',
  };
}

/** 取出流水 → 会员视角流水 DTO */
export function mapClubPickupRecord(
  record: CustodyPickup,
  storeName: string,
): ClubCustodyPickupRecordDto {
  return {
    id: String(record.id),
    custodyOrderId: String(record.custodyOrderId),
    qty: record.qty,
    pickedAt: toIsoString(record.pickedAt),
    storeName,
  };
}

/**
 * 会员端状态映射：draft 必须原样透出（待确认入口要显示「待确认」），
 * 仅 void 不透出，降级为 stored 兜底。
 */
function resolveClubStatus(record: CustodyOrder, now: Date): ClubCustodyStatus {
  const effective = resolveEffectiveStatus(
    record.status as CustodyStatusValue,
    record.expireAt,
    now,
  );
  if (
    effective === 'draft' ||
    effective === 'finished' ||
    effective === 'expired'
  ) {
    return effective;
  }
  return UNDISCLOSED_FALLBACK_STATUS;
}

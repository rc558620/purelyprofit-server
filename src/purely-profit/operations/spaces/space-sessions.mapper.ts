import { centsToYuan, toTimestampMs } from '../../commerce/commerce.utils';
import type {
  SpaceSessionItemResponseDto,
  SpaceSessionRenewRecordResponseDto,
  SpaceSessionResponseDto,
} from './dto/space-session.dto';
import type {
  SpaceSessionItemRecord,
  SpaceSessionItemRow,
  SpaceSessionRecord,
  SpaceSessionRenewRecord,
  SpaceSessionRenewRecordRow,
} from './space-sessions.types';
import type {
  SpaceCustomerPaymentMethodValue,
  SpaceSettlementChannelValue,
} from './dto/space-session.constants';

/**
 * Step 8.1: 从 space_session_items 行类型映射为业务记录
 * 替代旧版 parseSpaceSessionItems(JSON)
 */
export const mapSessionItemRows = (
  rows: SpaceSessionItemRow[] | undefined | null,
): SpaceSessionItemRecord[] =>
  (rows ?? [])
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((row) => ({
      productId: row.productId,
      productName: row.productName,
      categoryName: row.categoryName,
      // DB 存储为分（Int），转为元
      salePrice: centsToYuan(row.salePrice),
      profit: centsToYuan(row.profit),
      quantity: row.quantity,
    }));

/**
 * Step 8.1: 从 space_session_renew_records 行类型映射为业务记录
 * 替代旧版 parseSpaceSessionRenewRecords(JSON)
 */
export const mapRenewRecordRows = (
  rows: SpaceSessionRenewRecordRow[] | undefined | null,
): SpaceSessionRenewRecord[] =>
  (rows ?? []).map((row) => ({
    id: row.recordId, // 业务 ID 暴露给前端
    // DB 存储为分（Int），转为元
    amount: centsToYuan(row.amount),
    addedMinutes: row.addedMinutes,
    paymentMethod: row.paymentMethod,
    ...(row.grouponCode !== null ? { grouponCode: row.grouponCode } : {}),
    ...(row.grouponPlatform !== null
      ? { grouponPlatform: row.grouponPlatform }
      : {}),
    ...(row.note !== null ? { note: row.note } : {}),
    renewedAt: row.renewedAt,
  }));

export const toSpaceSessionResponse = (
  session: SpaceSessionRecord,
): SpaceSessionResponseDto => {
  const items = mapSessionItemRows(session.sessionItems);
  const renewRecords = mapRenewRecordRows(session.sessionRenewRecords);

  return {
    id: String(session.id),
    spaceId: String(session.spaceId),
    spaceName: session.space.name,
    spaceType: session.space.type.name,
    ...(session.guestName ? { guestName: session.guestName } : {}),
    ...(session.guestPhone ? { guestPhone: session.guestPhone } : {}),
    ...(session.guestCount !== null ? { guestCount: session.guestCount } : {}),
    startTime: toTimestampMs(session.startTime),
    ...(session.endTime ? { endTime: toTimestampMs(session.endTime) } : {}),
    billingMode: session.billingMode,
    ...(session.hourlyRate !== null
      ? { hourlyRate: centsToYuan(Number(session.hourlyRate)) }
      : {}),
    ...(session.timeCost !== null
      ? { timeCost: centsToYuan(Number(session.timeCost)) }
      : {}),
    ...(session.countdownMinutes !== null
      ? { countdownMinutes: session.countdownMinutes }
      : {}),
    ...(session.autoCheckout !== null
      ? { autoCheckout: session.autoCheckout }
      : {}),
    ...(session.prepaidPaymentMethod
      ? { prepaidPaymentMethod: session.prepaidPaymentMethod }
      : {}),
    ...(session.prepaidCustomerPaymentMethod
      ? {
          prepaidCustomerPaymentMethod:
            session.prepaidCustomerPaymentMethod as SpaceCustomerPaymentMethodValue,
        }
      : {}),
    ...(session.prepaidSettlementChannel
      ? {
          prepaidSettlementChannel:
            session.prepaidSettlementChannel as SpaceSettlementChannelValue,
        }
      : {}),
    ...(session.prepaidGrouponCode
      ? { prepaidGrouponCode: session.prepaidGrouponCode }
      : {}),
    ...(session.prepaidGrouponPlatform
      ? { prepaidGrouponPlatform: session.prepaidGrouponPlatform }
      : {}),
    ...(session.prepaidVoucherCode
      ? { prepaidVoucherCode: session.prepaidVoucherCode }
      : {}),
    ...(session.prepaidVoucherPlatform
      ? { prepaidVoucherPlatform: session.prepaidVoucherPlatform }
      : {}),
    ...(session.prepaidNote ? { prepaidNote: session.prepaidNote } : {}),
    ...(session.prepaidAmount !== null
      ? { prepaidAmount: centsToYuan(Number(session.prepaidAmount)) }
      : {}),
    ...(session.prepaidVoucherFaceAmount !== null
      ? { prepaidVoucherFaceAmount: centsToYuan(Number(session.prepaidVoucherFaceAmount)) }
      : {}),
    items: items.map((item): SpaceSessionItemResponseDto => ({ ...item })),
    // DB 存储为分（Int），转为元
    itemsCost: centsToYuan(Number(session.itemsCost)),
    renewRecords: renewRecords.map(
      (record): SpaceSessionRenewRecordResponseDto => ({ ...record }),
    ),
    status: session.status,
    ...(session.saleOrderId !== null
      ? { orderId: String(session.saleOrderId) }
      : {}),
    createdAt: toTimestampMs(session.createdAt),
  };
};

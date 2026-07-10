import { Money, toTimestampMs } from '../../commerce/commerce.utils';
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
  SpaceSettlementStatusValue,
  SpaceTimeFeeModeValue,
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
    .map((row) => {
      const salePriceYuan = Money.fromDbCents(row.salePrice).toOutputYuan();
      const quantity = row.quantity;
      return {
        productId: row.productId,
        productName: row.productName,
        categoryName: row.categoryName,
        // DB 存储为分（Int），转为元
        salePrice: salePriceYuan,
        profit: Money.fromDbCents(row.profit).toOutputYuan(),
        quantity,
        // 行合计金额 = salePrice × quantity，全程 Money 运算
        lineTotal: Money.fromDbCents(row.salePrice)
          .multiply(quantity)
          .toOutputYuan(),
      };
    });

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
    amount: Money.fromDbCents(row.amount).toOutputYuan(),
    addedMinutes: row.addedMinutes,
    paymentMethod: row.paymentMethod,
    ...(row.grouponCode !== null ? { grouponCode: row.grouponCode } : {}),
    ...(row.grouponPlatform !== null
      ? { grouponPlatform: row.grouponPlatform }
      : {}),
    ...(row.voucherFaceAmount != null
      ? {
          voucherFaceAmount: Money.fromDbCents(
            row.voucherFaceAmount,
          ).toOutputYuan(),
        }
      : {}),
    ...(row.note !== null ? { note: row.note } : {}),
    renewedAt: Number(row.renewedAt),
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
      ? { hourlyRate: Money.fromDbCents(session.hourlyRate).toOutputYuan() }
      : {}),
    ...(session.timeCost !== null
      ? { timeCost: Money.fromDbCents(session.timeCost).toOutputYuan() }
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
      ? {
          prepaidAmount: Money.fromDbCents(
            session.prepaidAmount,
          ).toOutputYuan(),
        }
      : {}),
    ...(session.prepaidVoucherFaceAmount !== null
      ? {
          prepaidVoucherFaceAmount: Money.fromDbCents(
            session.prepaidVoucherFaceAmount,
          ).toOutputYuan(),
        }
      : {}),
    // ① 修复：平台结算字段输出映射
    ...(session.settlementStatus
      ? {
          settlementStatus:
            session.settlementStatus as SpaceSettlementStatusValue,
        }
      : {}),
    ...(session.platformReceivable != null
      ? {
          platformReceivable: Money.fromDbCents(
            session.platformReceivable,
          ).toOutputYuan(),
        }
      : {}),
    ...(session.platformSettledAmount != null
      ? {
          platformSettledAmount: Money.fromDbCents(
            session.platformSettledAmount,
          ).toOutputYuan(),
        }
      : {}),
    ...(session.platformFee != null
      ? {
          platformFee: Money.fromDbCents(session.platformFee).toOutputYuan(),
        }
      : {}),
    // ⑤ 修复：台位费口径审计字段
    ...(session.timeFeeMode
      ? { timeFeeMode: session.timeFeeMode as SpaceTimeFeeModeValue }
      : {}),
    items: items.map((item): SpaceSessionItemResponseDto => ({ ...item })),
    // DB 存储为分（Int），转为元
    itemsCost: Money.fromDbCents(session.itemsCost).toOutputYuan(),
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

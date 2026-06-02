import { Prisma } from '@prisma/client';
import { toTimestampMs } from '../../commerce/commerce.utils';
import type {
  SpaceSessionItemResponseDto,
  SpaceSessionRenewRecordResponseDto,
  SpaceSessionResponseDto,
} from './dto/space-session.dto';
import type {
  SpaceSessionItemRecord,
  SpaceSessionRecord,
  SpaceSessionRenewRecord,
} from './space-sessions.types';
import type { SalesPaymentMethodValue } from '../sales-record/sales-record.types';

export const parseSpaceSessionItems = (
  value: Prisma.JsonValue,
): SpaceSessionItemRecord[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return [];
    }
    const row = item as Record<string, unknown>;
    if (
      typeof row.productId !== 'string' ||
      typeof row.productName !== 'string' ||
      typeof row.categoryName !== 'string' ||
      typeof row.salePrice !== 'number' ||
      typeof row.profit !== 'number' ||
      typeof row.quantity !== 'number'
    ) {
      return [];
    }

    return [
      {
        productId: row.productId,
        productName: row.productName,
        categoryName: row.categoryName,
        salePrice: row.salePrice,
        profit: row.profit,
        quantity: row.quantity,
      },
    ];
  });
};

export const parseSpaceSessionRenewRecords = (
  value: Prisma.JsonValue,
): SpaceSessionRenewRecord[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return [];
    }
    const row = item as Record<string, unknown>;
    if (
      typeof row.id !== 'string' ||
      typeof row.amount !== 'number' ||
      typeof row.addedMinutes !== 'number' ||
      typeof row.paymentMethod !== 'string' ||
      typeof row.renewedAt !== 'number'
    ) {
      return [];
    }

    return [
      {
        id: row.id,
        amount: row.amount,
        addedMinutes: row.addedMinutes,
        paymentMethod: row.paymentMethod as SalesPaymentMethodValue,
        ...(typeof row.grouponCode === 'string'
          ? { grouponCode: row.grouponCode }
          : {}),
        ...(typeof row.grouponPlatform === 'string'
          ? { grouponPlatform: row.grouponPlatform }
          : {}),
        ...(typeof row.note === 'string' ? { note: row.note } : {}),
        renewedAt: row.renewedAt,
      },
    ];
  });
};

export const toSpaceSessionResponse = (
  session: SpaceSessionRecord,
): SpaceSessionResponseDto => {
  const items = parseSpaceSessionItems(session.items);
  const renewRecords = parseSpaceSessionRenewRecords(session.renewRecords);

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
      ? { hourlyRate: Number(session.hourlyRate) }
      : {}),
    ...(session.timeCost !== null ? { timeCost: Number(session.timeCost) } : {}),
    ...(session.countdownMinutes !== null
      ? { countdownMinutes: session.countdownMinutes }
      : {}),
    ...(session.autoCheckout !== null
      ? { autoCheckout: session.autoCheckout }
      : {}),
    ...(session.prepaidPaymentMethod
      ? { prepaidPaymentMethod: session.prepaidPaymentMethod }
      : {}),
    ...(session.prepaidGrouponCode
      ? { prepaidGrouponCode: session.prepaidGrouponCode }
      : {}),
    ...(session.prepaidNote ? { prepaidNote: session.prepaidNote } : {}),
    ...(session.prepaidAmount !== null
      ? { prepaidAmount: Number(session.prepaidAmount) }
      : {}),
    items: items.map((item): SpaceSessionItemResponseDto => ({ ...item })),
    itemsCost: Number(session.itemsCost),
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

export const toSpaceSessionItemsJson = (
  items: SpaceSessionItemRecord[],
): Prisma.InputJsonValue =>
  items.map((item) => ({ ...item })) as Prisma.InputJsonValue;

export const toSpaceSessionRenewRecordsJson = (
  records: SpaceSessionRenewRecord[],
): Prisma.InputJsonValue =>
  records.map((record) => ({ ...record })) as Prisma.InputJsonValue;

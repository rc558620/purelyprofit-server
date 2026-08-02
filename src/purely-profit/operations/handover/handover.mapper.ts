import { EmployeeShiftType } from '@prisma/client';
import type { HandoverAdditionalItemDto } from './dto/handover-additional-items.dto';
import {
  HandoverRecordDisplayStatusDto,
  HandoverStatusDto,
} from './dto/handover-shared.dto';
import type {
  HandoverRecordDetailAdditionalItemDto,
  HandoverRecordListItemDto,
  HandoverRecordSummaryDto,
} from './dto/handover-records.dto';
import { SHIFT_TYPE_LABELS } from './handover.constants';
import { formatShanghaiDayLabel } from '../../../shared/shanghai-time.utils';
import type { AdditionalItemRow, HandoverRecordRow } from './handover.types';
import { toDisplayName } from './handover.utils';

export {
  resolveOrderItemPaymentMethod,
  resolveOrderItemPaymentDisplay,
  mapOrderItem,
  mapRefundOrderItem,
} from './handover-order-item.mapper';

export const mapAdditionalItem = (
  item: AdditionalItemRow,
): HandoverAdditionalItemDto => ({
  id: item.id,
  name: item.name,
  val: item.val ?? '',
  createdAt: item.createdAt.getTime(),
  updatedAt: item.updatedAt.getTime(),
});

export const resolveShiftLabel = (
  shiftType: EmployeeShiftType | null | undefined,
  shiftName?: string | null,
): string => {
  const normalizedShiftName = toDisplayName(shiftName);
  if (normalizedShiftName) {
    return normalizedShiftName;
  }
  if (shiftType) {
    return SHIFT_TYPE_LABELS[shiftType] ?? '未知班次';
  }
  return '未排班';
};

export const formatMonthDay = (date: Date): string => {
  const [month, day] = formatShanghaiDayLabel(date.getTime()).split('/');
  return `${month}-${day}`;
};

export const formatShiftTimeDesc = (
  date: Date,
  startTime: string | null | undefined,
  endTime: string | null | undefined,
): string => {
  const monthDay = formatMonthDay(date);
  if (!startTime || !endTime) {
    return `${monthDay}  未排班`;
  }
  return `${monthDay}  ${startTime}–${endTime}`;
};

export const mapRecordDisplayStatus = (
  status: HandoverStatusDto,
): HandoverRecordDisplayStatusDto =>
  status === HandoverStatusDto.PENDING
    ? HandoverRecordDisplayStatusDto.ACTIVE
    : HandoverRecordDisplayStatusDto.DONE;

export const buildRecordSummaryDto = (params: {
  id: number;
  operatorName: string;
  operatorAvatar?: string | null;
  shiftType: EmployeeShiftType | null;
  shiftLabel: string;
  startTime: string | null;
  endTime: string | null;
  totalRevenue: number;
  status: HandoverStatusDto;
  handoverAt: Date | null;
  createdAt: Date;
  shiftDate?: Date | null;
}): HandoverRecordSummaryDto => {
  const referenceDate =
    params.shiftDate ?? params.handoverAt ?? params.createdAt;
  return {
    id: params.id,
    operatorName: params.operatorName,
    ...(params.operatorAvatar
      ? {
          operatorAvatar: params.operatorAvatar,
          avatar: params.operatorAvatar,
        }
      : {}),
    shiftType: params.shiftType,
    shiftLabel: params.shiftLabel,
    startTime: params.startTime,
    endTime: params.endTime,
    timeDesc: formatShiftTimeDesc(
      referenceDate,
      params.startTime,
      params.endTime,
    ),
    totalRevenue: params.totalRevenue,
    status: params.status,
    displayStatus: mapRecordDisplayStatus(params.status),
    handoverAt: params.handoverAt?.getTime() ?? null,
    createdAt: params.createdAt.getTime(),
    shiftReferenceAt: referenceDate.getTime(),
  };
};

export const mapRecordAdditionalItems = (
  record: HandoverRecordRow,
): HandoverRecordDetailAdditionalItemDto[] =>
  (record.additionalValues ?? []).map((item) => ({
    id: item.id,
    itemId: item.itemId,
    // 优先读快照字段，防止 item 被删后 NPE；兜底取 item.name
    itemName: item.itemNameSnapshot ?? item.item?.name ?? '未知附加项',
    value: item.value,
    createdAt: item.createdAt.getTime(),
    updatedAt: item.updatedAt.getTime(),
  }));

export const mapRecordToDto = (
  record: HandoverRecordRow,
  detail?: Pick<
    HandoverRecordListItemDto,
    | 'shiftInfo'
    | 'additionalItems'
    | 'revenueSummary'
    | 'paymentItems'
    | 'orderItems'
    | 'receiverName'
  >,
): HandoverRecordListItemDto => ({
  id: record.id,
  handoverMode: record.handoverMode,
  status: record.status,
  fromEmployeeId: record.fromEmployeeId,
  fromEmployeeName:
    record.fromEmployee?.name ?? record.fromEmployeeNameSnapshot ?? null,
  toEmployeeId: record.toEmployeeId,
  toEmployeeName: record.toEmployee?.name ?? null,
  note: record.note,
  reason: record.reason,
  handoverAt: record.handoverAt?.getTime() ?? null,
  createdAt: record.createdAt.getTime(),
  updatedAt: record.updatedAt.getTime(),
  shiftInfo: detail?.shiftInfo ?? null,
  additionalItems: detail?.additionalItems ?? mapRecordAdditionalItems(record),
  ...(detail?.revenueSummary ? { revenueSummary: detail.revenueSummary } : {}),
  ...(detail?.paymentItems ? { paymentItems: detail.paymentItems } : {}),
  ...(detail?.orderItems ? { orderItems: detail.orderItems } : {}),
  ...(detail?.receiverName !== undefined
    ? { receiverName: detail.receiverName }
    : {}),
});

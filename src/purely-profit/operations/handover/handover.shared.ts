import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  EmployeeShiftType,
  Prisma,
  SalesPaymentMethod,
  StoreSubAccountRole,
} from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import type {
  HandoverAdditionalItemDto,
  HandoverOrderItemDto,
  HandoverRecordListItemDto,
  HandoverRecordSummaryDto,
} from './dto/handover.dto';
import {
  HandoverRecordDisplayStatusDto,
  HandoverStatusDto,
} from './dto/handover.dto';

export const SHIFT_TIME_FALLBACKS: Record<
  EmployeeShiftType,
  { startTime: string; endTime: string }
> = {
  [EmployeeShiftType.morning]: { startTime: '08:00', endTime: '14:00' },
  [EmployeeShiftType.nine_to_six]: { startTime: '09:00', endTime: '18:00' },
  [EmployeeShiftType.middle]: { startTime: '12:00', endTime: '18:00' },
  [EmployeeShiftType.late]: { startTime: '17:00', endTime: '23:00' },
  [EmployeeShiftType.full]: { startTime: '09:00', endTime: '21:00' },
  [EmployeeShiftType.custom]: { startTime: '', endTime: '' },
};

export const PAYMENT_METHOD_CONFIG: Record<
  SalesPaymentMethod,
  { label: string; color: string }
> = {
  [SalesPaymentMethod.cash]: { label: '现金', color: '#f59e0b' },
  [SalesPaymentMethod.wechat]: { label: '微信', color: '#22c55e' },
  [SalesPaymentMethod.alipay]: { label: '支付宝', color: '#1677ff' },
  [SalesPaymentMethod.card]: { label: '刷卡', color: '#8b5cf6' },
};

export const SHIFT_TYPE_LABELS: Partial<Record<EmployeeShiftType, string>> = {
  [EmployeeShiftType.morning]: '早班',
  [EmployeeShiftType.nine_to_six]: '行政班',
  [EmployeeShiftType.middle]: '中班',
  [EmployeeShiftType.late]: '晚班',
  [EmployeeShiftType.full]: '全天',
  [EmployeeShiftType.custom]: '自定义班次',
};

export const HANDOVER_NOTE_MAX_LENGTH = 500;
export const HANDOVER_ADDITIONAL_ITEM_NAME_MAX_LENGTH = 20;
export const HANDOVER_ADDITIONAL_VALUE_MAX_LENGTH = 200;
export const ORDER_ITEMS_LIMIT = 50;
export const SPACE_PREPAID_DEDUCTION_ITEM_NAME = '预付抵扣';
export const SPACE_RENEW_DEDUCTION_ITEM_NAME = '续费抵扣';
export const CASHIER_SHIFT_OPERATION_BLOCK_MESSAGE =
  '当前班次不属于该收银员，暂不允许操作';

const TIME_TEXT_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const SALES_PAYMENT_METHOD_VALUES = new Set(Object.values(SalesPaymentMethod));

export type ShiftRecordRow = {
  employeeId?: number | null;
  employeeName: string;
  shiftType: EmployeeShiftType | null;
  startTime: string;
  endTime: string;
};

export type HandoverOperationAccess = {
  canOperate: boolean;
  blockedReason: string | null;
};

export const HANDOVER_RECORD_INCLUDE =
  Prisma.validator<Prisma.StoreHandoverRecordInclude>()({
    fromEmployee: { select: { id: true, name: true } },
    toEmployee: { select: { id: true, name: true } },
  });

export type HandoverRecordRow = Prisma.StoreHandoverRecordGetPayload<{
  include: typeof HANDOVER_RECORD_INCLUDE;
}>;

export type AdditionalItemRow = {
  id: number;
  name: string;
  createdAt: Date;
  updatedAt: Date;
};

export type OrderItemRow = {
  id: number;
  productName: string;
  salePrice: Prisma.Decimal;
  quantity: number;
  product: { stock: number; unit: string } | null;
  order: {
    date: Date;
    paymentMethod: SalesPaymentMethod;
    spaceSession: {
      prepaidPaymentMethod: SalesPaymentMethod | null;
      renewRecords: Prisma.JsonValue;
    } | null;
  };
};

export type ShiftDateRange = {
  startAt: Date;
  endAt: Date;
};

export type ReceiverCandidate = {
  employeeId: number;
  employeeName: string;
  subAccountId: number;
};

export const ensureMembershipContext = (
  user: AuthenticatedUser,
): NonNullable<AuthenticatedUser['currentMembership']> => {
  if (!user.currentMembership) {
    throw new ForbiddenException('当前账号暂无门店权限');
  }
  return user.currentMembership;
};

export const ensureMembershipStoreId = (user: AuthenticatedUser): number =>
  ensureMembershipContext(user).storeId;

export const isCashierMembership = (
  membership: NonNullable<AuthenticatedUser['currentMembership']>,
): boolean =>
  membership.subjectType === 'sub_account' &&
  membership.subAccountRole === StoreSubAccountRole.cashier;

export const normalizeRequiredText = (
  value: string,
  maxLength: number,
  emptyMessage: string,
): string => {
  const normalized = value.trim();
  if (!normalized) {
    throw new BadRequestException(emptyMessage);
  }
  return normalized.slice(0, maxLength);
};

export const normalizeOptionalText = (
  value: string | null | undefined,
  maxLength: number,
): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  return normalized.slice(0, maxLength);
};

export const toDisplayName = (
  value: string | null | undefined,
): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized || null;
};

export const roundMoney = (value: number): number =>
  Math.round(value * 100) / 100;

export const toMoneyNumber = (
  value: Prisma.Decimal | number | string | null | undefined,
): number => {
  if (value === null || value === undefined) {
    return 0;
  }
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) {
    return 0;
  }
  return roundMoney(normalized);
};

export const buildCurrentDayRange = (): Prisma.DateTimeFilter => {
  const now = new Date();
  const startAt = new Date(now);
  startAt.setHours(0, 0, 0, 0);
  const endAt = new Date(now);
  endAt.setHours(23, 59, 59, 999);
  return {
    gte: startAt,
    lte: endAt,
  };
};

const createTimePoint = (baseDate: Date, timeText: string): Date => {
  const [, hourText, minuteText] = TIME_TEXT_PATTERN.exec(timeText) ?? [];
  const date = new Date(baseDate);
  date.setHours(Number(hourText), Number(minuteText), 0, 0);
  return date;
};

export const buildShiftDateRange = (
  startTime: string,
  endTime: string,
  baseDate = new Date(),
): ShiftDateRange => {
  const now = new Date(baseDate);
  const startAt = new Date(now);
  startAt.setHours(0, 0, 0, 0);
  const endAt = new Date(now);
  endAt.setHours(23, 59, 59, 999);

  if (!TIME_TEXT_PATTERN.test(startTime) || !TIME_TEXT_PATTERN.test(endTime)) {
    return { startAt, endAt };
  }

  const parsedStart = createTimePoint(now, startTime);
  const parsedEnd = createTimePoint(now, endTime);
  if (parsedEnd <= parsedStart) {
    parsedEnd.setDate(parsedEnd.getDate() + 1);
  }

  return {
    startAt: parsedStart,
    endAt: parsedEnd,
  };
};

const isSalesPaymentMethod = (value: unknown): value is SalesPaymentMethod =>
  typeof value === 'string' &&
  SALES_PAYMENT_METHOD_VALUES.has(value as SalesPaymentMethod);

const parseRenewPaymentMethods = (
  renewRecords: Prisma.JsonValue,
): SalesPaymentMethod[] => {
  if (!Array.isArray(renewRecords)) {
    return [];
  }

  return renewRecords.flatMap((record) => {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      return [];
    }

    const paymentMethod = (record as { paymentMethod?: unknown }).paymentMethod;
    return isSalesPaymentMethod(paymentMethod) ? [paymentMethod] : [];
  });
};

export const resolveOrderItemPaymentMethod = (
  item: OrderItemRow,
): SalesPaymentMethod => {
  const fallbackPaymentMethod = item.order.paymentMethod;
  const spaceSession = item.order.spaceSession;

  if (!spaceSession) {
    return fallbackPaymentMethod;
  }

  if (
    item.productName === SPACE_PREPAID_DEDUCTION_ITEM_NAME &&
    spaceSession.prepaidPaymentMethod
  ) {
    return spaceSession.prepaidPaymentMethod;
  }

  if (item.productName !== SPACE_RENEW_DEDUCTION_ITEM_NAME) {
    return fallbackPaymentMethod;
  }

  const renewPaymentMethods = [
    ...new Set(parseRenewPaymentMethods(spaceSession.renewRecords)),
  ];

  return renewPaymentMethods.length === 1
    ? renewPaymentMethods[0]
    : fallbackPaymentMethod;
};

export const mapOrderItem = (item: OrderItemRow): HandoverOrderItemDto => {
  const totalRevenue = roundMoney(
    toMoneyNumber(item.salePrice) * item.quantity,
  );
  const paymentMethod = resolveOrderItemPaymentMethod(item);
  return {
    id: String(item.id),
    productName: item.productName,
    quantity: item.quantity,
    totalRevenue,
    paymentLabel: PAYMENT_METHOD_CONFIG[paymentMethod].label,
    paymentColor: PAYMENT_METHOD_CONFIG[paymentMethod].color,
    date: item.order.date.getTime(),
    currentStock: item.product?.stock ?? null,
    stockUnit: item.product?.unit ?? null,
  };
};

export const mapAdditionalItem = (
  item: AdditionalItemRow,
): HandoverAdditionalItemDto => ({
  id: item.id,
  name: item.name,
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
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
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
  shiftType: EmployeeShiftType | null;
  shiftLabel: string;
  startTime: string | null;
  endTime: string | null;
  totalRevenue: number;
  status: HandoverStatusDto;
  handoverAt: Date | null;
  createdAt: Date;
}): HandoverRecordSummaryDto => {
  const referenceDate = params.handoverAt ?? params.createdAt;
  return {
    id: params.id,
    operatorName: params.operatorName,
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
  };
};

export const mapRecordToDto = (
  record: HandoverRecordRow,
): HandoverRecordListItemDto => ({
  id: record.id,
  handoverMode: record.handoverMode,
  status: record.status,
  fromEmployeeId: record.fromEmployeeId,
  fromEmployeeName: record.fromEmployee?.name ?? null,
  toEmployeeId: record.toEmployeeId,
  toEmployeeName: record.toEmployee?.name ?? null,
  note: record.note,
  reason: record.reason,
  handoverAt: record.handoverAt?.getTime() ?? null,
  createdAt: record.createdAt.getTime(),
  updatedAt: record.updatedAt.getTime(),
});

import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { EmployeeShiftType, Prisma, SalesPaymentMethod } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import type {
  HandoverAdditionalItemDto,
  HandoverOrderItemDto,
  HandoverRecordListItemDto,
} from './dto/handover.dto';
import { HandoverModeDto, HandoverStatusDto } from './dto/handover.dto';

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

export const HANDOVER_NOTE_MAX_LENGTH = 500;
export const HANDOVER_ADDITIONAL_ITEM_NAME_MAX_LENGTH = 20;
export const HANDOVER_ADDITIONAL_VALUE_MAX_LENGTH = 200;
export const ORDER_ITEMS_LIMIT = 50;

const TIME_TEXT_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export type ShiftRecordRow = {
  employeeName: string;
  shiftType: EmployeeShiftType | null;
  startTime: string;
  endTime: string;
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
): ShiftDateRange => {
  const now = new Date();
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

export const mapOrderItem = (item: OrderItemRow): HandoverOrderItemDto => {
  const totalRevenue = roundMoney(
    toMoneyNumber(item.salePrice) * item.quantity,
  );
  return {
    id: String(item.id),
    productName: item.productName,
    quantity: item.quantity,
    totalRevenue,
    paymentLabel: PAYMENT_METHOD_CONFIG[item.order.paymentMethod].label,
    paymentColor: PAYMENT_METHOD_CONFIG[item.order.paymentMethod].color,
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

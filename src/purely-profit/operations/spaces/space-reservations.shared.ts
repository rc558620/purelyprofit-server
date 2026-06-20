import { BadRequestException } from '@nestjs/common';
import { SpaceReservationStatus as PrismaSpaceReservationStatus } from '@prisma/client';
import { toTimestampMs } from '../../commerce/commerce.utils';
import type { SpaceReservationResponseDto } from './dto/space-reservation.dto';
import type {
  NormalizedSpaceReservationPayload,
  SpaceReservationDateFilter,
  SpaceReservationMutationDto,
  SpaceReservationRecord,
} from './space-reservations.types';
import type { SpaceReservationStatusValue } from './spaces.constants';

const SPACE_CONTACT_PATTERN = /^[0-9+\-\s]{6,20}$/;

export const ensureReservationDateRange = (
  dateFrom?: number,
  dateTo?: number,
): void => {
  if (dateFrom !== undefined && dateTo !== undefined && dateFrom > dateTo) {
    throw new BadRequestException('区间开始时间不能晚于结束时间');
  }
};

export const buildReservationReservedAtFilter = (
  dateFrom?: number,
  dateTo?: number,
): SpaceReservationDateFilter | undefined => {
  if (dateFrom === undefined && dateTo === undefined) {
    return undefined;
  }

  return {
    ...(dateFrom !== undefined ? { gte: new Date(dateFrom) } : {}),
    ...(dateTo !== undefined ? { lte: new Date(dateTo) } : {}),
  };
};

export const normalizeReservationPayload = (
  dto: SpaceReservationMutationDto,
): NormalizedSpaceReservationPayload => {
  const guestName = dto.guestName.trim();
  const phone = dto.phone.trim();
  if (!guestName) {
    throw new BadRequestException('预约人姓名不能为空');
  }
  if (!phone) {
    throw new BadRequestException('联系方式不能为空');
  }

  if (!SPACE_CONTACT_PATTERN.test(phone)) {
    throw new BadRequestException(
      '联系方式格式不正确，请输入 6-20 位数字或常见联系电话格式',
    );
  }

  const note = dto.note?.trim();
  return {
    guestName,
    phone,
    reservedAt: dto.reservedAt,
    reservedEndAt: dto.reservedEndAt,
    ...(dto.guestCount !== undefined ? { guestCount: dto.guestCount } : {}),
    ...(note ? { note } : {}),
  };
};

export const ensureReservationGuestCount = (
  guestCount: number | undefined,
  capacity?: number,
): void => {
  if (guestCount === undefined) {
    return;
  }

  assertPositiveInteger(guestCount, '预约人数');
  if (capacity !== undefined && guestCount > capacity) {
    throw new BadRequestException('预约人数不能超过空间容量');
  }
};

export const ensureReservationTimeWindow = (reservedAt: number): void => {
  const now = Date.now();
  if (reservedAt < now) {
    throw new BadRequestException('预约时间不能早于当前时间');
  }

  const current = new Date();
  const maxTimestamp = new Date(
    current.getFullYear(),
    current.getMonth(),
    current.getDate() + 2,
    23,
    59,
    59,
    999,
  ).getTime();

  if (reservedAt > maxTimestamp) {
    throw new BadRequestException('最多只能预约 2 天后的时间');
  }
};

export const ensureReservationEndAfterStart = (
  reservedAt: number,
  reservedEndAt: number,
): void => {
  if (reservedEndAt <= reservedAt) {
    throw new BadRequestException('离店时间必须晚于预约时间');
  }
};

export const findReservationTimeConflict = (
  reservations: SpaceReservationRecord[],
  reservedAt: number,
  reservedEndAt: number,
): SpaceReservationRecord | null => {
  const conflict = reservations.find((reservation) => {
    if (Date.now() >= reservation.reservedAt.getTime()) {
      return false;
    }

    const candidateEndAt = reservation.reservedEndAt
      ? reservation.reservedEndAt.getTime()
      : reservation.reservedAt.getTime() + 60 * 60 * 1000;

    return (
      reservedAt < candidateEndAt &&
      reservation.reservedAt.getTime() < reservedEndAt
    );
  });

  return conflict ?? null;
};

export const findNearestReservationMatch = (
  candidates: SpaceReservationRecord[],
  sessionStartTime: Date,
): SpaceReservationRecord | null => {
  if (candidates.length === 0) {
    return null;
  }

  // 使用展开运算符避免原地排序修改传入数组
  const nearest = [...candidates].sort(
    (left, right) =>
      Math.abs(left.reservedAt.getTime() - sessionStartTime.getTime()) -
      Math.abs(right.reservedAt.getTime() - sessionStartTime.getTime()),
  )[0];

  return nearest ?? null;
};

export const toSpaceReservationResponse = (
  reservation: SpaceReservationRecord,
): SpaceReservationResponseDto => {
  const reservedAtMs = toTimestampMs(reservation.reservedAt);
  return {
    id: String(reservation.id),
    spaceId: String(reservation.spaceId),
    guestName: reservation.guestName,
    phone: reservation.phone ?? '',
    reservedAt: reservedAtMs,
    ...(reservation.reservedEndAt
      ? { reservedEndAt: toTimestampMs(reservation.reservedEndAt) }
      : {}),
    ...(reservation.guestCount !== null
      ? { guestCount: reservation.guestCount }
      : {}),
    ...(reservation.note ? { note: reservation.note } : {}),
    status: toSpaceReservationStatusValue(reservation.status),
    createdAt: toTimestampMs(reservation.createdAt),
    isOverdue: Date.now() >= reservedAtMs,
  };
};

export const getTodayRange = (): { start: Date; end: Date } => {
  const now = new Date();
  const start = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    0,
    0,
    0,
    0,
  );
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);

  return { start, end };
};

const RESERVATION_STATUS_MAP: Record<
  PrismaSpaceReservationStatus,
  SpaceReservationStatusValue
> = {
  [PrismaSpaceReservationStatus.pending]: 'pending',
  [PrismaSpaceReservationStatus.fulfilled]: 'fulfilled',
  [PrismaSpaceReservationStatus.cancelled]: 'cancelled',
};

const toSpaceReservationStatusValue = (
  status: PrismaSpaceReservationStatus,
): SpaceReservationStatusValue => {
  const mapped = RESERVATION_STATUS_MAP[status];
  if (!mapped) {
    throw new Error(`Unknown reservation status: ${status}`);
  }
  return mapped;
};

const assertPositiveInteger = (value: number, label: string): void => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new BadRequestException(`${label}必须是大于 0 的整数`);
  }
};

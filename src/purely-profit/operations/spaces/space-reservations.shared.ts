import { BadRequestException } from '@nestjs/common';
import {
  Prisma,
  SpaceReservationStatus as PrismaSpaceReservationStatus,
} from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';
import { toTimestampMs } from '../../commerce/commerce.utils';
import type { SpaceReservationResponseDto } from './dto/space-reservation.dto';
import type {
  NormalizedSpaceReservationPayload,
  SpaceReservationDateFilter,
  SpaceReservationMutationDto,
  SpaceReservationRecord,
} from './space-reservations.types';
import type {
  SpaceReservationStatusValue,
  SpaceStatusValue,
} from './spaces.constants';

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

  // B3 fix + P3 fix: 防御性校验 reservedAt / reservedEndAt 必须为有效数值，避免 new Date(undefined) = Invalid Date
  if (!Number.isFinite(dto.reservedAt)) {
    throw new BadRequestException('预约时间必须是有效的时间戳');
  }
  if (!Number.isFinite(dto.reservedEndAt)) {
    throw new BadRequestException('预约结束时间必须是有效的时间戳');
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

  const shanghaiNow = getShanghaiDateParts();
  const maxTimestamp = Date.UTC(
    shanghaiNow.year,
    shanghaiNow.month - 1,
    shanghaiNow.day + 2,
    23 - SHANGHAI_OFFSET_HOURS,
    59,
    59,
    999,
  );

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

/** 上海时区相对 UTC 的固定偏移（小时），中国无夏令时 */
const SHANGHAI_OFFSET_HOURS = 8;

/**
 * 获取当前上海时区的日期部分（年/月/日）。
 * 使用 Intl.DateTimeFormat 保证跨平台一致性。
 */
const getShanghaiDateParts = (): {
  year: number;
  month: number;
  day: number;
} => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)!.value);

  return { year: get('year'), month: get('month'), day: get('day') };
};

/**
 * 获取上海时区“今天”的 [00:00:00.000, 23:59:59.999] 时间范围。
 * 所有"今日"统计/状态判定必须使用此函数，禁止使用服务器本地时区。
 */
export const getTodayRange = (): { start: Date; end: Date } => {
  const { year, month, day } = getShanghaiDateParts();
  const start = new Date(
    Date.UTC(year, month - 1, day, -SHANGHAI_OFFSET_HOURS),
  );
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
  return { start, end };
};

/**
 * 获取上海时区“今天 ~ 今天+2天”的时间范围。
 * 用于空间 reserved 状态判定，与预约创建窗口（ensureReservationTimeWindow）对齐。
 */
export const getReservationStatusRange = (): {
  start: Date;
  end: Date;
} => {
  const { year, month, day } = getShanghaiDateParts();
  const start = new Date(
    Date.UTC(year, month - 1, day, -SHANGHAI_OFFSET_HOURS),
  );
  // 今天 +2 天的 23:59:59.999（上海时间）
  const end = new Date(
    Date.UTC(year, month - 1, day + 2, 23 - SHANGHAI_OFFSET_HOURS, 59, 59, 999),
  );
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

/**
 * 查找与指定时间段冲突的 pending 预约。
 * 业务规则：已过时的预约（reservedAt <= now）不再参与冲突占位。
 *
 * BUG-3 fix: reservedEndAt 在 schema 中为 DateTime?（可空），
 * Prisma 的 gt 比较会排除 NULL 行，因此对 reservedEndAt=null 的预约
 * 回退为 reservedAt + 1h 参与冲突判定。
 */
export const findReservationConflict = async (
  client: PrismaService | Prisma.TransactionClient,
  spaceId: number,
  reservedAt: number,
  reservedEndAt: number,
  excludeReservationId?: number,
): Promise<SpaceReservationRecord | null> => {
  const now = new Date();
  const DEFAULT_WINDOW_MS = 60 * 60 * 1000;
  const nullEndAtCutoff = new Date(reservedAt - DEFAULT_WINDOW_MS);

  const where: Prisma.SpaceReservationWhereInput = {
    spaceId,
    status: PrismaSpaceReservationStatus.pending,
    reservedAt: {
      lt: new Date(reservedEndAt),
      gt: now, // ← 排除已过时的预约
    },
    AND: [
      {
        OR: [
          { reservedEndAt: { gt: new Date(reservedAt) } },
          // reservedEndAt 为 null 时，回退为 reservedAt + 1h
          {
            reservedEndAt: null,
            reservedAt: { gt: nullEndAtCutoff },
          },
        ],
      },
    ],
    ...(excludeReservationId !== undefined
      ? {
          id: {
            not: excludeReservationId,
          },
        }
      : {}),
  };

  const conflict = await client.spaceReservation.findFirst({
    where,
    orderBy: [{ reservedAt: 'asc' }, { id: 'asc' }],
  });

  return conflict as SpaceReservationRecord | null;
};

/**
 * 空间运行态状态推导（共享权威实现）。
 * 优先级链：occupied > reserved > cleaning > idle
 *
 * BUG-6 fix: 收敛 spaces-read / dashboard / reservations-state 三处重复实现为单一权威函数，
 * 避免口径漂移（如脏房阈值、预约时间窗口变更时漏改）。
 */
export const deriveSpaceStatusFromCounts = (params: {
  activeSessions: number;
  pendingReservations: number;
  enableDirtyRoom: boolean;
  lastSettledEndTime: Date | null;
  cleanedAt: Date | null;
}): SpaceStatusValue => {
  if (params.activeSessions > 0) return 'occupied';
  if (params.pendingReservations > 0) return 'reserved';
  // 脏房模式：结账后无活跃会话，且尚未标记清洁完成 → cleaning
  if (params.enableDirtyRoom && params.lastSettledEndTime !== null) {
    const cleanedMs = params.cleanedAt?.getTime() ?? 0;
    if (params.lastSettledEndTime.getTime() > cleanedMs) return 'cleaning';
  }
  return 'idle';
};

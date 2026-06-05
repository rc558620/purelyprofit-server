import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  SpaceReservationStatus as PrismaSpaceReservationStatus,
  SpaceStatus as PrismaSpaceStatus,
} from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { toTimestampMs } from '../../commerce/commerce.utils';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  CreateSpaceReservationDto,
  ListSpaceReservationsQueryDto,
  type SpaceReservationResponseDto,
  UpdateSpaceReservationDto,
} from './dto/space-reservation.dto';
import { SpaceSessionSettlementService } from './space-session-settlement.service';
import type { SpaceReservationStatusValue } from './spaces.constants';

const SPACE_CONTACT_PATTERN = /^[0-9+\-\s]{6,20}$/;

interface SpaceReservationRecord {
  id: number;
  spaceId: number;
  guestName: string;
  phone: string | null;
  reservedAt: Date;
  reservedEndAt: Date | null;
  guestCount: number | null;
  note: string | null;
  status: PrismaSpaceReservationStatus;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class SpaceReservationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly settlementService: SpaceSessionSettlementService,
  ) {}

  async listSpaceReservations(
    user: AuthenticatedUser,
    spaceId: number,
    query: ListSpaceReservationsQueryDto,
  ): Promise<SpaceReservationResponseDto[]> {
    const space = await this.prisma.space.findUnique({
      where: { id: spaceId },
      select: {
        id: true,
        storeId: true,
      },
    });

    if (!space) {
      throw new NotFoundException('空间不存在');
    }

    await this.commerceAccessService.ensureCanAccessStore(
      user,
      space.storeId,
      'space:view',
      '无权查看该门店空间预约',
    );

    await this.settlementService.autoCheckoutExpiredCountdownSessions(
      user,
      space.storeId,
    );

    if (
      query.dateFrom !== undefined &&
      query.dateTo !== undefined &&
      query.dateFrom > query.dateTo
    ) {
      throw new BadRequestException('区间开始时间不能晚于结束时间');
    }

    const status = query.status ?? 'pending';
    const items = await this.prisma.spaceReservation.findMany({
      where: {
        spaceId: space.id,
        status,
        ...(query.dateFrom !== undefined || query.dateTo !== undefined
          ? {
              reservedAt: {
                ...(query.dateFrom !== undefined
                  ? { gte: new Date(query.dateFrom) }
                  : {}),
                ...(query.dateTo !== undefined
                  ? { lte: new Date(query.dateTo) }
                  : {}),
              },
            }
          : {}),
      },
      orderBy: [{ reservedAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });

    return items.map((item) => this.toSpaceReservationResponse(item));
  }

  async listStoreSpaceReservations(
    user: AuthenticatedUser,
    query: ListSpaceReservationsQueryDto,
  ): Promise<SpaceReservationResponseDto[]> {
    const storeId = await this.commerceAccessService.resolveViewStoreId(
      user,
      query.storeId,
      'space:view',
      '无权查看该门店空间预约',
    );

    if (storeId === null) {
      return [];
    }

    await this.settlementService.autoCheckoutExpiredCountdownSessions(
      user,
      storeId,
    );

    if (
      query.dateFrom !== undefined &&
      query.dateTo !== undefined &&
      query.dateFrom > query.dateTo
    ) {
      throw new BadRequestException('区间开始时间不能晚于结束时间');
    }

    const status = query.status ?? PrismaSpaceReservationStatus.pending;
    const items = await this.prisma.spaceReservation.findMany({
      where: {
        storeId,
        status,
        ...(query.dateFrom !== undefined || query.dateTo !== undefined
          ? {
              reservedAt: {
                ...(query.dateFrom !== undefined
                  ? { gte: new Date(query.dateFrom) }
                  : {}),
                ...(query.dateTo !== undefined
                  ? { lte: new Date(query.dateTo) }
                  : {}),
              },
            }
          : {}),
      },
      orderBy: [{ reservedAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });

    return items.map((item) => this.toSpaceReservationResponse(item));
  }

  async createSpaceReservation(
    user: AuthenticatedUser,
    spaceId: number,
    dto: CreateSpaceReservationDto,
  ): Promise<SpaceReservationResponseDto> {
    const space = await this.prisma.space.findUnique({
      where: { id: spaceId },
      select: {
        id: true,
        storeId: true,
        capacity: true,
      },
    });

    if (!space) {
      throw new NotFoundException('空间不存在');
    }

    await this.commerceAccessService.ensureCanAccessStore(
      user,
      space.storeId,
      'space:create',
      '无权操作该门店空间预约',
    );

    const payload = this.normalizeReservationPayload(dto);
    this.ensureReservationGuestCount(
      payload.guestCount,
      space.capacity ?? undefined,
    );
    this.ensureReservationTimeWindow(payload.reservedAt);
    this.ensureReservationEndAfterStart(
      payload.reservedAt,
      payload.reservedEndAt,
    );

    const conflict = await this.findReservationConflict(
      space.id,
      payload.reservedAt,
      payload.reservedEndAt,
    );

    if (conflict) {
      throw new ConflictException(`与「${conflict.guestName}」的预约时间冲突`);
    }

    const reservation = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.spaceReservation.create({
        data: {
          storeId: space.storeId,
          spaceId: space.id,
          guestName: payload.guestName,
          phone: payload.phone,
          reservedAt: new Date(payload.reservedAt),
          reservedEndAt: new Date(payload.reservedEndAt),
          guestCount: payload.guestCount,
          note: payload.note,
          status: PrismaSpaceReservationStatus.pending,
        },
      });

      await this.syncNonOccupiedSpaceStatus(transaction, space.id);
      return created;
    });

    return this.toSpaceReservationResponse(reservation);
  }

  async updateSpaceReservation(
    user: AuthenticatedUser,
    reservationId: number,
    dto: UpdateSpaceReservationDto,
  ): Promise<SpaceReservationResponseDto> {
    const reservation = await this.prisma.spaceReservation.findUnique({
      where: { id: reservationId },
      select: {
        id: true,
        storeId: true,
        spaceId: true,
        status: true,
        space: {
          select: {
            capacity: true,
          },
        },
      },
    });

    if (!reservation) {
      throw new NotFoundException('预约不存在');
    }

    await this.commerceAccessService.ensureCanAccessStore(
      user,
      reservation.storeId,
      'space:update',
      '无权操作该门店空间预约',
    );

    if (reservation.status !== PrismaSpaceReservationStatus.pending) {
      throw new ConflictException('当前预约已处理，无法修改');
    }

    const payload = this.normalizeReservationPayload(dto);
    this.ensureReservationGuestCount(
      payload.guestCount,
      reservation.space.capacity ?? undefined,
    );
    this.ensureReservationTimeWindow(payload.reservedAt);
    this.ensureReservationEndAfterStart(
      payload.reservedAt,
      payload.reservedEndAt,
    );

    const conflict = await this.findReservationConflict(
      reservation.spaceId,
      payload.reservedAt,
      payload.reservedEndAt,
      reservation.id,
    );

    if (conflict) {
      throw new ConflictException(`与「${conflict.guestName}」的预约时间冲突`);
    }

    const updated = await this.prisma.$transaction(async (transaction) => {
      const nextReservation = await transaction.spaceReservation.update({
        where: { id: reservation.id },
        data: {
          guestName: payload.guestName,
          phone: payload.phone,
          reservedAt: new Date(payload.reservedAt),
          reservedEndAt: new Date(payload.reservedEndAt),
          guestCount: payload.guestCount,
          note: payload.note,
        },
      });

      await this.syncNonOccupiedSpaceStatus(transaction, reservation.spaceId);
      return nextReservation;
    });

    return this.toSpaceReservationResponse(updated);
  }

  async cancelSpaceReservation(
    user: AuthenticatedUser,
    reservationId: number,
  ): Promise<SpaceReservationResponseDto> {
    const reservation = await this.prisma.spaceReservation.findUnique({
      where: { id: reservationId },
      select: {
        id: true,
        storeId: true,
        spaceId: true,
        status: true,
      },
    });

    if (!reservation) {
      throw new NotFoundException('预约不存在');
    }

    await this.commerceAccessService.ensureCanAccessStore(
      user,
      reservation.storeId,
      'space:update',
      '无权操作该门店空间预约',
    );

    if (reservation.status !== PrismaSpaceReservationStatus.pending) {
      throw new ConflictException('当前预约已处理，无法取消');
    }

    const updated = await this.prisma.$transaction(async (transaction) => {
      const nextReservation = await transaction.spaceReservation.update({
        where: { id: reservation.id },
        data: {
          status: PrismaSpaceReservationStatus.cancelled,
        },
      });

      await this.syncNonOccupiedSpaceStatus(transaction, reservation.spaceId);
      return nextReservation;
    });

    return this.toSpaceReservationResponse(updated);
  }

  // ─── Shared helpers used by SpaceSessionsService ───────────────────────────

  async ensureReservationCanBeFulfilled(
    storeId: number,
    spaceId: number,
    reservationId: number,
  ): Promise<void> {
    const reservation = await this.prisma.spaceReservation.findUnique({
      where: { id: reservationId },
      select: {
        id: true,
        storeId: true,
        spaceId: true,
        status: true,
      },
    });

    if (!reservation) {
      throw new NotFoundException('预约不存在');
    }
    if (reservation.storeId !== storeId || reservation.spaceId !== spaceId) {
      throw new ConflictException('该预约不属于当前空间，无法履约开台');
    }
    if (reservation.status !== PrismaSpaceReservationStatus.pending) {
      throw new ConflictException('当前预约已处理，无法再次履约开台');
    }
  }

  async resolveReservationBackStatus(
    transaction: Prisma.TransactionClient,
    spaceId: number,
  ): Promise<PrismaSpaceStatus> {
    const todayRange = this.getTodayRange();
    const hasTodayPendingReservation =
      await transaction.spaceReservation.findFirst({
        where: {
          spaceId,
          status: PrismaSpaceReservationStatus.pending,
          reservedAt: {
            gte: todayRange.start,
            lte: todayRange.end,
          },
        },
        select: {
          id: true,
        },
      });

    return hasTodayPendingReservation
      ? PrismaSpaceStatus.reserved
      : PrismaSpaceStatus.idle;
  }

  async syncNonOccupiedSpaceStatus(
    transaction: Prisma.TransactionClient,
    spaceId: number,
  ): Promise<void> {
    const current = await transaction.space.findUnique({
      where: { id: spaceId },
      select: {
        id: true,
        status: true,
      },
    });

    if (!current) {
      throw new NotFoundException('空间不存在');
    }

    if (
      current.status === PrismaSpaceStatus.occupied ||
      current.status === PrismaSpaceStatus.cleaning
    ) {
      return;
    }

    const nextStatus = await this.resolveReservationBackStatus(
      transaction,
      spaceId,
    );

    if (nextStatus !== current.status) {
      await transaction.space.update({
        where: { id: spaceId },
        data: { status: nextStatus },
      });
    }
  }

  async cancelMatchedReservationAfterCheckout(
    transaction: Prisma.TransactionClient,
    session: {
      reservationId: number | null;
      guestName: string | null;
      guestPhone: string | null;
      spaceId: number;
      startTime: Date;
    },
  ): Promise<number | null> {
    if (session.reservationId !== null) {
      return null;
    }

    const guestName = session.guestName?.trim();
    const guestPhone = session.guestPhone?.trim();
    if (!guestName || !guestPhone) {
      return null;
    }

    const todayRange = this.getTodayRange();
    const candidates = await transaction.spaceReservation.findMany({
      where: {
        spaceId: session.spaceId,
        status: PrismaSpaceReservationStatus.pending,
        guestName,
        phone: guestPhone,
        reservedAt: {
          gte: todayRange.start,
          lte: todayRange.end,
        },
      },
      orderBy: [{ reservedAt: 'asc' }, { id: 'asc' }],
    });

    const nearest = candidates.sort(
      (a, b) =>
        Math.abs(a.reservedAt.getTime() - session.startTime.getTime()) -
        Math.abs(b.reservedAt.getTime() - session.startTime.getTime()),
    )[0];

    if (!nearest) {
      return null;
    }

    await transaction.spaceReservation.update({
      where: { id: nearest.id },
      data: {
        status: PrismaSpaceReservationStatus.cancelled,
      },
    });

    return nearest.id;
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private normalizeReservationPayload(
    dto: CreateSpaceReservationDto | UpdateSpaceReservationDto,
  ): {
    guestName: string;
    phone: string;
    reservedAt: number;
    reservedEndAt: number;
    guestCount?: number;
    note?: string;
  } {
    const guestName = dto.guestName.trim();
    const phone = dto.phone.trim();
    if (!guestName) {
      throw new BadRequestException('预约人姓名不能为空');
    }
    if (!phone) {
      throw new BadRequestException('联系方式不能为空');
    }

    const reservedAt = dto.reservedAt;
    const reservedEndAt = dto.reservedEndAt;
    const note = dto.note?.trim();

    if (!this.isValidContact(phone)) {
      throw new BadRequestException(
        '联系方式格式不正确，请输入 6-20 位数字或常见联系电话格式',
      );
    }

    return {
      guestName,
      phone,
      reservedAt,
      reservedEndAt,
      ...(dto.guestCount !== undefined ? { guestCount: dto.guestCount } : {}),
      ...(note ? { note } : {}),
    };
  }

  private ensureReservationGuestCount(
    guestCount: number | undefined,
    capacity?: number,
  ): void {
    if (guestCount === undefined) {
      return;
    }

    this.assertPositiveInteger(guestCount, '预约人数');
    if (capacity !== undefined && guestCount > capacity) {
      throw new BadRequestException('预约人数不能超过空间容量');
    }
  }

  private ensureReservationTimeWindow(reservedAt: number): void {
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
  }

  private ensureReservationEndAfterStart(
    reservedAt: number,
    reservedEndAt: number,
  ): void {
    if (reservedEndAt <= reservedAt) {
      throw new BadRequestException('离店时间必须晚于预约时间');
    }
  }

  private isReservationExpiredForConflict(reservedAt: Date): boolean {
    return Date.now() >= reservedAt.getTime();
  }

  private async findReservationConflict(
    spaceId: number,
    reservedAt: number,
    reservedEndAt: number,
    excludeReservationId?: number,
  ): Promise<SpaceReservationRecord | null> {
    const reservations = await this.prisma.spaceReservation.findMany({
      where: {
        spaceId,
        status: PrismaSpaceReservationStatus.pending,
        ...(excludeReservationId !== undefined
          ? {
              id: {
                not: excludeReservationId,
              },
            }
          : {}),
      },
      orderBy: [{ reservedAt: 'asc' }, { id: 'asc' }],
    });

    const conflict = reservations.find((reservation) => {
      if (this.isReservationExpiredForConflict(reservation.reservedAt)) {
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
  }

  toSpaceReservationResponse(
    reservation: SpaceReservationRecord,
  ): SpaceReservationResponseDto {
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
      status: this.toSpaceReservationStatusValue(reservation.status),
      createdAt: toTimestampMs(reservation.createdAt),
      isOverdue: Date.now() >= reservedAtMs,
    };
  }

  private toSpaceReservationStatusValue(
    status: PrismaSpaceReservationStatus,
  ): SpaceReservationStatusValue {
    return status;
  }

  private isValidContact(value: string): boolean {
    return SPACE_CONTACT_PATTERN.test(value);
  }

  private assertPositiveInteger(value: number, label: string): void {
    if (!Number.isInteger(value) || value <= 0) {
      throw new BadRequestException(`${label}必须是大于 0 的整数`);
    }
  }

  getTodayRange(): { start: Date; end: Date } {
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
  }
}

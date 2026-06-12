import {
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
import { PrismaService } from '../../../prisma/prisma.service';
import {
  CreateSpaceReservationDto,
  ListSpaceReservationsQueryDto,
  type SpaceReservationResponseDto,
  UpdateSpaceReservationDto,
} from './dto/space-reservation.dto';
import {
  buildReservationReservedAtFilter,
  ensureReservationDateRange,
  ensureReservationEndAfterStart,
  ensureReservationGuestCount,
  ensureReservationTimeWindow,
  findReservationTimeConflict,
  normalizeReservationPayload,
  toSpaceReservationResponse,
} from './space-reservations.shared';
import { SpaceReservationsStateService } from './space-reservations-state.service';
import type {
  SpaceReservationRecord,
  SpaceReservationSessionSnapshot,
} from './space-reservations.types';
@Injectable()
export class SpaceReservationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly stateService: SpaceReservationsStateService,
  ) {}

  async listSpaceReservations(
    user: AuthenticatedUser,
    spaceId: number,
    query: ListSpaceReservationsQueryDto,
    requestId?: string,
  ): Promise<SpaceReservationResponseDto[]> {
    void requestId;
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

    ensureReservationDateRange(query.dateFrom, query.dateTo);
    const reservedAt = buildReservationReservedAtFilter(
      query.dateFrom,
      query.dateTo,
    );
    const status = query.status ?? PrismaSpaceReservationStatus.pending;
    const items = await this.prisma.spaceReservation.findMany({
      where: {
        spaceId: space.id,
        status,
        ...(reservedAt ? { reservedAt } : {}),
      },
      orderBy: [{ reservedAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });

    return items.map((item) => this.toSpaceReservationResponse(item));
  }

  async listStoreSpaceReservations(
    user: AuthenticatedUser,
    query: ListSpaceReservationsQueryDto,
    requestId?: string,
  ): Promise<SpaceReservationResponseDto[]> {
    void requestId;
    const storeId = await this.commerceAccessService.resolveViewStoreId(
      user,
      query.storeId,
      'space:view',
      '无权查看该门店空间预约',
    );

    if (storeId === null) {
      return [];
    }

    ensureReservationDateRange(query.dateFrom, query.dateTo);
    const reservedAt = buildReservationReservedAtFilter(
      query.dateFrom,
      query.dateTo,
    );
    const status = query.status ?? PrismaSpaceReservationStatus.pending;
    const items = await this.prisma.spaceReservation.findMany({
      where: {
        storeId,
        status,
        ...(reservedAt ? { reservedAt } : {}),
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

    const payload = normalizeReservationPayload(dto);
    ensureReservationGuestCount(
      payload.guestCount,
      space.capacity ?? undefined,
    );
    ensureReservationTimeWindow(payload.reservedAt);
    ensureReservationEndAfterStart(payload.reservedAt, payload.reservedEndAt);

    const conflict = await this.findReservationConflict(
      this.prisma,
      space.id,
      payload.reservedAt,
      payload.reservedEndAt,
    );

    if (conflict) {
      throw new ConflictException(`与「${conflict.guestName}」的预约时间冲突`);
    }

    const reservation = await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT id
        FROM spaces
        WHERE id = ${space.id}
        FOR UPDATE
      `;

      const latestSpace = await transaction.space.findUnique({
        where: { id: space.id },
        select: {
          id: true,
          storeId: true,
          capacity: true,
        },
      });

      if (!latestSpace) {
        throw new NotFoundException('空间不存在');
      }

      ensureReservationGuestCount(
        payload.guestCount,
        latestSpace.capacity ?? undefined,
      );

      const latestConflict = await this.findReservationConflict(
        transaction,
        latestSpace.id,
        payload.reservedAt,
        payload.reservedEndAt,
      );

      if (latestConflict) {
        throw new ConflictException(
          `与「${latestConflict.guestName}」的预约时间冲突`,
        );
      }

      const created = await transaction.spaceReservation.create({
        data: {
          storeId: latestSpace.storeId,
          spaceId: latestSpace.id,
          guestName: payload.guestName,
          phone: payload.phone,
          reservedAt: new Date(payload.reservedAt),
          reservedEndAt: new Date(payload.reservedEndAt),
          guestCount: payload.guestCount,
          note: payload.note,
          status: PrismaSpaceReservationStatus.pending,
        },
      });

      await this.syncNonOccupiedSpaceStatus(transaction, latestSpace.id);
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

    const payload = normalizeReservationPayload(dto);
    ensureReservationGuestCount(
      payload.guestCount,
      reservation.space.capacity ?? undefined,
    );
    ensureReservationTimeWindow(payload.reservedAt);
    ensureReservationEndAfterStart(payload.reservedAt, payload.reservedEndAt);

    const conflict = await this.findReservationConflict(
      this.prisma,
      reservation.spaceId,
      payload.reservedAt,
      payload.reservedEndAt,
      reservation.id,
    );

    if (conflict) {
      throw new ConflictException(`与「${conflict.guestName}」的预约时间冲突`);
    }

    const updated = await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT id
        FROM spaces
        WHERE id = ${reservation.spaceId}
        FOR UPDATE
      `;
      await transaction.$queryRaw`
        SELECT id
        FROM space_reservations
        WHERE id = ${reservation.id}
        FOR UPDATE
      `;

      const latestSpace = await transaction.space.findUnique({
        where: { id: reservation.spaceId },
        select: {
          id: true,
          capacity: true,
        },
      });
      if (!latestSpace) {
        throw new NotFoundException('空间不存在');
      }

      const latestReservation = await transaction.spaceReservation.findUnique({
        where: { id: reservation.id },
        select: {
          id: true,
          spaceId: true,
          status: true,
        },
      });

      if (!latestReservation) {
        throw new NotFoundException('预约不存在');
      }
      if (latestReservation.status !== PrismaSpaceReservationStatus.pending) {
        throw new ConflictException('当前预约已处理，无法修改');
      }

      ensureReservationGuestCount(
        payload.guestCount,
        latestSpace.capacity ?? undefined,
      );

      const latestConflict = await this.findReservationConflict(
        transaction,
        latestReservation.spaceId,
        payload.reservedAt,
        payload.reservedEndAt,
        latestReservation.id,
      );

      if (latestConflict) {
        throw new ConflictException(
          `与「${latestConflict.guestName}」的预约时间冲突`,
        );
      }

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

      await this.syncNonOccupiedSpaceStatus(
        transaction,
        latestReservation.spaceId,
      );
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
      await transaction.$queryRaw`
        SELECT id
        FROM spaces
        WHERE id = ${reservation.spaceId}
        FOR UPDATE
      `;
      await transaction.$queryRaw`
        SELECT id
        FROM space_reservations
        WHERE id = ${reservation.id}
        FOR UPDATE
      `;

      const latestReservation = await transaction.spaceReservation.findUnique({
        where: { id: reservation.id },
        select: {
          id: true,
          spaceId: true,
          status: true,
        },
      });

      if (!latestReservation) {
        throw new NotFoundException('预约不存在');
      }
      if (latestReservation.status !== PrismaSpaceReservationStatus.pending) {
        throw new ConflictException('当前预约已处理，无法取消');
      }

      const nextReservation = await transaction.spaceReservation.update({
        where: { id: reservation.id },
        data: {
          status: PrismaSpaceReservationStatus.cancelled,
        },
      });

      await this.syncNonOccupiedSpaceStatus(
        transaction,
        latestReservation.spaceId,
      );
      return nextReservation;
    });

    return this.toSpaceReservationResponse(updated);
  }

  async ensureReservationCanBeFulfilled(
    storeId: number,
    spaceId: number,
    reservationId: number,
  ): Promise<void> {
    await this.stateService.ensureReservationCanBeFulfilled(
      storeId,
      spaceId,
      reservationId,
    );
  }

  async resolveReservationBackStatus(
    transaction: Prisma.TransactionClient,
    spaceId: number,
  ): Promise<PrismaSpaceStatus> {
    return this.stateService.resolveReservationBackStatus(transaction, spaceId);
  }

  async syncNonOccupiedSpaceStatus(
    transaction: Prisma.TransactionClient,
    spaceId: number,
  ): Promise<void> {
    await this.stateService.syncNonOccupiedSpaceStatus(transaction, spaceId);
  }

  async cancelMatchedReservationAfterCheckout(
    transaction: Prisma.TransactionClient,
    session: SpaceReservationSessionSnapshot,
  ): Promise<number | null> {
    return this.stateService.cancelMatchedReservationAfterCheckout(
      transaction,
      session,
    );
  }

  toSpaceReservationResponse(
    reservation: SpaceReservationRecord,
  ): SpaceReservationResponseDto {
    return toSpaceReservationResponse(reservation);
  }

  private async findReservationConflict(
    client: PrismaService | Prisma.TransactionClient,
    spaceId: number,
    reservedAt: number,
    reservedEndAt: number,
    excludeReservationId?: number,
  ): Promise<SpaceReservationRecord | null> {
    const reservations = await client.spaceReservation.findMany({
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

    return findReservationTimeConflict(
      reservations as SpaceReservationRecord[],
      reservedAt,
      reservedEndAt,
    );
  }
}

import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  SpaceReservationStatus as PrismaSpaceReservationStatus,
} from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../../redis/invalidator';
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
  normalizeReservationPayload,
  toSpaceReservationResponse,
} from './space-reservations.shared';
import { SpaceReservationsStateService } from './space-reservations-state.service';
import type {
  SpaceReservationRecord,
  SpaceReservationSessionSnapshot,
} from './space-reservations.types';
import type { SpaceStatusValue } from './spaces.constants';
@Injectable()
export class SpaceReservationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly stateService: SpaceReservationsStateService,
    private readonly cacheInvalidatorService: CacheInvalidatorService,
  ) {}

  async listSpaceReservations(
    user: AuthenticatedUser,
    spaceId: number,
    query: ListSpaceReservationsQueryDto,
    requestId?: string,
  ): Promise<SpaceReservationResponseDto[]> {
    void requestId;
    // B1 fix: 软删除空间不可查看预约，与 listSpaces 的 deletedAt: null 口径一致
    const space = await this.prisma.space.findFirst({
      where: { id: spaceId, deletedAt: null },
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
      take: 200,
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
        // P1 fix: 排除已软删除空间的预约，与空间维度 listSpaceReservations 的 deletedAt: null 口径一致
        space: { deletedAt: null },
        ...(reservedAt ? { reservedAt } : {}),
      },
      orderBy: [{ reservedAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      take: 200,
    });

    return items.map((item) => this.toSpaceReservationResponse(item));
  }

  async createSpaceReservation(
    user: AuthenticatedUser,
    spaceId: number,
    dto: CreateSpaceReservationDto,
  ): Promise<SpaceReservationResponseDto> {
    // B1 fix: 软删除空间不可创建预约，与 listSpaces 的 deletedAt: null 口径一致
    const space = await this.prisma.space.findFirst({
      where: { id: spaceId, deletedAt: null },
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

      return created;
    });

    // 首页动态依赖预约数据（预约/包间即将开始）
    await this.cacheInvalidatorService.invalidateProfitDashboardHome(
      reservation.storeId,
    );

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

      return nextReservation;
    });

    // 首页动态依赖预约数据（预约/包间即将开始）
    await this.cacheInvalidatorService.invalidateProfitDashboardHome(
      reservation.storeId,
    );

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

      return nextReservation;
    });

    // 首页动态依赖预约数据（预约/包间即将开始）
    await this.cacheInvalidatorService.invalidateProfitDashboardHome(
      reservation.storeId,
    );

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
    enableDirtyRoom?: boolean,
  ): Promise<SpaceStatusValue> {
    return this.stateService.resolveReservationBackStatus(
      transaction,
      spaceId,
      enableDirtyRoom,
    );
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
    // 业务规则：已过时的预约（reservedAt <= now）不再参与冲突占位
    // 允许用户在已过时预约的时间段内创建新预约
    const now = new Date();

    // BUG-3 fix: reservedEndAt 在 schema 中为 DateTime?（可空）
    // Prisma 的 gt 比较会排除 NULL 行，因此对 reservedEndAt=null 的预约
    // 回退为 reservedAt + 1h 参与冲突判定，与内存版逻辑口径一致
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
  }
}

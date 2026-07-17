import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SpaceReservationStatus as PrismaSpaceReservationStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../../redis/invalidator';
import {
  CreateSpaceReservationDto,
  type SpaceReservationResponseDto,
  UpdateSpaceReservationDto,
} from './dto/space-reservation.dto';
import {
  ensureReservationEndAfterStart,
  ensureReservationGuestCount,
  ensureReservationTimeWindow,
  findReservationConflict,
  normalizeReservationPayload,
  toSpaceReservationResponse,
} from './space-reservations.shared';

@Injectable()
export class SpaceReservationsWriteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly cacheInvalidatorService: CacheInvalidatorService,
  ) {}

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

    const conflict = await findReservationConflict(
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

      const latestConflict = await findReservationConflict(
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

    return toSpaceReservationResponse(reservation);
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

    const conflict = await findReservationConflict(
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

      const latestConflict = await findReservationConflict(
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

    return toSpaceReservationResponse(updated);
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

    return toSpaceReservationResponse(updated);
  }
}

import { Injectable, NotFoundException } from '@nestjs/common';
import {
  Prisma,
  SpaceReservationStatus as PrismaSpaceReservationStatus,
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
  getReservationStatusRange,
  toSpaceReservationResponse,
} from './space-reservations.shared';
import { SpaceReservationsStateService } from './space-reservations-state.service';
import { SpaceReservationsWriteService } from './space-reservations-write.service';
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
    private readonly writeService: SpaceReservationsWriteService,
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
    // 看板查询不带日期时默认收敛到「今天 00:00 ～ 今天+2 天」业务窗口：
    // 该查询按 reservedAt 升序取前 200 条待处理预约，历史未处理记录一旦积压到
    // 上限，今天与未来的新预约会被整体挤掉，看板表现为「没有预约」。
    // 历史预约仍可通过显式传 dateFrom/dateTo 分页查询。
    // 只对「待处理」收敛窗口：cancelled / fulfilled 是历史查询，不能被窗口截断。
    const status = query.status ?? PrismaSpaceReservationStatus.pending;
    const isPendingOnly = status === PrismaSpaceReservationStatus.pending;
    const defaultRange = isPendingOnly ? getReservationStatusRange() : null;
    const scopedReservedAt =
      reservedAt ??
      (defaultRange
        ? { gte: defaultRange.start, lte: defaultRange.end }
        : undefined);
    const items = await this.prisma.spaceReservation.findMany({
      where: {
        storeId,
        status,
        // P1 fix: 排除已软删除空间的预约，与空间维度 listSpaceReservations 的 deletedAt: null 口径一致
        space: { deletedAt: null },
        ...(scopedReservedAt ? { reservedAt: scopedReservedAt } : {}),
      },
      orderBy: [{ reservedAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      take: 200,
    });

    return items.map((item) => this.toSpaceReservationResponse(item));
  }

  createSpaceReservation(
    user: AuthenticatedUser,
    spaceId: number,
    dto: CreateSpaceReservationDto,
  ): Promise<SpaceReservationResponseDto> {
    return this.writeService.createSpaceReservation(user, spaceId, dto);
  }

  updateSpaceReservation(
    user: AuthenticatedUser,
    reservationId: number,
    dto: UpdateSpaceReservationDto,
  ): Promise<SpaceReservationResponseDto> {
    return this.writeService.updateSpaceReservation(user, reservationId, dto);
  }

  cancelSpaceReservation(
    user: AuthenticatedUser,
    reservationId: number,
  ): Promise<SpaceReservationResponseDto> {
    return this.writeService.cancelSpaceReservation(user, reservationId);
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
}

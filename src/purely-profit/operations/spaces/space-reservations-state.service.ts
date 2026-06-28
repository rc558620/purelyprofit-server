import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  SpaceReservationStatus as PrismaSpaceReservationStatus,
  SpaceSessionStatus as PrismaSpaceSessionStatus,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  findNearestReservationMatch,
  getTodayRange,
} from './space-reservations.shared';
import type {
  SpaceReservationRecord,
  SpaceReservationSessionSnapshot,
} from './space-reservations.types';
import type { SpaceStatusValue } from './spaces.constants';

/**
 * 空间状态枚举值（与已移除的 Prisma.SpaceStatus 保持兼容）
 * 用于运行态推导返回值，不写入数据库
 */
export const SpaceStatusValues = {
  idle: 'idle',
  occupied: 'occupied',
  reserved: 'reserved',
  cleaning: 'cleaning',
} as const;

export type InternalSpaceStatus =
  (typeof SpaceStatusValues)[keyof typeof SpaceStatusValues];

@Injectable()
export class SpaceReservationsStateService {
  constructor(private readonly prisma: PrismaService) {}

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

  async hasActiveSession(
    transaction: Prisma.TransactionClient,
    spaceId: number,
  ): Promise<boolean> {
    const activeSession = await transaction.spaceSession.findFirst({
      where: { spaceId, status: PrismaSpaceSessionStatus.active },
      select: { id: true },
    });
    return activeSession !== null;
  }

  /**
   * 运行态推导空间状态：根据是否有活跃会话、待履约预约来决定状态
   * Space.status 字段已从数据库移除，此方法用于替代数据库读取
   *
   * @param transaction - Prisma 事务客户端
   * @param spaceId - 空间 ID
   * @param enableDirtyRoom - 是否启用脏房模式（可选，若提供且为 true，可返回 cleaning）
   * @returns 推导出的空间状态值（idle/reserved/cleaning）
   */
  async resolveReservationBackStatus(
    transaction: Prisma.TransactionClient,
    spaceId: number,
    enableDirtyRoom?: boolean,
  ): Promise<SpaceStatusValue> {
    // 如果启用脏房模式，返回 cleaning（由调用方决定）
    if (enableDirtyRoom === true) {
      return SpaceStatusValues.cleaning;
    }

    // 检查是否存在今日待履约预约
    const todayRange = getTodayRange();
    const pendingReservation = await transaction.spaceReservation.findFirst({
      where: {
        spaceId,
        status: PrismaSpaceReservationStatus.pending,
        reservedAt: {
          gte: todayRange.start,
          lte: todayRange.end,
        },
      },
      select: { id: true },
    });

    if (pendingReservation) {
      return SpaceStatusValues.reserved;
    }

    return SpaceStatusValues.idle;
  }

  async cancelMatchedReservationAfterCheckout(
    transaction: Prisma.TransactionClient,
    session: SpaceReservationSessionSnapshot,
  ): Promise<number | null> {
    if (session.reservationId !== null) {
      return null;
    }

    const guestName = session.guestName?.trim();
    const guestPhone = session.guestPhone?.trim();
    if (!guestName || !guestPhone) {
      return null;
    }

    const todayRange = getTodayRange();
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

    const nearest = findNearestReservationMatch(
      candidates as SpaceReservationRecord[],
      session.startTime,
    );
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
}

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
  getReservationStatusRange,
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
   * 运行态推导空间状态：根据是否有活跃会话、待履约预约、脏房清洁状态来决定
   * Space.status 字段已从数据库移除，此方法用于替代数据库读取
   *
   * 优先级链（与 spaces-read / spaces-write.deriveSpaceStatus 保持一致）：
   *   1. occupied — 存在活跃会话（status=active）
   *   2. reserved — 存在待履约预约（priority 高于 cleaning）
   *   3. cleaning — enableDirtyRoom=true 且 lastSettledEndTime > cleanedAt
   *   4. idle     — 其他情况
   *
   * @param transaction - Prisma 事务客户端
   * @param spaceId - 空间 ID
   * @param enableDirtyRoom - 是否启用脏房模式
   */
  async resolveReservationBackStatus(
    transaction: Prisma.TransactionClient,
    spaceId: number,
    enableDirtyRoom?: boolean,
  ): Promise<SpaceStatusValue> {
    // 1. occupied 优先：存在活跃会话
    if (await this.hasActiveSession(transaction, spaceId)) {
      return SpaceStatusValues.occupied;
    }

    // 2. reserved：检查是否存在待履约预约
    const statusRange = getReservationStatusRange();
    const pendingReservation = await transaction.spaceReservation.findFirst({
      where: {
        spaceId,
        status: PrismaSpaceReservationStatus.pending,
        reservedAt: {
          gte: statusRange.start,
          lte: statusRange.end,
        },
      },
      select: { id: true },
    });

    if (pendingReservation) {
      return SpaceStatusValues.reserved;
    }

    // 3. cleaning：脏房模式且最近结算会话 endTime > cleanedAt（尚未标记清洁完成）
    if (enableDirtyRoom) {
      const lastSettled = await transaction.spaceSession.findFirst({
        where: {
          spaceId,
          status: PrismaSpaceSessionStatus.settled,
          endTime: { not: null },
        },
        select: { endTime: true },
        orderBy: { endTime: 'desc' },
      });

      if (lastSettled?.endTime) {
        const space = await transaction.space.findUnique({
          where: { id: spaceId },
          select: { cleanedAt: true },
        });
        const cleanedMs = space?.cleanedAt?.getTime() ?? 0;
        if (lastSettled.endTime.getTime() > cleanedMs) {
          return SpaceStatusValues.cleaning;
        }
      }
    }

    // 4. idle：无活跃会话、无待履约预约、无需清洁
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
          // ⑦ 修复：仅匹配开台时间之前的预约，排除客人当天稍后的不相关预约
          lte: session.startTime,
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

    // 防护：预约时间与开台时间差距过大（>2h）时，大概率不是同一笔消费的预约，
    // 避免误取消该客人其他时段的不相关预约
    const MAX_MATCH_DISTANCE_MS = 2 * 60 * 60 * 1000;
    if (
      Math.abs(nearest.reservedAt.getTime() - session.startTime.getTime()) >
      MAX_MATCH_DISTANCE_MS
    ) {
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

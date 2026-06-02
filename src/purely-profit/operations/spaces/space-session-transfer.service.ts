import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  SpaceSessionStatus as PrismaSpaceSessionStatus,
  SpaceStatus as PrismaSpaceStatus,
  SpaceReservationStatus as PrismaSpaceReservationStatus,
} from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  TransferSpaceSessionDto,
  TransferSpaceSessionResponseDto,
} from './dto/space-session.dto';
import { toSpaceSessionResponse } from './space-sessions.mapper';
import type { SpaceStatusValue } from './spaces.constants';

@Injectable()
export class SpaceSessionTransferService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
  ) {}

  async transferSession(
    user: AuthenticatedUser,
    sessionId: number,
    dto: TransferSpaceSessionDto,
  ): Promise<TransferSpaceSessionResponseDto> {
    const session = await this.prisma.spaceSession.findUnique({
      where: { id: sessionId },
      include: {
        space: {
          select: {
            id: true,
            name: true,
            storeId: true,
            enableDirtyRoom: true,
            autoCheckout: true,
            type: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    });

    if (!session) {
      throw new NotFoundException('空间会话不存在');
    }

    await this.commerceAccessService.ensureCanAccessStore(
      user,
      session.storeId,
      'operation-entry:create',
      '无权在该门店空间换房',
    );

    if (session.status !== PrismaSpaceSessionStatus.active) {
      throw new ConflictException('当前会话已结账，无法换房');
    }

    if (dto.targetSpaceId === session.spaceId) {
      throw new ConflictException('目标空间不能与当前空间相同');
    }

    const targetSpace = await this.prisma.space.findUnique({
      where: { id: dto.targetSpaceId },
      select: {
        id: true,
        storeId: true,
        name: true,
        status: true,
        typeId: true,
        enableDirtyRoom: true,
        autoCheckout: true,
      },
    });

    if (!targetSpace) {
      throw new NotFoundException('目标空间不存在');
    }

    if (targetSpace.storeId !== session.storeId) {
      throw new ConflictException('目标空间不属于当前门店，无法换房');
    }

    if (targetSpace.status !== PrismaSpaceStatus.idle) {
      throw new ConflictException('目标空间当前不可换入');
    }

    if (targetSpace.typeId !== session.space.type.id) {
      throw new ConflictException('只能换到同类型空间');
    }

    if (targetSpace.enableDirtyRoom !== session.space.enableDirtyRoom) {
      throw new ConflictException(
        '目标空间与当前空间的脏房模式不一致，无法换房',
      );
    }

    if (targetSpace.autoCheckout !== session.space.autoCheckout) {
      throw new ConflictException(
        '目标空间与当前空间的自动结账设置不一致，无法换房',
      );
    }

    if (Boolean(session.autoCheckout) !== targetSpace.autoCheckout) {
      throw new ConflictException(
        '当前会话自动结账状态与目标空间设置不一致，无法换房',
      );
    }

    const result = await this.prisma.$transaction(async (transaction) => {
      const latestSession = await transaction.spaceSession.findUnique({
        where: { id: session.id },
        include: {
          space: {
            select: {
              id: true,
              name: true,
              storeId: true,
              enableDirtyRoom: true,
              autoCheckout: true,
              type: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
      });

      if (!latestSession) {
        throw new NotFoundException('空间会话不存在');
      }
      if (latestSession.status !== PrismaSpaceSessionStatus.active) {
        throw new ConflictException('当前会话已结账，无法换房');
      }

      const latestTargetSpace = await transaction.space.findUnique({
        where: { id: dto.targetSpaceId },
        select: {
          id: true,
          storeId: true,
          status: true,
          typeId: true,
          enableDirtyRoom: true,
          autoCheckout: true,
        },
      });

      if (!latestTargetSpace) {
        throw new NotFoundException('目标空间不存在');
      }
      if (latestTargetSpace.storeId !== latestSession.storeId) {
        throw new ConflictException('目标空间不属于当前门店，无法换房');
      }
      if (latestTargetSpace.status !== PrismaSpaceStatus.idle) {
        throw new ConflictException('目标空间当前不可换入');
      }
      if (latestTargetSpace.typeId !== latestSession.space.type.id) {
        throw new ConflictException('只能换到同类型空间');
      }
      if (
        latestTargetSpace.enableDirtyRoom !== latestSession.space.enableDirtyRoom
      ) {
        throw new ConflictException(
          '目标空间与当前空间的脏房模式不一致，无法换房',
        );
      }
      if (latestTargetSpace.autoCheckout !== latestSession.space.autoCheckout) {
        throw new ConflictException(
          '目标空间与当前空间的自动结账设置不一致，无法换房',
        );
      }
      if (
        Boolean(latestSession.autoCheckout) !== latestTargetSpace.autoCheckout
      ) {
        throw new ConflictException(
          '当前会话自动结账状态与目标空间设置不一致，无法换房',
        );
      }

      const sourceSpaceStatus = latestSession.space.enableDirtyRoom
        ? PrismaSpaceStatus.cleaning
        : await this.resolveReservationBackStatus(
            transaction,
            latestSession.spaceId,
          );

      const updatedSession = await transaction.spaceSession.update({
        where: { id: latestSession.id },
        data: {
          spaceId: latestTargetSpace.id,
        },
        include: {
          space: {
            select: {
              id: true,
              name: true,
              type: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
      });

      await transaction.space.update({
        where: { id: latestSession.spaceId },
        data: {
          status: sourceSpaceStatus,
        },
      });
      await transaction.space.update({
        where: { id: latestTargetSpace.id },
        data: {
          status: PrismaSpaceStatus.occupied,
        },
      });

      return {
        updatedSession,
        sourceSpaceStatus,
      };
    });

    return {
      ok: true,
      session: toSpaceSessionResponse(result.updatedSession),
      sourceSpaceStatus: this.toSpaceStatusValue(result.sourceSpaceStatus),
      targetSpaceStatus: this.toSpaceStatusValue(PrismaSpaceStatus.occupied),
    };
  }

  private toSpaceStatusValue(status: PrismaSpaceStatus): SpaceStatusValue {
    return status;
  }

  private async resolveReservationBackStatus(
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

  private getTodayRange(): { start: Date; end: Date } {
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

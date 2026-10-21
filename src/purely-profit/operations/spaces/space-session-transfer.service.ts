import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SpaceSessionStatus as PrismaSpaceSessionStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import {
  PrismaService,
  TX_TIMEOUT_SHORT,
} from '../../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../../redis/invalidator';
import type {
  TransferSpaceSessionDto,
  TransferSpaceSessionResponseDto,
} from './dto/space-session.dto';
import { SpaceReservationsStateService } from './space-reservations-state.service';
import { toSpaceSessionResponse } from './space-sessions.mapper';
import type { SpaceStatusValue } from './spaces.constants';

@Injectable()
export class SpaceSessionTransferService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly reservationsStateService: SpaceReservationsStateService,
    private readonly cacheInvalidatorService: CacheInvalidatorService,
  ) {}

  async transferSession(
    user: AuthenticatedUser,
    sessionId: number,
    dto: TransferSpaceSessionDto,
  ): Promise<TransferSpaceSessionResponseDto> {
    // BUG-1 fix: 与 checkout / list / detail 的 deletedAt: null 口径一致
    const session = await this.prisma.spaceSession.findFirst({
      where: {
        id: sessionId,
        space: { deletedAt: null },
      },
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
        sessionItems: {
          orderBy: { sortOrder: 'asc' },
        },
        sessionRenewRecords: {
          orderBy: { id: 'asc' },
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

    // Space.status 已移除，改为检查是否有活跃会话
    // B1 fix: 软删除空间不可作为转台目标，与 listSpaces 的 deletedAt: null 口径一致
    // 性能：目标空间查询与目标空间活跃会话检查互不依赖，并行执行省去一次串行往返
    const [targetSpaceActiveSession, targetSpace] = await Promise.all([
      this.prisma.spaceSession.findFirst({
        where: {
          spaceId: dto.targetSpaceId,
          status: PrismaSpaceSessionStatus.active,
        },
        select: { id: true },
      }),
      this.prisma.space.findFirst({
        where: { id: dto.targetSpaceId, deletedAt: null },
        select: {
          id: true,
          storeId: true,
          name: true,
          typeId: true,
          enableDirtyRoom: true,
          autoCheckout: true,
        },
      }),
    ]);

    if (!targetSpace) {
      throw new NotFoundException('目标空间不存在');
    }

    ensureTransferTargetValid({
      sourceStoreId: session.storeId,
      sourceSpace: session.space,
      sourceSessionAutoCheckout: session.autoCheckout,
      targetSpace,
      hasTargetActiveSession: Boolean(targetSpaceActiveSession),
    });

    const result = await this.prisma.$transaction(
      async (transaction) => {
        await transaction.$queryRaw`
        SELECT id
        FROM space_sessions
        WHERE id = ${session.id}
        FOR UPDATE
      `;

        const lockedSession = await transaction.spaceSession.findUnique({
          where: { id: session.id },
          select: {
            id: true,
            storeId: true,
            spaceId: true,
          },
        });

        if (!lockedSession) {
          throw new NotFoundException('空间会话不存在');
        }

        const lockSpaceIds = Array.from(
          new Set([lockedSession.spaceId, dto.targetSpaceId]),
        ).sort((left, right) => left - right);
        for (const lockSpaceId of lockSpaceIds) {
          await transaction.$queryRaw`
          SELECT id
          FROM spaces
          WHERE id = ${lockSpaceId}
          FOR UPDATE
        `;
        }

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
            sessionItems: {
              orderBy: { sortOrder: 'asc' },
            },
            sessionRenewRecords: {
              orderBy: { id: 'asc' },
            },
          },
        });

        if (!latestSession) {
          throw new NotFoundException('空间会话不存在');
        }
        if (latestSession.status !== PrismaSpaceSessionStatus.active) {
          throw new ConflictException('当前会话已结账，无法换房');
        }

        // Space.status 已移除，改为检查是否有活跃会话
        // 性能：目标空间重查与目标空间活跃会话重查互不依赖，并行执行省去一次串行往返
        const [latestTargetActiveSession, latestTargetSpace] =
          await Promise.all([
            transaction.spaceSession.findFirst({
              where: {
                spaceId: dto.targetSpaceId,
                status: PrismaSpaceSessionStatus.active,
              },
              select: { id: true },
            }),
            transaction.space.findUnique({
              where: { id: dto.targetSpaceId },
              select: {
                id: true,
                storeId: true,
                typeId: true,
                enableDirtyRoom: true,
                autoCheckout: true,
              },
            }),
          ]);

        if (!latestTargetSpace) {
          throw new NotFoundException('目标空间不存在');
        }

        ensureTransferTargetValid({
          sourceStoreId: latestSession.storeId,
          sourceSpace: latestSession.space,
          sourceSessionAutoCheckout: latestSession.autoCheckout,
          targetSpace: latestTargetSpace,
          hasTargetActiveSession: Boolean(latestTargetActiveSession),
        });

        // 运行态推导源空间状态
        const sourceSpaceStatus =
          await this.reservationsStateService.resolveReservationBackStatus(
            transaction,
            latestSession.spaceId,
            latestSession.space.enableDirtyRoom,
          );

        const updatedSession = await transaction.spaceSession.update({
          where: { id: latestSession.id },
          data: {
            spaceId: latestTargetSpace.id,
            // BUG-2 fix: 转台后清空 reservationId，避免会话关联的预约仍指向旧空间
            // 原预约在开台时已置为 fulfilled，其空间归属审计信息保留在原预约记录中
            reservationId: null,
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
            sessionItems: {
              orderBy: { sortOrder: 'asc' },
            },
            sessionRenewRecords: {
              orderBy: { id: 'asc' },
            },
          },
        });

        // Space.status 已移除，不再更新空间状态字段
        // 目标空间状态会自动变为 occupied（因为有活跃会话）

        return {
          updatedSession,
          sourceSpaceStatus,
        };
      },
      { timeout: TX_TIMEOUT_SHORT },
    );

    // 换房同时改变源/目标两个空间的运行态与看板摘要
    await this.cacheInvalidatorService.invalidateSpacesReadCaches(
      session.storeId,
    );

    return {
      ok: true,
      session: toSpaceSessionResponse(result.updatedSession),
      sourceSpaceStatus: this.toSpaceStatusValue(result.sourceSpaceStatus),
      targetSpaceStatus: this.toSpaceStatusValue('occupied'),
    };
  }

  private toSpaceStatusValue(status: string): SpaceStatusValue {
    return status as SpaceStatusValue;
  }
}

/**
 * 换房目标空间校验的唯一权威实现。
 *
 * 换房存在「事务外预检 + 事务内锁后复检」两处调用，历史上是两段几乎逐行重复的
 * 校验代码，改一处容易漏另一处。此处收敛为单一函数保证两条路径口径完全一致：
 * - sourceSpace 为源空间（会话当前所在），targetSpace 为目标空间；
 * - 校验顺序保持与原实现一致：门店 → 目标可用性 → 同类型 → 脏房模式 →
 *   空间级 autoCheckout → 会话级 autoCheckout。
 */
function ensureTransferTargetValid(params: {
  sourceStoreId: number;
  sourceSpace: {
    type: { id: number };
    enableDirtyRoom: boolean;
    autoCheckout: boolean;
  };
  sourceSessionAutoCheckout: boolean | null;
  targetSpace: {
    storeId: number;
    typeId: number;
    enableDirtyRoom: boolean;
    autoCheckout: boolean;
  };
  hasTargetActiveSession: boolean;
}): void {
  if (params.targetSpace.storeId !== params.sourceStoreId) {
    throw new ConflictException('目标空间不属于当前门店，无法换房');
  }

  // Space.status 已移除，改为检查是否有活跃会话
  if (params.hasTargetActiveSession) {
    throw new ConflictException('目标空间当前不可换入');
  }

  if (params.targetSpace.typeId !== params.sourceSpace.type.id) {
    throw new ConflictException('只能换到同类型空间');
  }

  if (
    params.targetSpace.enableDirtyRoom !== params.sourceSpace.enableDirtyRoom
  ) {
    throw new ConflictException('目标空间与当前空间的脏房模式不一致，无法换房');
  }

  // 空间级校验：两个空间的默认自动结账配置必须一致
  if (params.targetSpace.autoCheckout !== params.sourceSpace.autoCheckout) {
    throw new ConflictException(
      '目标空间与当前空间的自动结账设置不一致，无法换房',
    );
  }

  // 会话级校验：当前会话的实际 autoCheckout 值必须与目标空间配置一致，
  // 防止会话级 autoCheckout 与空间级配置漂移导致换房后行为异常
  if (
    Boolean(params.sourceSessionAutoCheckout) !==
    params.targetSpace.autoCheckout
  ) {
    throw new ConflictException(
      '当前会话自动结账状态与目标空间设置不一致，无法换房',
    );
  }
}

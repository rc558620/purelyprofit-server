import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PrismaService,
  TX_TIMEOUT_SHORT,
} from '../../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../../redis/invalidator';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import type { SpaceResponseDto } from './dto/space.dto';
import { toSpaceResponse } from './spaces.mapper';
import { SPACE_WITH_RELATIONS_INCLUDE } from './spaces.query';
import type { SpaceStatusValue } from './spaces.constants';
import {
  deriveSpaceStatusFromCounts,
  getReservationStatusRange,
} from './space-reservations.shared';

/**
 * 状态推导的「已知事实」。
 *
 * 调用方若在同一次请求/同一事务内已经拿到了这些值（例如事务内 FOR UPDATE
 * 校验过没有活跃会话、update 返回的整行带着 cleanedAt / enableDirtyRoom），
 * 传入后即可跳过对应的重复查询，避免为推导一个枚举值回表。
 */
export interface KnownSpaceStatusFacts {
  activeSessions?: number;
  enableDirtyRoom?: boolean;
  cleanedAt?: Date | null;
}

@Injectable()
export class SpacesStatusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly cacheInvalidatorService: CacheInvalidatorService,
  ) {}

  async markSpaceReady(
    user: AuthenticatedUser,
    spaceId: number,
  ): Promise<SpaceResponseDto> {
    // 标记空间可用属于运营操作（脏房清洁完成后恢复可用），
    // 收银员/店长等子账号与主账号均可执行，仅校验门店归属，不做主账号限制。

    // B-4 fix: 校验与写入原子化——occupied 检查、cleanedAt 写入、状态重推导全部在同一事务内
    const result = await this.prisma.$transaction(
      async (transaction) => {
        // FOR UPDATE 锁定空间行，消除并发窗口
        await transaction.$queryRaw`
          SELECT id
          FROM spaces
          WHERE id = ${spaceId}
          FOR UPDATE
        `;

        const space = await transaction.space.findFirst({
          where: { id: spaceId, deletedAt: null },
          include: SPACE_WITH_RELATIONS_INCLUDE,
        });

        if (!space) {
          throw new NotFoundException('空间不存在');
        }

        await this.commerceAccessService.ensureCanAccessStore(
          user,
          space.storeId,
          'space:view',
          '无权操作该门店空间',
        );

        // 事务内重查运行态：occupied 时不允许标记可用
        const activeSession = await transaction.spaceSession.findFirst({
          where: { spaceId, status: 'active' },
          select: { id: true },
        });
        if (activeSession) {
          throw new ConflictException(
            '空间当前使用中，请先完成会话流程后再调整状态',
          );
        }

        // 校验通过后，标记清洁完成
        const updatedRow = await transaction.space.update({
          where: { id: spaceId },
          data: { cleanedAt: new Date() },
          select: { cleanedAt: true },
        });

        // 事务内重新获取完整空间数据并推导状态
        // 性能：update 已返回最新 cleanedAt，复用上方 findFirst 已加载的关系数据，
        // 不再重复 findUniqueOrThrow 同一行
        const updated = { ...space, cleanedAt: updatedRow.cleanedAt };

        const [pendingReservation, lastSettled] = await Promise.all([
          transaction.spaceReservation.findFirst({
            where: {
              spaceId,
              status: 'pending',
              reservedAt: {
                gte: getReservationStatusRange().start,
                lte: getReservationStatusRange().end,
              },
            },
            select: { id: true },
          }),
          updated.enableDirtyRoom
            ? transaction.spaceSession.findFirst({
                where: { spaceId, status: 'settled', endTime: { not: null } },
                select: { endTime: true },
                orderBy: { endTime: 'desc' },
              })
            : Promise.resolve(null),
        ]);

        // BUG-04 fix: 复用共享权威函数 deriveSpaceStatusFromCounts，消除内联副本漂移风险
        const status = deriveSpaceStatusFromCounts({
          activeSessions: 0, // 已在上方校验排除 occupied
          pendingReservations: pendingReservation ? 1 : 0,
          enableDirtyRoom: updated.enableDirtyRoom,
          lastSettledEndTime: lastSettled?.endTime ?? null,
          cleanedAt: updated.cleanedAt,
        });

        return {
          response: toSpaceResponse({ ...updated, status }),
          storeId: space.storeId,
        };
      },
      { timeout: TX_TIMEOUT_SHORT },
    );

    // 标记可用直接改变空间运行态（cleaning → idle）
    await this.cacheInvalidatorService.invalidateSpacesReadCaches(
      result.storeId,
    );

    return result.response;
  }

  /**
   * BUG-04 fix: 复用共享权威函数 deriveSpaceStatusFromCounts 推导运行态状态，
   * 消除写路径与读路径（列表/看板）之间的口径漂移风险。
   * 优先级链：occupied > reserved > cleaning > idle
   *
   * 性能：`known` 里已给出的字段不再回表查询。调用方通常刚在事务内校验过
   * 活跃会话数、或手上就有 update 返回的整行，此时推导只需补查真正未知的
   * 那两项（今日 pending 预约数、最近一次结账时间）。
   */
  async deriveSpaceStatus(
    spaceId: number,
    known?: KnownSpaceStatusFacts,
  ): Promise<SpaceStatusValue> {
    const statusRange = getReservationStatusRange();
    const { activeSessions, enableDirtyRoom, cleanedAt } = known ?? {};
    const needActiveSessionCount = activeSessions === undefined;
    // cleanedAt 合法值包含 null，必须与「未提供」区分，不能用真值判断
    const needSpaceRow =
      enableDirtyRoom === undefined || cleanedAt === undefined;

    const [activeSessionCount, pendingReservationCount, space, lastSettled] =
      await Promise.all([
        needActiveSessionCount
          ? this.prisma.spaceSession.count({
              where: { spaceId, status: 'active' },
            })
          : Promise.resolve(activeSessions as number),
        this.prisma.spaceReservation.count({
          where: {
            spaceId,
            status: 'pending',
            reservedAt: {
              gte: statusRange.start,
              lte: statusRange.end,
            },
          },
        }),
        needSpaceRow
          ? this.prisma.space.findUnique({
              where: { id: spaceId },
              select: { enableDirtyRoom: true, cleanedAt: true },
            })
          : Promise.resolve(null),
        this.prisma.spaceSession.findFirst({
          where: { spaceId, status: 'settled', endTime: { not: null } },
          select: { endTime: true },
          orderBy: { endTime: 'desc' },
        }),
      ]);

    return deriveSpaceStatusFromCounts({
      activeSessions: activeSessionCount,
      pendingReservations: pendingReservationCount,
      enableDirtyRoom: enableDirtyRoom ?? space?.enableDirtyRoom ?? false,
      lastSettledEndTime: lastSettled?.endTime ?? null,
      cleanedAt:
        cleanedAt !== undefined ? cleanedAt : (space?.cleanedAt ?? null),
    });
  }
}

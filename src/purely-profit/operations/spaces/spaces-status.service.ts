import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PrismaService,
  TX_TIMEOUT_SHORT,
} from '../../../prisma/prisma.service';
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

@Injectable()
export class SpacesStatusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
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
        await transaction.space.update({
          where: { id: spaceId },
          data: { cleanedAt: new Date() },
        });

        // 事务内重新获取完整空间数据并推导状态
        const updated = await transaction.space.findUniqueOrThrow({
          where: { id: spaceId },
          include: SPACE_WITH_RELATIONS_INCLUDE,
        });

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

        return toSpaceResponse({ ...updated, status });
      },
      { timeout: TX_TIMEOUT_SHORT },
    );

    return result;
  }

  /**
   * BUG-04 fix: 复用共享权威函数 deriveSpaceStatusFromCounts 推导运行态状态，
   * 消除写路径与读路径（列表/看板）之间的口径漂移风险。
   * 优先级链：occupied > reserved > cleaning > idle
   */
  async deriveSpaceStatus(spaceId: number): Promise<SpaceStatusValue> {
    const statusRange = getReservationStatusRange();
    const [activeSessionCount, pendingReservationCount, space, lastSettled] =
      await Promise.all([
        this.prisma.spaceSession.count({
          where: { spaceId, status: 'active' },
        }),
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
        this.prisma.space.findUnique({
          where: { id: spaceId },
          select: { enableDirtyRoom: true, cleanedAt: true },
        }),
        this.prisma.spaceSession.findFirst({
          where: { spaceId, status: 'settled', endTime: { not: null } },
          select: { endTime: true },
          orderBy: { endTime: 'desc' },
        }),
      ]);

    return deriveSpaceStatusFromCounts({
      activeSessions: activeSessionCount,
      pendingReservations: pendingReservationCount,
      enableDirtyRoom: space?.enableDirtyRoom ?? false,
      lastSettledEndTime: lastSettled?.endTime ?? null,
      cleanedAt: space?.cleanedAt ?? null,
    });
  }
}

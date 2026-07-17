import {
  ConflictException,
  ForbiddenException,
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
    // 空间状态重置属于配置写操作，仅允许主账号操作（与 create/update/delete 一致）
    this.ensurePrimaryAccountOnly(user);

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
          'space:update',
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

  /**
   * 断言当前请求者为主账号（identityType 为 owner 或 staff）。
   * 空间配置类写操作（新增 / 编辑 / 删除 / 状态重置）属于门店运营配置，
   * 仅对绑定门店的主账号开放，任何子账号身份均不允许操作，以保持最小权限原则。
   * 前端已通过 isPrimaryAccount 隐藏编辑模式区域，此处为后端兜底校验。
   */
  private ensurePrimaryAccountOnly(user: AuthenticatedUser): void {
    if (user.currentMembership?.subjectType === 'sub_account') {
      throw new ForbiddenException('子账号不可维护空间配置');
    }
  }
}

import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SpaceSessionStatus as PrismaSpaceSessionStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { Money } from '../../../shared/money.utils';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  AddSpaceSessionItemsDto,
  SpaceSessionResponseDto,
} from './dto/space-session.dto';
import {
  mapSessionItemRows,
  toSpaceSessionResponse,
} from './space-sessions.mapper';
import { normalizeSessionItemsPayload } from './space-session-payload.shared';
import { mergeSessionItems, sumLineTotal } from './space-session-items.shared';

@Injectable()
export class SpaceSessionWriteService {
  constructor(private readonly prisma: PrismaService) {}

  async addItemsToSession(
    user: AuthenticatedUser,
    sessionId: number,
    dto: AddSpaceSessionItemsDto,
    deps: {
      ensureCanAccessStore: (
        user: AuthenticatedUser,
        storeId: number,
        permission: string,
        message: string,
      ) => Promise<void>;
    },
  ): Promise<SpaceSessionResponseDto> {
    const session = await this.prisma.spaceSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        storeId: true,
      },
    });

    if (!session) {
      throw new NotFoundException('空间会话不存在');
    }

    await deps.ensureCanAccessStore(
      user,
      session.storeId,
      'operation-entry:create',
      '无权在该门店空间追加商品',
    );

    const appendedItems = normalizeSessionItemsPayload(dto.items);

    const updated = await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT id
        FROM space_sessions
        WHERE id = ${sessionId}
        FOR UPDATE
      `;

      const latestSession = await transaction.spaceSession.findUnique({
        where: { id: sessionId },
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

      if (!latestSession) {
        throw new NotFoundException('空间会话不存在');
      }

      if (latestSession.status !== PrismaSpaceSessionStatus.active) {
        throw new ConflictException('当前会话已结账，无法继续点单');
      }

      // Step 8.1: 从子表行映射为业务记录再合并
      const currentItems = mapSessionItemRows(latestSession.sessionItems);
      const mergedItems = mergeSessionItems(currentItems, appendedItems);
      const nextItemsCost = sumLineTotal(mergedItems);

      // Step 8.1: 删除旧的 items，重新创建
      await transaction.spaceSessionItem.deleteMany({
        where: { sessionId: latestSession.id },
      });

      await transaction.spaceSessionItem.createMany({
        data: mergedItems.map((item, index) => ({
          sessionId: latestSession.id,
          productId: item.productId,
          productName: item.productName,
          categoryName: item.categoryName,
          // mergedItems 中的 salePrice/profit 是元，DB 存储为分
          salePrice: Money.fromInputYuan(item.salePrice).toDbCents(),
          profit: Money.fromInputYuan(item.profit).toDbCents(),
          quantity: item.quantity,
          sortOrder: index,
        })),
      });

      return transaction.spaceSession.update({
        where: { id: latestSession.id },
        data: {
          // nextItemsCost 是元，DB 存储为分
          itemsCost: Money.fromInputYuan(nextItemsCost).toDbCents(),
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
    });

    return toSpaceSessionResponse(updated);
  }
}

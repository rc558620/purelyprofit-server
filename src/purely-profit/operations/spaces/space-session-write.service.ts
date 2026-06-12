import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  SpaceSessionStatus as PrismaSpaceSessionStatus,
} from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  AddSpaceSessionItemsDto,
  SpaceSessionResponseDto,
} from './dto/space-session.dto';
import {
  parseSpaceSessionItems,
  toSpaceSessionItemsJson,
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
        },
      });

      if (!latestSession) {
        throw new NotFoundException('空间会话不存在');
      }

      if (latestSession.status !== PrismaSpaceSessionStatus.active) {
        throw new ConflictException('当前会话已结账，无法继续点单');
      }

      const mergedItems = mergeSessionItems(
        parseSpaceSessionItems(latestSession.items),
        appendedItems,
      );

      return transaction.spaceSession.update({
        where: { id: latestSession.id },
        data: {
          items: toSpaceSessionItemsJson(mergedItems),
          itemsCost: new Prisma.Decimal(sumLineTotal(mergedItems)),
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
    });

    return toSpaceSessionResponse(updated);
  }
}

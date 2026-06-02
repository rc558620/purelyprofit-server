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

    if (!session) {
      throw new NotFoundException('空间会话不存在');
    }

    await deps.ensureCanAccessStore(
      user,
      session.storeId,
      'operation-entry:create',
      '无权在该门店空间追加商品',
    );

    if (session.status !== PrismaSpaceSessionStatus.active) {
      throw new ConflictException('当前会话已结账，无法继续点单');
    }

    const mergedItems = mergeSessionItems(
      parseSpaceSessionItems(session.items),
      normalizeSessionItemsPayload(dto.items),
    );

    const updated = await this.prisma.spaceSession.update({
      where: { id: session.id },
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

    return toSpaceSessionResponse(updated);
  }
}

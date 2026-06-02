import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  SpaceBillingMode as PrismaSpaceBillingMode,
  SpaceSessionStatus as PrismaSpaceSessionStatus,
  Prisma,
} from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  RenewSpaceSessionDto,
  RenewSpaceSessionResponseDto,
} from './dto/space-session.dto';
import {
  parseSpaceSessionRenewRecords,
  toSpaceSessionRenewRecordsJson,
  toSpaceSessionResponse,
} from './space-sessions.mapper';
import { normalizeRenewPayload } from './space-session-payload.shared';
import type { SpaceSessionRenewRecord } from './space-sessions.types';

const generateSpaceSessionRenewRecordId = (): string =>
  `rn_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

@Injectable()
export class SpaceSessionRenewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
  ) {}

  async renewSession(
    user: AuthenticatedUser,
    sessionId: number,
    dto: RenewSpaceSessionDto,
  ): Promise<RenewSpaceSessionResponseDto> {
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

    await this.commerceAccessService.ensureCanAccessStore(
      user,
      session.storeId,
      'operation-entry:create',
      '无权在该门店空间续费',
    );

    if (session.status !== PrismaSpaceSessionStatus.active) {
      throw new ConflictException('当前会话已结账，无法继续续费');
    }

    if (session.billingMode !== PrismaSpaceBillingMode.countdown) {
      throw new ConflictException('仅倒计时会话支持续费');
    }

    const hourlyRate = session.hourlyRate ? Number(session.hourlyRate) : 0;
    if (hourlyRate <= 0) {
      throw new BadRequestException('当前会话缺少有效台位费，无法续费');
    }

    const payload = normalizeRenewPayload(dto);
    const addedMinutes = Math.floor((payload.amount / hourlyRate) * 60);
    if (addedMinutes <= 0) {
      throw new BadRequestException('续费金额不足以换算有效时长');
    }

    const renewRecord: SpaceSessionRenewRecord = {
      id: generateSpaceSessionRenewRecordId(),
      amount: payload.amount,
      addedMinutes,
      paymentMethod: payload.paymentMethod,
      ...(payload.grouponCode ? { grouponCode: payload.grouponCode } : {}),
      ...(payload.grouponPlatform
        ? { grouponPlatform: payload.grouponPlatform }
        : {}),
      ...(payload.note ? { note: payload.note } : {}),
      renewedAt: Date.now(),
    };
    const renewRecords = [
      ...parseSpaceSessionRenewRecords(session.renewRecords),
      renewRecord,
    ];

    const updated = await this.prisma.spaceSession.update({
      where: { id: session.id },
      data: {
        countdownMinutes: (session.countdownMinutes ?? 0) + addedMinutes,
        renewRecords: toSpaceSessionRenewRecordsJson(renewRecords),
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

    return {
      renewRecord: { ...renewRecord },
      session: toSpaceSessionResponse(updated),
    };
  }
}

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  SpaceBillingMode as PrismaSpaceBillingMode,
  SpaceSessionStatus as PrismaSpaceSessionStatus,
} from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { Money } from '../../../shared/money.utils';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PrismaService, TX_TIMEOUT_MEDIUM } from '../../../prisma/prisma.service';
import type {
  RenewSpaceSessionDto,
  RenewSpaceSessionResponseDto,
} from './dto/space-session.dto';
import { toSpaceSessionResponse } from './space-sessions.mapper';
import { normalizeRenewPayload } from './space-session-payload.shared';
import type { SpaceSessionRenewRecord } from './space-sessions.types';

const generateSpaceSessionRenewRecordId = (): string => `rn_${randomUUID()}`;

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
      select: {
        id: true,
        storeId: true,
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

    const payload = normalizeRenewPayload(dto);

    const result = await this.prisma.$transaction(async (transaction) => {
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
        throw new ConflictException('当前会话已结账，无法继续续费');
      }

      if (latestSession.billingMode !== PrismaSpaceBillingMode.countdown) {
        throw new ConflictException('仅倒计时会话支持续费');
      }

      // hourlyRate 在 DB 中是分，需转为元以便与前端传入的 payload.amount（元）运算
      const hourlyRateYuan = latestSession.hourlyRate
        ? Money.fromDbCents(Number(latestSession.hourlyRate)).toOutputYuan()
        : 0;
      if (hourlyRateYuan <= 0) {
        throw new BadRequestException('当前会话缺少有效台位费，无法续费');
      }

      const addedMinutes = Math.floor((payload.amount / hourlyRateYuan) * 60);
      if (addedMinutes <= 0) {
        throw new BadRequestException('续费金额不足以换算有效时长');
      }

      const recordId = generateSpaceSessionRenewRecordId();
      const renewRecord: SpaceSessionRenewRecord = {
        id: recordId,
        amount: payload.amount,
        addedMinutes,
        paymentMethod: payload.paymentMethod,
        ...(payload.grouponCode ? { grouponCode: payload.grouponCode } : {}),
        ...(payload.grouponPlatform
          ? { grouponPlatform: payload.grouponPlatform }
          : {}),
        ...(payload.voucherFaceAmount !== undefined
          ? { voucherFaceAmount: payload.voucherFaceAmount }
          : {}),
        ...(payload.note ? { note: payload.note } : {}),
        renewedAt: Date.now(),
      };

      // Step 8.1: 写入独立表而非 JSON
      // payload.amount 是元，DB 存储为分
      await transaction.spaceSessionRenewRecord.create({
        data: {
          sessionId: latestSession.id,
          recordId,
          amount: Money.fromInputYuan(payload.amount).toDbCents(),
          addedMinutes,
          paymentMethod: payload.paymentMethod,
          grouponCode: payload.grouponCode ?? null,
          grouponPlatform: payload.grouponPlatform ?? null,
          voucherFaceAmount:
            payload.voucherFaceAmount !== undefined
              ? Money.fromInputYuan(payload.voucherFaceAmount).toDbCents()
              : null,
          note: payload.note ?? null,
          renewedAt: renewRecord.renewedAt,
        },
      });

      const updated = await transaction.spaceSession.update({
        where: { id: latestSession.id },
        data: {
          countdownMinutes:
            (latestSession.countdownMinutes ?? 0) + addedMinutes,
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

      return {
        renewRecord,
        updated,
      };
    }, { timeout: TX_TIMEOUT_MEDIUM });

    return {
      renewRecord: { ...result.renewRecord },
      session: toSpaceSessionResponse(result.updated),
    };
  }
}

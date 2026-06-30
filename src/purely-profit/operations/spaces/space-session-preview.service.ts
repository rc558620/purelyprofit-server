import { Injectable, NotFoundException } from '@nestjs/common';
import { SpaceSessionStatus as PrismaSpaceSessionStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  mapRenewRecordRows,
  mapSessionItemRows,
} from './space-sessions.mapper';
import {
  buildSpaceSessionSettlementMoney,
} from './space-session-settlement.shared';
import { Money } from '../../../shared/money.utils';

export interface LivePreviewResult {
  asOf: number;
  durationMinutes: number;
  durationLabel: string;
  timeCost: number;
  itemsCost: number;
  renewDeduction: number;
  prepaidDeduction: number;
  totalAmount: number;
  timeFeeMode?: string;
  countdownFeeMode?: string;
}

export interface RenewPreviewResult {
  amount: number;
  addedMinutes: number;
  durationLabel: string;
  valid: boolean;
  reason?: string;
}

@Injectable()
export class SpaceSessionPreviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
  ) {}

  async getLivePreview(
    user: AuthenticatedUser,
    sessionId: number,
    requestId?: string,
  ): Promise<LivePreviewResult> {
    void requestId;
    const session = await this.findActiveSessionForPreview(sessionId);

    await this.commerceAccessService.ensureCanAccessStore(
      user,
      session.storeId,
      'space:view',
      '无权查看该门店空间会话预览',
    );

    const asOf = Date.now();
    const items = mapSessionItemRows(session.sessionItems);
    const renewRecords = mapRenewRecordRows(session.sessionRenewRecords);

    const settlement = buildSpaceSessionSettlementMoney({
      session,
      checkoutAt: asOf,
      payload: {},
      items,
      renewRecords,
    });

    return {
      asOf,
      durationMinutes: settlement.durationMinutes,
      durationLabel: settlement.durationLabel,
      timeCost: settlement.timeCostMoney.toOutputYuan(),
      itemsCost: settlement.itemsCostMoney.toOutputYuan(),
      renewDeduction: settlement.renewDeductionMoney.toOutputYuan(),
      prepaidDeduction: settlement.prepaidDeductionMoney.toOutputYuan(),
      totalAmount: settlement.totalAmountMoney.toOutputYuan(),
      ...(settlement.timeFeeMode ? { timeFeeMode: settlement.timeFeeMode } : {}),
      ...(settlement.countdownFeeMode
        ? { countdownFeeMode: settlement.countdownFeeMode }
        : {}),
    };
  }

  async getRenewPreview(
    user: AuthenticatedUser,
    sessionId: number,
    amount: number,
    requestId?: string,
  ): Promise<RenewPreviewResult> {
    void requestId;
    const session = await this.findActiveSessionForPreview(sessionId);

    await this.commerceAccessService.ensureCanAccessStore(
      user,
      session.storeId,
      'space:view',
      '无权查看该门店空间续费预览',
    );

    if (!session.hourlyRate) {
      return {
        amount,
        addedMinutes: 0,
        durationLabel: '0 分钟',
        valid: false,
        reason: '当前会话缺少有效台位费',
      };
    }

    const hourlyRateMoney = Money.fromDbCents(session.hourlyRate);
    if (hourlyRateMoney.isZero() || hourlyRateMoney.isNegative()) {
      return {
        amount,
        addedMinutes: 0,
        durationLabel: '0 分钟',
        valid: false,
        reason: '当前会话缺少有效台位费',
      };
    }

    const amountMoney = Money.fromInputYuan(amount);
    const addedMinutes = amountMoney.calcWholeUnitsFloor(hourlyRateMoney, 60);

    if (addedMinutes <= 0) {
      return {
        amount,
        addedMinutes: 0,
        durationLabel: '0 分钟',
        valid: false,
        reason: '续费金额不足以换算有效时长',
      };
    }

    const hours = Math.floor(addedMinutes / 60);
    const minutes = addedMinutes % 60;
    const durationLabel =
      hours > 0
        ? `${hours}小时${minutes > 0 ? `${minutes}分钟` : ''}`
        : `${minutes}分钟`;

    return {
      amount,
      addedMinutes,
      durationLabel,
      valid: true,
    };
  }

  private async findActiveSessionForPreview(sessionId: number) {
    const session = await this.prisma.spaceSession.findUnique({
      where: { id: sessionId },
      include: {
        space: {
          select: {
            id: true,
            name: true,
            enableDirtyRoom: true,
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

    if (!session) {
      throw new NotFoundException('空间会话不存在');
    }

    if (session.status !== PrismaSpaceSessionStatus.active) {
      throw new NotFoundException('当前会话已结账，无法预览');
    }

    return session;
  }
}

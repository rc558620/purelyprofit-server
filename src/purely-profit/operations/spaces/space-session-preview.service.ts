import { Injectable, NotFoundException } from '@nestjs/common';
import {
  SpaceBillingMode as PrismaSpaceBillingMode,
  SpaceSessionStatus as PrismaSpaceSessionStatus,
} from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  mapRenewRecordRows,
  mapSessionItemRows,
} from './space-sessions.mapper';
import { buildSpaceSessionSettlementMoney } from './space-session-settlement.shared';
import { MONEY_PRECISION_PATTERN } from './space-session-checkout-payload.shared';
import { Money } from '../../../shared/money.utils';

/** B7 fix: 续费预览金额上限（元），与 normalizeRenewPayload 保持一致 */
const RENEW_PREVIEW_AMOUNT_MAX = 99999.99;

/**
 * P3b fix: 预览专用的软校验，返回错误文案而非抛异常，
 * 使所有失败场景统一返回 { valid: false, reason }。
 */
const checkMoneyPrecisionSoft = (
  value: number,
  label: string,
): string | null => {
  if (!Number.isFinite(value) || !MONEY_PRECISION_PATTERN.test(String(value))) {
    return `${label}最多支持两位小数`;
  }
  return null;
};

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
      ...(settlement.timeFeeMode
        ? { timeFeeMode: settlement.timeFeeMode }
        : {}),
      ...(settlement.countdownFeeMode
        ? { countdownFeeMode: settlement.countdownFeeMode }
        : {}),
    };
  }

  /**
   * B1 fix: 接受可选 voucherFaceAmount，与实际续费口径一致
   *   （取 max(amount, voucherFaceAmount) 折算分钟数）。
   * B7 fix: 增加金额精度/上限校验，与 normalizeRenewPayload 保持一致。
   */
  async getRenewPreview(
    user: AuthenticatedUser,
    sessionId: number,
    amount: number,
    voucherFaceAmount?: number,
    grouponCode?: string,
    grouponPlatform?: string,
    requestId?: string,
  ): Promise<RenewPreviewResult> {
    void requestId;

    // P3b fix: 统一预览失败形态为 { valid: false, reason }
    const precisionFail = checkMoneyPrecisionSoft(amount, '续费金额');
    if (precisionFail) {
      return {
        amount,
        addedMinutes: 0,
        durationLabel: '0 分钟',
        valid: false,
        reason: precisionFail,
      };
    }
    if (voucherFaceAmount !== undefined) {
      const voucherPrecisionFail = checkMoneyPrecisionSoft(
        voucherFaceAmount,
        '券面金额',
      );
      if (voucherPrecisionFail) {
        return {
          amount,
          addedMinutes: 0,
          durationLabel: '0 分钟',
          valid: false,
          reason: voucherPrecisionFail,
        };
      }
    }

    // B7 fix: 金额上限校验
    if (amount > RENEW_PREVIEW_AMOUNT_MAX) {
      return {
        amount,
        addedMinutes: 0,
        durationLabel: '0 分钟',
        valid: false,
        reason: `续费金额不能超过 ${RENEW_PREVIEW_AMOUNT_MAX} 元`,
      };
    }
    if (
      voucherFaceAmount !== undefined &&
      voucherFaceAmount > RENEW_PREVIEW_AMOUNT_MAX
    ) {
      return {
        amount,
        addedMinutes: 0,
        durationLabel: '0 分钟',
        valid: false,
        reason: `券面金额不能超过 ${RENEW_PREVIEW_AMOUNT_MAX} 元`,
      };
    }

    const session = await this.findActiveSessionForPreview(sessionId);

    await this.commerceAccessService.ensureCanAccessStore(
      user,
      session.storeId,
      'space:view',
      '无权查看该门店空间续费预览',
    );

    // BUG-3 fix: 纯消费模式无 hourlyRate，续费语义不成立，与 renew.service 保持一致
    if (session.billingMode === PrismaSpaceBillingMode.items) {
      return {
        amount,
        addedMinutes: 0,
        durationLabel: '0 分钟',
        valid: false,
        reason: '纯消费模式不支持续费',
      };
    }

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

    // P3a fix: 团购场景下校验必填字段，与实际续费 normalizeRenewPayload 保持一致
    const hasAnyGrouponField = !!(
      grouponCode ||
      grouponPlatform ||
      (voucherFaceAmount !== undefined && voucherFaceAmount > 0)
    );
    if (hasAnyGrouponField) {
      if (!grouponCode?.trim()) {
        return {
          amount,
          addedMinutes: 0,
          durationLabel: '0 分钟',
          valid: false,
          reason: '团购券码不能为空',
        };
      }
      if (!grouponPlatform?.trim()) {
        return {
          amount,
          addedMinutes: 0,
          durationLabel: '0 分钟',
          valid: false,
          reason: '团购平台不能为空',
        };
      }
      if (voucherFaceAmount === undefined || voucherFaceAmount <= 0) {
        return {
          amount,
          addedMinutes: 0,
          durationLabel: '0 分钟',
          valid: false,
          reason: '券面金额必须大于 0',
        };
      }
    }

    // BUG-3 fix: 团购场景下实付金额不应超过券面金额，与 normalizeRenewPayload G4 规则对齐
    if (
      voucherFaceAmount !== undefined &&
      voucherFaceAmount > 0 &&
      amount > voucherFaceAmount
    ) {
      return {
        amount,
        addedMinutes: 0,
        durationLabel: '0 分钟',
        valid: false,
        reason: '续费金额不能超过券面金额（团购券规则：实付 ≤ 券面）',
      };
    }

    // B1 fix: 团购券场景下取 max(amount, voucherFaceAmount) 折算分钟数，
    // 与实际续费 space-session-renew.service 中 effectiveAmountMoney 口径一致
    const amountMoney = Money.fromInputYuan(amount);
    const effectiveAmountMoney =
      voucherFaceAmount !== undefined
        ? Money.max(amountMoney, Money.fromInputYuan(voucherFaceAmount))
        : amountMoney;
    const addedMinutes = effectiveAmountMoney.calcWholeUnitsFloor(
      hourlyRateMoney,
      60,
    );

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

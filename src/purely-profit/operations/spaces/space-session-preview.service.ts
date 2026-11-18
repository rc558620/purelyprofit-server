import { Injectable, NotFoundException } from '@nestjs/common';
import {
  SpaceBillingMode as PrismaSpaceBillingMode,
  SpaceSessionStatus as PrismaSpaceSessionStatus,
} from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { MONEY_PRECISION_PATTERN } from './space-session-checkout-payload.shared';
import { Money } from '../../../shared/money.utils';
import {
  buildLivePreviewAmounts,
  findLivePreviewTarget,
  resolveLivePreviewBucket,
  type LivePreviewAmounts,
} from './space-session-live-preview.shared';
import {
  buildCacheRefreshTaskKey,
  buildSpaceLivePreviewCacheKey,
} from '../../../redis/cache-keys';
import { RefreshableCacheService } from '../../../redis/refreshable-cache.service';

/** B7 fix: 续费预览金额上限（元），与 normalizeRenewPayload 保持一致 */
const RENEW_PREVIEW_AMOUNT_MAX = 99999.99;

/**
 * 实时预览缓存 TTL（秒）。
 *
 * 键里已经带 elapsed 分钟桶版本，跨桶必然换键回源，一致性不依赖 TTL；
 * TTL 只承担「回收 Redis 内存」，取 90s ≈ 一个半桶，既覆盖命中窗口
 * 又不会让已过桶的旧键长期滞留。
 */
const LIVE_PREVIEW_CACHE_TTL_SECONDS = 90;

/**
 * 提前刷新窗口（毫秒）= 60s = 一个完整桶。
 *
 * 有意不早于桶长度：桶内金额数学恒定，命中即最优，后台刷新只会产生
 * 同值回源；等键自然跨桶换版本才是唯一有效的「刷新」。
 */
const LIVE_PREVIEW_CACHE_REFRESH_AFTER_MS = 60_000;

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

export interface LivePreviewResult extends LivePreviewAmounts {
  /**
   * 服务端结算时点（毫秒时间戳）。
   *
   * 必须每次实时取，不能来自缓存：前端用它与 `asOf` 差值跑倒计时，
   * 命中缓存时复用旧值会让倒计时直接倒退一分钟。
   */
  asOf: number;
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
    private readonly refreshableCache: RefreshableCacheService,
  ) {}

  /**
   * 实时结账预览：按 elapsed 分钟桶缓存结算金额。
   *
   * 收银台会按秒轮询这里，而金额刻度是「分钟」，因此同一分钟内的重复调用
   * 完全等价；用桶做键版本后，命中率≈轮询频次，且不会引入金额误差。
   */
  async getLivePreview(
    user: AuthenticatedUser,
    sessionId: number,
    requestId?: string,
  ): Promise<LivePreviewResult> {
    void requestId;
    const target = await findLivePreviewTarget(this.prisma, sessionId);

    await this.commerceAccessService.ensureCanAccessStore(
      user,
      target.storeId,
      'space:view',
      '无权查看该门店空间会话预览',
    );

    const bucket = resolveLivePreviewBucket(
      target.startTime.getTime(),
      Date.now(),
    );
    const cacheKey = buildSpaceLivePreviewCacheKey(
      target.storeId,
      target.id,
      bucket,
    );
    const amounts = await this.refreshableCache.getOrLoadRefreshableJson({
      cacheKey,
      taskKey: buildCacheRefreshTaskKey(cacheKey),
      ttlSeconds: LIVE_PREVIEW_CACHE_TTL_SECONDS,
      refreshAfterMs: LIVE_PREVIEW_CACHE_REFRESH_AFTER_MS,
      loadValue: () => this.loadLivePreviewAmounts(sessionId, bucket),
    });

    // asOf 永远实时取：缓存体内只有金额，没有时间点
    return { asOf: Date.now(), ...amounts };
  }

  /** 缓存未命中路径：完整读取会话明细后按桶内固定时点结算 */
  private async loadLivePreviewAmounts(
    sessionId: number,
    bucket: number,
  ): Promise<LivePreviewAmounts> {
    const session = await this.findActiveSessionForPreview(sessionId);
    return buildLivePreviewAmounts(this.prisma, session, bucket);
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

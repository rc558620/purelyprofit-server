import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { PulseMembershipAccessService } from './membership-access.service';
import { loadPlanCatalog } from '../../purely-profit/member/platform-membership/platform-membership.query';
import { StoreMembershipLockedPriceService } from '../../purely-profit/member/platform-membership/store-membership-locked-price.service';
import type { PlatformMembershipPlanId } from '../../purely-profit/member/platform-membership/dto/platform-membership-query.dto';
import { PulseMembershipAdminMutationStateService } from './membership-admin-mutation-state.service';
import {
  isSubAccountPricingPlan,
  resolveRenewalPriceFen,
} from '../../purely-profit/member/platform-membership/platform-membership.constants';
import { resolveAmountFen } from './membership-admin-money.utils';
import type {
  PulseAdminMemberLevel,
  PulseAdminPricingPreviewResult,
} from './membership.types';

/** 分 → 元展示字符串，与会员套餐配置的 `priceDisplay` 保持同一口径 */
const toYuanDisplay = (fen: number): string => String(Math.round(fen) / 100);

/**
 * 会员续费价预览（Pulse 管理端「设置会员等级」弹窗）。
 *
 * 弹窗里运营改了子账号加价就要看到新的「下次续费价」，但约定是前端不做金额计算，
 * 所以这个数字必须由后端算好再下发。
 *
 * 定价公式与结算路径严格一致：`当前配置价 + 子账号加价`。
 * 成交价不参与定价，预览里只回显供运营记账参考。
 */
@Injectable()
export class PulseMembershipAdminPricingPreviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessService: PulseMembershipAccessService,
    private readonly mutationStateService: PulseMembershipAdminMutationStateService,
    private readonly lockedPriceService: StoreMembershipLockedPriceService,
  ) {}

  async preview(params: {
    user: AuthenticatedUser;
    storeId: number;
    /** 目标会员等级；免费会员或未选择时为 undefined */
    targetLevel?: PulseAdminMemberLevel;
    priceDisplay?: string;
    subAccountCount?: number;
    subAccountAmountDisplay?: string;
  }): Promise<PulseAdminPricingPreviewResult> {
    const { user, storeId, priceDisplay } = params;

    const canAccess = await this.accessService.canAccessAdminMember(
      user,
      storeId,
    );
    if (!canAccess) {
      throw new NotFoundException('会员不存在');
    }

    const targetPlanId = this.toMembershipPlanId(params.targetLevel);

    if (targetPlanId === null) {
      return this.buildEmptyResult();
    }

    const [plans, snapshots] = await Promise.all([
      loadPlanCatalog(this.prisma),
      this.lockedPriceService.loadDealPriceSnapshots(storeId),
    ]);

    const plan = plans.find((item) => item.id === targetPlanId);
    if (!plan) {
      throw new BadRequestException('套餐不存在');
    }

    // 子账号加价：本次输入优先；没填就沿用已录入的值，
    // 这样运营一打开弹窗就能看到「这家店现在的真实续费价」。
    // 只对年 / 永久档位生效：月 / 季开不了子账号，忽略输入与快照残留
    const subAccountAmount = isSubAccountPricingPlan(targetPlanId)
      ? (resolveAmountFen(params.subAccountAmountDisplay) ??
        snapshots.subAccountAmounts.get(targetPlanId) ??
        0)
      : 0;

    // 本档位已被「调整续费价格」覆盖过：基数用覆盖价，子账号加价仍然叠加
    const overridePrice = snapshots.priceOverrides.get(targetPlanId) ?? null;

    // 与结算路径严格同一入口（resolveRenewalPriceFen），
    // 否则会出现「弹窗显示 398、实际扣 450」
    const renewalPrice = resolveRenewalPriceFen({
      planId: targetPlanId,
      configPrice: plan.price,
      overridePrice,
      subAccountAmount,
    });

    return {
      targetPlanId,
      configPriceDisplay: toYuanDisplay(plan.price),
      overridePriceDisplay:
        overridePrice === null ? null : toYuanDisplay(overridePrice),
      subAccountAmountDisplay: toYuanDisplay(subAccountAmount),
      renewalPriceDisplay: toYuanDisplay(renewalPrice),
      dealPriceDisplay: priceDisplay?.trim() || null,
    };
  }

  /** 管理端等级（annual）→ 平台套餐标识（yearly）；免费 / 未选择时为 null */
  private toMembershipPlanId(
    level?: PulseAdminMemberLevel,
  ): PlatformMembershipPlanId | null {
    switch (level) {
      case 'monthly':
        return 'monthly';
      case 'quarterly':
        return 'quarterly';
      case 'annual':
        return 'yearly';
      case 'lifetime':
        return 'lifetime';
      default:
        return null;
    }
  }

  /** 免费会员没有定价可言：返回一份全零的占位结果，避免前端到处判空 */
  private buildEmptyResult(): PulseAdminPricingPreviewResult {
    return {
      targetPlanId: null,
      configPriceDisplay: '0',
      overridePriceDisplay: null,
      subAccountAmountDisplay: '0',
      renewalPriceDisplay: '0',
      dealPriceDisplay: null,
    };
  }
}

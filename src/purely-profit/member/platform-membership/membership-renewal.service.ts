import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import type { PlatformMembershipPlanResponseDto } from './dto/platform-membership-response.dto';
import {
  LIFETIME_RENEWAL_PLAN_DISPLAY_NAME,
  resolveVisibleRenewalPlanIds,
  shouldHideRenewalPlanPriceExtras,
} from './membership-renewal-policy.shared';
import { loadPlanCatalog } from './platform-membership.query';
import {
  StoreMembershipLockedPriceService,
  type StoreRenewalPricingContext,
} from './store-membership-locked-price.service';
import type { MembershipPlanConfig } from './platform-membership.types';

/**
 * 会员续费套餐服务（商家端 `/platform-membership/plans`）。
 *
 * 与开发者后台的套餐目录不同，这里是「当前门店视角」：
 * - **曾开通**子账号功能的门店只返回原档位（年度 / 永久），避免误降级导致子账号失效。
 *   判据必须用「曾开通」而非实时能力，否则会员一到期就会回退成月 / 季 / 年三档
 * - 命中有首购锁定价的档位按锁定价下发，保证「看到的价格 = 实际扣款」
 * - 永久卡不展示划线原价 / 月均价
 */
@Injectable()
export class MembershipRenewalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lockedPriceService: StoreMembershipLockedPriceService,
  ) {}

  /** 门店续费页可见套餐列表 */
  async listRenewalPlans(
    storeId: number,
  ): Promise<PlatformMembershipPlanResponseDto[]> {
    const [plans, context] = await Promise.all([
      loadPlanCatalog(this.prisma),
      this.lockedPriceService.loadRenewalPricingContext(storeId),
    ]);

    const visiblePlanIds = new Set(
      resolveVisibleRenewalPlanIds({
        subAccountFeatureOwned: context.subAccountFeatureOwned,
        // 用 renewalLevel：到期门店的实时档位已回落为 'free'，
        // 只有档案里保留的原档位才能区分「AGES 续 AGES」还是「年度续年度」
        level: context.renewalLevel,
      }),
    );

    return plans
      .filter((plan) => visiblePlanIds.has(plan.id))
      .map((plan) => this.buildRenewalPlanResponse(plan, context));
  }

  private buildRenewalPlanResponse(
    plan: MembershipPlanConfig,
    context: StoreRenewalPricingContext,
  ): PlatformMembershipPlanResponseDto {
    const { price, locked } = this.lockedPriceService.resolvePlanPrice({
      plan,
      context,
    });
    const { hideOriginalPrice, hideMonthlyPrice } =
      shouldHideRenewalPlanPriceExtras(plan.id);
    // 曾开通子账号功能的门店，套餐价里含子账号权益：配置中的 originalPrice 是
    // 「不含子账号」的旧价，划掉它反而会被读成「续费涨价了」。该展示位改为下发
    // 子账号数量，由前端渲染「包含 x 个子账号」。用「曾开通」口径，保证到期后
    // 也按首购锁定价展示而不出现划线原价。
    const subAccountIncludedCount =
      context.subAccountFeatureOwned && context.subAccountQuota > 0
        ? context.subAccountQuota
        : null;
    const showOriginalPrice =
      !hideOriginalPrice && subAccountIncludedCount === null;
    // 月均价按**实付价**折算：命中锁定价时 price 已替换，若仍用配置价折算，
    // 同一张卡片会出现「¥300 + 约¥3075/月」这类自相矛盾的展示
    const effectiveMonthlyPrice =
      plan.durationMonths !== null && plan.durationMonths > 0
        ? Math.floor(price / plan.durationMonths)
        : null;

    return {
      id: plan.id,
      name:
        plan.id === 'lifetime' ? LIFETIME_RENEWAL_PLAN_DISPLAY_NAME : plan.name,
      price,
      originalPrice: showOriginalPrice ? plan.originalPrice : null,
      durationMonths: plan.durationMonths ?? null,
      validDays: plan.validDays ?? null,
      ...(hideMonthlyPrice ? {} : { monthlyPrice: effectiveMonthlyPrice }),
      ...(hideOriginalPrice ? { hideOriginalPrice: true } : {}),
      ...(subAccountIncludedCount !== null ? { subAccountIncludedCount } : {}),
      ...(hideMonthlyPrice ? { hideMonthlyPrice: true } : {}),
      ...(locked ? { lockedPrice: true } : {}),
      ...(plan.badge ? { badge: plan.badge } : {}),
      ...(plan.recommended ? { recommended: true } : {}),
    };
  }
}

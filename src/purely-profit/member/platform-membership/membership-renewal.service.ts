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
  MEMBERSHIP_PLAN_PRESENTATION_VERSION,
  resolvePlanBadge,
} from './membership-plan-resolver';
import {
  StoreMembershipLockedPriceService,
  type StoreRenewalPricingContext,
} from './store-membership-locked-price.service';
import type { MembershipPlanConfig } from './platform-membership.types';
import {
  hasSubAccountPricingEntitlement,
  isSubAccountPricingPlan,
} from './platform-membership.constants';

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

  /**
   * 当前门店的**会员套餐版本号**，由两部分叠加：
   * - 数据版本（毫秒时间戳，取两者较大值）：
   *   - 全局套餐配置价的最近变更时间
   *   - 本门店成交价快照（续费价覆盖 / 子账号加价）的最近变更时间
   * - 代码级展示口径版本 `MEMBERSHIP_PLAN_PRESENTATION_VERSION`：
   *   由主推位、档位顺序、默认套餐配置、角标规则输出哈希自动算出（改了就变，
   *   不需要人工 +1）。主推位这类不下库的配置改了不会动任何 updatedAt，
   *   不叠加进去的话「推荐位从季度挪到年度」这类纯代码改动永远刷新不掉缓存。
   *
   * 用途：purelyPulse 改价发生在另一个会话，无法 bump purelyProfit 本地的
   * mutationVersion，商家端会一直命中本地缓存看到旧价。前端进入
   * member-plans / member-center 时先取这个版本号，与缓存里的版本不一致就弃用缓存重拉。
   *
   * 刻意**不读缓存**：版本号本身一旦被缓存就永远发现不了变化，这个接口必须实时。
   * 查询只是两个 aggregate，成本可忽略。
   *
   * 返回值只用于「前后是否一致」的比对，不做时间展示，因此叠加一个小整数是安全的。
   */
  async getPricingVersion(storeId: number): Promise<number> {
    const [globalSettings, storePrices] = await Promise.all([
      this.prisma.membershipPlanSetting.aggregate({
        _max: { updatedAt: true },
      }),
      this.prisma.storeMembershipLockedPrice.aggregate({
        where: { storeId },
        _max: { updatedAt: true },
      }),
    ]);

    return (
      Math.max(
        globalSettings._max.updatedAt?.getTime() ?? 0,
        storePrices._max.updatedAt?.getTime() ?? 0,
      ) + MEMBERSHIP_PLAN_PRESENTATION_VERSION
    );
  }

  /** 门店续费页可见套餐列表 */
  async listRenewalPlans(
    storeId: number,
  ): Promise<PlatformMembershipPlanResponseDto[]> {
    const [plans, context] = await Promise.all([
      loadPlanCatalog(this.prisma),
      this.lockedPriceService.loadRenewalPricingContext(storeId),
    ]);

    // 「只给年 / 永久」的判据必须与价格里的子账号加价同源：
    // 运营在设置会员等级时录入了子账号加价（即便配额尚未单独设置），
    // 该门店同样视为已开通子账号 —— 否则年度卡标着「包含 2 个子账号」
    // 却还能买月 / 季，月均比例直接倒挂。
    //
    // 与管理端「月 / 季能否改价」共用同一个判据，避免两边口径漂移。
    const hasSubAccountEntitlement = hasSubAccountPricingEntitlement(context);

    const visiblePlanIds = new Set(
      resolveVisibleRenewalPlanIds({
        subAccountFeatureOwned: hasSubAccountEntitlement,
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
    const { price } = this.lockedPriceService.resolvePlanPrice({
      plan,
      context,
    });
    const { hideOriginalPrice, hideMonthlyPrice } =
      shouldHideRenewalPlanPriceExtras(plan.id);
    // 曾开通子账号功能的门店，套餐价里含子账号权益：配置中的 originalPrice 是
    // 「不含子账号」的旧价，划掉它反而会被读成「续费涨价了」。该展示位改为下发
    // 子账号数量，由前端渲染「包含 x 个子账号」。
    //
    // 优先用**成交时录入**的数量：价格就是按它算的，两者必须同源，否则会出现
    // 「按 5 个子账号收费、却写着包含 8 个」的矛盾。未补录时回退实时配额，
    // 与旧口径一致（用「曾开通」口径，保证到期后也不出现划线原价）。
    // 子账号数量只对年 / 永久档位有意义：月 / 季开不了子账号，
    // 快照里即便残留了误录数据也不得展示
    const lockedSubAccountCount = isSubAccountPricingPlan(plan.id)
      ? (context.lockedSubAccountCounts.get(plan.id) ?? null)
      : null;
    const subAccountIncludedCount =
      lockedSubAccountCount !== null
        ? lockedSubAccountCount
        : context.subAccountFeatureOwned && context.subAccountQuota > 0
          ? context.subAccountQuota
          : null;
    const showOriginalPrice =
      !hideOriginalPrice && subAccountIncludedCount === null;
    const originalPrice = showOriginalPrice ? plan.originalPrice : null;
    // 角标必须用**最终下发的实付价**重算，不能沿用套餐目录里按配置价算出的
    // plan.badge：这里下发的 price 是门店解析价（max(配置价, 议定价) + 子账号加价），
    // 两者基数不同，Pulse 改过议定价或录了子账号加价后就会出现
    // 「划线 ¥298 / 实付 ¥112 / 省190元」这类自相矛盾的展示
    // （190 = 298 − 108 配置价，而 298 − 112 = 186）。
    // 展示位被划线价以外的内容（子账号数量）占用时 originalPrice 为 null，
    // 此时按定义没有可对比的原价，角标一并不下发。
    const badge = resolvePlanBadge(price, originalPrice);
    // 月均价按**实付价**折算：实付价 = 配置价 + 子账号加价，若仍用配置价折算，
    // 同一张卡片会出现「¥498 + 约¥3075/月」这类自相矛盾的展示
    const effectiveMonthlyPrice =
      plan.durationMonths !== null && plan.durationMonths > 0
        ? Math.floor(price / plan.durationMonths)
        : null;

    return {
      id: plan.id,
      name:
        plan.id === 'lifetime' ? LIFETIME_RENEWAL_PLAN_DISPLAY_NAME : plan.name,
      price,
      originalPrice,
      durationMonths: plan.durationMonths ?? null,
      validDays: plan.validDays ?? null,
      ...(hideMonthlyPrice ? {} : { monthlyPrice: effectiveMonthlyPrice }),
      ...(hideOriginalPrice ? { hideOriginalPrice: true } : {}),
      ...(subAccountIncludedCount !== null ? { subAccountIncludedCount } : {}),
      ...(hideMonthlyPrice ? { hideMonthlyPrice: true } : {}),
      ...(badge ? { badge } : {}),
      ...(plan.recommended ? { recommended: true } : {}),
    };
  }
}

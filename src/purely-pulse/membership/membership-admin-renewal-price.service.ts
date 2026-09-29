import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { MembershipPlanCycle } from '@prisma/client';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { Money } from '../../shared/money.utils';
import {
  hasSubAccountPricingEntitlement,
  isSubAccountPricingPlan,
  resolveRenewalPriceFen,
} from '../../purely-profit/member/platform-membership/platform-membership.constants';
import { loadPlanCatalog } from '../../purely-profit/member/platform-membership/platform-membership.query';
import {
  StoreMembershipLockedPriceService,
  type StoreRenewalPricingContext,
} from '../../purely-profit/member/platform-membership/store-membership-locked-price.service';
import type { MembershipPlanConfig } from '../../purely-profit/member/platform-membership/platform-membership.types';
import { PulseMembershipAccessService } from './membership-access.service';
import { PulseMembershipAdminMutationStateService } from './membership-admin-mutation-state.service';
import { resolveAmountFen } from './membership-admin-money.utils';
import type {
  PulseAdminRenewalPriceItem,
  PulseAdminRenewalPriceUpdateItem,
} from './membership.types';

/** 分 → 元展示字符串，与套餐配置、成交价快照保持同一格式化口径 */
const formatYuan = (fen: number): string =>
  Money.fromDbCents(fen).toFixedOutputYuan().replace(/\.00$/, '');

/** 月 / 季不可改价的原因文案：直接展示给运营，避免「改了没反应」的困惑 */
const SUB_ACCOUNT_PLAN_LOCKED_REASON =
  '该门店含子账号权益，门店端只展示年 / 永久档位，月 / 季改价不会生效';

/**
 * 管理端「调整续费价格」。
 *
 * 与「设置会员等级」弹窗的分工：
 * - 设置会员等级 = 一次**成交**，写的是成交总额（记账）与子账号加价（定价）；
 * - 本服务 = 为「单个门店 x 单个档位」议定**未来每次续费**的基础价，
 *   实际生效口径是 `max(当前配置价, 议定价)`：填得比配置价低不会压价，
 *   配置价涨过议定价后也自动跟着涨（详见 `resolveRenewalPriceFen`）。
 *
 * 两者都落在 `store_membership_locked_prices` 的同一行上，但字段互不影响：
 * `upsertDealPrice` 不动覆盖价，本服务也不动成交总额，
 * 因此「设置一次会员等级」不会把运营议定的续费价蒸发掉。
 *
 * 定价一律走 `resolveRenewalPriceFen`，与结算路径同源，
 * 保证「弹窗里看到的价格 = 门店端展示的价格 = 实际扣款」。
 */
@Injectable()
export class PulseMembershipAdminRenewalPriceService {
  private readonly logger = new Logger(
    PulseMembershipAdminRenewalPriceService.name,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly accessService: PulseMembershipAccessService,
    private readonly mutationStateService: PulseMembershipAdminMutationStateService,
    private readonly lockedPriceService: StoreMembershipLockedPriceService,
  ) {}

  /** 读取该会员各档位的续费价现状（含是否被覆盖、能否编辑） */
  async listRenewalPrices(
    user: AuthenticatedUser,
    memberId: number,
  ): Promise<PulseAdminRenewalPriceItem[]> {
    await this.assertAccess(user, memberId);

    const [plans, context] = await Promise.all([
      loadPlanCatalog(this.prisma),
      this.lockedPriceService.loadRenewalPricingContext(memberId),
    ]);

    const hasSubAccount = hasSubAccountPricingEntitlement(context);

    return plans.map((plan) => this.buildItem(plan, context, hasSubAccount));
  }

  /**
   * 批量更新续费价覆盖。
   *
   * `items` 里 `priceDisplay` 为 null / 空串的档位表示**清除覆盖**、恢复默认价，
   * 因此弹窗里清空输入框即可回退，不需要额外的「重置」入口。
   * 未出现在 `items` 里的档位保持原样（前端一次只提交改动过的项）。
   */
  async updateRenewalPrices(
    user: AuthenticatedUser,
    memberId: number,
    items: PulseAdminRenewalPriceUpdateItem[],
  ): Promise<PulseAdminRenewalPriceItem[]> {
    await this.assertAccess(user, memberId);

    if (!Array.isArray(items) || items.length === 0) {
      throw new BadRequestException('请至少调整一个档位的价格');
    }

    const [plans, context] = await Promise.all([
      loadPlanCatalog(this.prisma),
      this.lockedPriceService.loadRenewalPricingContext(memberId),
    ]);

    const hasSubAccount = hasSubAccountPricingEntitlement(context);
    const planMap = new Map(plans.map((plan) => [plan.id, plan]));

    // 先把全部输入解析完再写库：任何一项非法就整批拒绝，
    // 避免出现「前两档改成功了、第三档报错」的半成品状态
    const parsed = items.map((item) => {
      const plan = planMap.get(item.planId);
      if (!plan) {
        throw new BadRequestException(`套餐不存在：${item.planId}`);
      }
      if (hasSubAccount && !isSubAccountPricingPlan(item.planId)) {
        throw new BadRequestException(SUB_ACCOUNT_PLAN_LOCKED_REASON);
      }

      const trimmed =
        typeof item.priceDisplay === 'string' ? item.priceDisplay.trim() : '';
      // 空 = 清除覆盖；非空必须是合法非负金额。
      // 0 与「低于配置价」的取值都照常落库（等配置价回落后可能重新生效），
      // 但按取高者口径当下不生效，实际续费价仍是配置价。
      const overridePrice = trimmed === '' ? null : resolveAmountFen(trimmed);
      if (trimmed !== '' && overridePrice === null) {
        throw new BadRequestException(
          `${plan.name}的续费价格式不正确，请填写非负数字`,
        );
      }

      return { plan, overridePrice };
    });

    const audits: {
      planId: MembershipPlanCycle;
      oldPrice: number | null;
      newPrice: number | null;
    }[] = [];

    await this.prisma.$transaction(async (tx) => {
      for (const { plan, overridePrice } of parsed) {
        const { oldPrice } =
          await this.lockedPriceService.upsertRenewalPriceOverride({
            storeId: memberId,
            planId: plan.id,
            overridePrice,
            fallbackConfigPrice: plan.price,
            executor: tx,
          });

        if (oldPrice !== overridePrice) {
          audits.push({ planId: plan.id, oldPrice, newPrice: overridePrice });
        }
      }

      if (audits.length > 0) {
        await tx.storeMembershipPriceOverrideAudit.createMany({
          data: audits.map((audit) => ({
            storeId: memberId,
            planId: audit.planId,
            oldPrice: audit.oldPrice,
            newPrice: audit.newPrice,
            operatorUserId: this.resolveOperatorId(user),
            operatorName: this.resolveOperatorName(user),
          })),
        });
      }
    });

    if (audits.length > 0) {
      this.logger.warn(
        JSON.stringify({
          event: 'pulse_admin_renewal_price_update',
          storeId: memberId,
          operatorUserId: this.resolveOperatorId(user),
          changed: audits,
        }),
      );
      // 改价影响首页 / 概览里的会员价格相关派生数据。
      // 刻意不调用 invalidateAdminMemberDerived：那里会 kickAllStoreUsers，
      // 为一次改价把商家全部踢下线代价太大。
      // 门店端（purelyProfit 会员中心 / 套餐页）不主动推送失效：
      // 其读缓存 TTL 为 30s，且续费价在每次读时都按 resolveRenewalPriceFen 现算，
      // 因此最迟 30s 后就会展示新价，不必为此承担踢下线的代价。
      await this.mutationStateService.invalidatePulseDashboardHome();
    }

    return this.listRenewalPrices(user, memberId);
  }

  private buildItem(
    plan: MembershipPlanConfig,
    context: StoreRenewalPricingContext,
    hasSubAccount: boolean,
  ): PulseAdminRenewalPriceItem {
    const overridePrice = context.lockedPriceOverrides.get(plan.id) ?? null;
    const subAccountAmount = context.lockedSubAccountAmounts.get(plan.id) ?? 0;

    const renewalPrice = resolveRenewalPriceFen({
      planId: plan.id,
      configPrice: plan.price,
      overridePrice,
      subAccountAmount,
    });

    // 含子账号权益的门店，门店端只给年 / 永久档：月 / 季的价格永远不会展示、
    // 也永远收不到，允许编辑只会让运营改出一个「改了没反应」的价格
    const editable = !hasSubAccount || isSubAccountPricingPlan(plan.id);

    return {
      planId: plan.id,
      planName: plan.name,
      configPriceDisplay: formatYuan(plan.price),
      overridePriceDisplay:
        overridePrice === null ? null : formatYuan(overridePrice),
      // 月 / 季不收子账号的钱，快照里即便残留了误录数据也展示为 0，
      // 与定价口径保持一致
      subAccountAmountDisplay: isSubAccountPricingPlan(plan.id)
        ? formatYuan(subAccountAmount)
        : '0',
      renewalPriceDisplay: formatYuan(renewalPrice),
      editable,
      editableReason: editable ? null : SUB_ACCOUNT_PLAN_LOCKED_REASON,
    };
  }

  private async assertAccess(
    user: AuthenticatedUser,
    memberId: number,
  ): Promise<void> {
    const canAccess = await this.accessService.canAccessAdminMember(
      user,
      memberId,
    );
    if (!canAccess) {
      throw new NotFoundException('会员不存在');
    }
  }

  private resolveOperatorId(user: AuthenticatedUser): number | null {
    const rawId = (user as { id?: unknown }).id;
    // AuthenticatedUser.id 是 number，必须先认这一支；
    // 另兼容 token / 网关注入时被序列化成字符串的场景，避免审计丢操作人
    if (typeof rawId === 'number') {
      return Number.isFinite(rawId) ? rawId : null;
    }
    if (typeof rawId === 'string') {
      const parsed = Number.parseInt(rawId, 10);
      return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
  }

  private resolveOperatorName(user: AuthenticatedUser): string | null {
    const rawName = (user as { name?: unknown }).name;
    return typeof rawName === 'string' && rawName.trim() !== ''
      ? rawName.trim()
      : null;
  }
}

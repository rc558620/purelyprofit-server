import { Injectable, Logger } from '@nestjs/common';
// 仅用于类型别名（不参与运行时求值），使用 import type 避免误入运行时依赖，
// 也避免 isolatedModules 下被 transpiler 保留成无用 import
import type { StoreMembershipLockedPriceSource } from '@prisma/client';
import {
  isSubAccountPricingPlan,
  SUB_ACCOUNT_PRICING_PLAN_IDS,
} from './platform-membership.constants';
import { PrismaService } from '../../../prisma/prisma.service';
import { PlatformMembershipAccessService } from './platform-membership-access.service';
import type { MembershipRuntimeLevel } from './platform-membership-access.service';
import type { PlatformMembershipPlanId } from './dto/platform-membership-query.dto';
import type {
  MembershipPlanConfig,
  PrismaExecutor,
} from './platform-membership.types';

/** 锁定价来源：商家端下单成交 / 平台侧设置会员等级成交 */
export type LockedPriceSource = StoreMembershipLockedPriceSource;

export interface StoreRenewalPricingContext {
  /** 当前生效档位（后端按当前时间实时计算）；会员到期后回落为 'free' */
  level: MembershipRuntimeLevel;
  /**
   * 待续费档位：曾开通子账号功能时取**会员档案里保留的原档位**（到期不回落），
   * 否则与 `level` 相同。续费页据此决定只展示哪一档。
   */
  renewalLevel: MembershipRuntimeLevel;
  /** 是否已开通子账号功能（实时能力口径：归一化后的子账号配额 > 0） */
  subAccountEnabled: boolean;
  /**
   * 是否**曾开通**子账号功能（`pulseSubAccountQuota > 0`）——到期不失效。
   *
   * 档位裁剪、首购锁定价、含子账号权益的展示都必须以本字段为准，
   * 不能用 `subAccountEnabled`。
   */
  subAccountFeatureOwned: boolean;
  /** 套餐含子账号权益时的展示数量：生效中为实际配额，到期后退回档案里的配置额度 */
  subAccountQuota: number;
  /**
   * 门店已成交的各套餐价格（分），key 为套餐标识。
   *
   * **只作记账与快照展示，不参与定价**：续费价恒等于 `当前配置价 + 子账号加价`，
   * 成交总额不再当护城河（旧模型用 max）——平台降价时老客被旧价托住，
   * 会出现「季度月均反而低于年度」的档位倒挂。
   */
  lockedPrices: Map<PlatformMembershipPlanId, number>;
  /**
   * 门店已成交的各套餐子账号加价（分），key 为套餐标识。
   *
   * 定价公式 max 的**左侧**：`当前配置价 + 本字段` = 标准总价。
   * 只收录**已录入**的行；不存在的 key 按 0 处理（存量数据兼容）。
   */
  lockedSubAccountAmounts: Map<PlatformMembershipPlanId, number>;
  /**
   * 门店已成交的各套餐子账号**数量**，key 为套餐标识。
   *
   * 与加价同源：价格是按这个数量算出来的，续费卡展示「包含 N 个子账号」
   * 应当与账单口径一致，而不是实时配额（配额可能已被单独调整过）。
   */
  lockedSubAccountCounts: Map<PlatformMembershipPlanId, number>;
}

export interface ResolvedPlanPrice {
  /** 实际应支付价格（分） */
  price: number;
}

/** 成交价快照条目（含来源与锁定时点，管理端展示用） */
export interface LockedPriceSnapshot {
  planId: PlatformMembershipPlanId;
  /** 成交总额（分） */
  price: number;
  /** 子账号加价（分）；null 表示运营尚未录入 */
  subAccountAmount: number | null;
  /** 子账号数量；null 表示运营尚未录入 */
  subAccountCount: number | null;
  source: LockedPriceSource;
  lockedAt: Date;
}

/**
 * 会员套餐成交价快照与续费定价。
 *
 * 业务背景：年度 / 永久会员支持子账号功能，平台会为「含子账号权益」调高套餐价。
 * 套餐基础价日后还会调整，因此拆成两个分量各自处理：
 *
 * ```
 * 续费价 = 当前配置价 + 子账号加价
 *          └─ 随调价涨跌 ─┘   └─ 长期锁定 ─┘
 * ```
 *
 * 「成交总额不参与定价」是有意设计：若把成交价当护城河（旧模型用 max），
 * 平台**降价**时老客被旧价托住、其它档位却跟降，档位间比例会倒挂
 * （季度月均反而低于年度）。统一按标准定价后，同一档位永远同价。
 *
 * 规则：
 * - 成交（商家端下单成功 / 平台侧设置会员等级）即写入快照，
 *   **不再区分门店是否开通子账号**——那是档位裁剪的事，不该决定要不要记录成交价
 * - 商家端自助购买走 `lockPriceOnFirstDeal`：已存在**不覆盖**（首充语义）
 * - 管理端「设置会员等级」走 `upsertDealPrice`：**覆盖**（一次显式成交 / 重新议价）
 * - `subAccountAmount` 为空时按 0 处理，存量数据自动回退到旧口径，无需数据迁移
 * - `resetLockedPrices` 只允许由管理端显式触发；关闭子账号能力不再自动清空成交价，
 *   否则「客户降级为免费后再次开通」会丢失历史价
 */
@Injectable()
export class StoreMembershipLockedPriceService {
  private readonly logger = new Logger(StoreMembershipLockedPriceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accessService: PlatformMembershipAccessService,
  ) {}

  /**
   * 读取门店全部成交价快照（含来源与锁定时点），供管理端展示「当前成交的是什么价」。
   *
   * 结算 / 定价路径请用 `loadDealPriceSnapshots`（Map，避免为每行构造对象）。
   */
  async listLockedPrices(
    storeId: number,
    executor: PrismaExecutor = this.prisma,
  ): Promise<LockedPriceSnapshot[]> {
    const rows = await executor.storeMembershipLockedPrice.findMany({
      where: { storeId },
      select: {
        planId: true,
        price: true,
        subAccountAmount: true,
        subAccountCount: true,
        source: true,
        lockedAt: true,
      },
      orderBy: { planId: 'asc' },
    });

    return rows.map((row) => ({
      planId: row.planId as PlatformMembershipPlanId,
      price: row.price,
      subAccountAmount: row.subAccountAmount,
      subAccountCount: row.subAccountCount,
      source: row.source,
      lockedAt: row.lockedAt,
    }));
  }

  /**
   * 读取门店成交价快照，返回定价公式两侧所需的两张表。
   *
   * - `prices`：成交总额，只作记账 / 快照展示，不参与定价
   * - `subAccountAmounts`：子账号加价，`当前配置价 + 本字段` 的组成部分，是唯一的定价输入
   *
   * `subAccountAmounts` **只收录已录入的行**：缺失与该 key 不存在等价（按 0 处理），
   * 存量为 `null` 的数据因此自动回退旧口径，不会被误判成「这家店子账号不要钱」。
   */
  async loadDealPriceSnapshots(
    storeId: number,
    executor: PrismaExecutor = this.prisma,
  ): Promise<{
    prices: Map<PlatformMembershipPlanId, number>;
    subAccountAmounts: Map<PlatformMembershipPlanId, number>;
    subAccountCounts: Map<PlatformMembershipPlanId, number>;
  }> {
    const rows = await executor.storeMembershipLockedPrice.findMany({
      where: { storeId },
      select: {
        planId: true,
        price: true,
        subAccountAmount: true,
        subAccountCount: true,
      },
    });

    const prices = new Map<PlatformMembershipPlanId, number>();
    const subAccountAmounts = new Map<PlatformMembershipPlanId, number>();
    const subAccountCounts = new Map<PlatformMembershipPlanId, number>();

    for (const row of rows) {
      const planId = row.planId as PlatformMembershipPlanId;
      prices.set(planId, row.price);
      // 用 typeof 而非 `!== null` 兜底：select 漏字段、或是 mock 返回残行时
      // 值是 undefined，`!== null` 会让 undefined 混进表里
      if (typeof row.subAccountAmount === 'number') {
        subAccountAmounts.set(planId, row.subAccountAmount);
      }
      if (typeof row.subAccountCount === 'number') {
        subAccountCounts.set(planId, row.subAccountCount);
      }
    }

    return { prices, subAccountAmounts, subAccountCounts };
  }

  /**
   * 子账号分量是否非法：必须是非负整数。
   *
   * `undefined`（本次不动这两个字段）与 `null`（置空）都是合法取值，
   * 只有真正传了数字才校验——否则负的加价会把标准总价算小。
   */
  private isInvalidSubAccountValue(value: number | null | undefined): boolean {
    return (
      value !== undefined &&
      value !== null &&
      (!Number.isInteger(value) || value < 0)
    );
  }

  /**
   * 首次成交时写入成交价快照。
   *
   * 已存在快照时不覆盖（「首充锁定」语义），返回 false 表示沿用原成交价。
   * 管理端重新议定价格要走 `upsertDealPrice`，不要用这个。
   *
   * ⚠️ 这里**不再**限定「只有曾开通子账号功能的门店才写入」。
   * 早期实现为了规避「门店日后开通子账号、旧价突然生效」而跳过写入，
   * 代价是运营洽谈的价格被静默丢弃——未开通子账号的门店一律按配置价续费，
   * 议出的高价次年就蒸发。新公式两侧都以「成交事实」为准，
   * 「是否开通子账号」只影响档位裁剪，不再决定要不要记录成交价。
   */
  async lockPriceOnFirstDeal(params: {
    storeId: number;
    planId: PlatformMembershipPlanId;
    price: number;
    source: LockedPriceSource;
    executor?: PrismaExecutor;
    /** 子账号加价（分）；不传表示本次不涉及子账号，落库为 NULL */
    subAccountAmount?: number | null;
    /** 子账号数量；不传表示本次不涉及子账号，落库为 NULL */
    subAccountCount?: number | null;
  }): Promise<boolean> {
    const {
      storeId,
      planId,
      price,
      source,
      executor = this.prisma,
      subAccountAmount = null,
      subAccountCount = null,
    } = params;

    if (!Number.isInteger(price) || price < 0) {
      this.logger.warn(
        `[locked-price] 忽略非法成交价 storeId=${storeId} planId=${planId} price=${price}`,
      );
      return false;
    }

    if (
      this.isInvalidSubAccountValue(subAccountAmount) ||
      this.isInvalidSubAccountValue(subAccountCount)
    ) {
      this.logger.warn(
        `[locked-price] 忽略非法子账号分量 storeId=${storeId} planId=${planId} subAccountAmount=${subAccountAmount} subAccountCount=${subAccountCount}`,
      );
      return false;
    }

    const created = await executor.storeMembershipLockedPrice.createMany({
      data: [
        {
          storeId,
          planId,
          price,
          subAccountAmount,
          subAccountCount,
          source,
        },
      ],
      skipDuplicates: true,
    });

    return created.count > 0;
  }

  /**
   * 写入 / **覆盖**成交价快照：管理端「设置会员等级」是一次显式成交，
   * 运营填的价格必须立即生效，否则会出现「改了价却查不到效果」。
   *
   * 商家端自助购买仍走 `lockPriceOnFirstDeal` 保持首充语义。
   *
   * `subAccountAmount` / `subAccountCount` 传 `undefined` 表示本次不动这两个字段，
   * 传 `null` 表示清空（例如关闭子账号能力后不应再收子账号的钱）。
   */
  async upsertDealPrice(params: {
    storeId: number;
    planId: PlatformMembershipPlanId;
    price: number;
    source: LockedPriceSource;
    executor?: PrismaExecutor;
    subAccountAmount?: number | null;
    subAccountCount?: number | null;
  }): Promise<void> {
    const {
      storeId,
      planId,
      price,
      source,
      executor = this.prisma,
      subAccountAmount,
      subAccountCount,
    } = params;

    if (!Number.isInteger(price) || price < 0) {
      this.logger.warn(
        `[locked-price] 忽略非法成交价 storeId=${storeId} planId=${planId} price=${price}`,
      );
      return;
    }

    // 子账号分量同样是定价公式的输入，非法值会让标准总价被算小，
    // 必须与 price 一样拦在写入之前
    if (
      this.isInvalidSubAccountValue(subAccountAmount) ||
      this.isInvalidSubAccountValue(subAccountCount)
    ) {
      this.logger.warn(
        `[locked-price] 忽略非法子账号分量 storeId=${storeId} planId=${planId} subAccountAmount=${subAccountAmount} subAccountCount=${subAccountCount}`,
      );
      return;
    }

    this.logger.warn(
      JSON.stringify({
        event: 'store_membership_deal_price_upsert',
        storeId,
        planId,
        price,
        subAccountAmount: subAccountAmount ?? null,
        subAccountCount: subAccountCount ?? null,
        source,
      }),
    );

    await executor.storeMembershipLockedPrice.upsert({
      where: { storeId_planId: { storeId, planId } },
      create: {
        storeId,
        planId,
        price,
        subAccountAmount: subAccountAmount ?? null,
        subAccountCount: subAccountCount ?? null,
        source,
      },
      update: {
        price,
        source,
        // 重新议定的时刻，而非首充时刻
        lockedAt: new Date(),
        ...(subAccountAmount !== undefined ? { subAccountAmount } : {}),
        ...(subAccountCount !== undefined ? { subAccountCount } : {}),
      },
    });
  }

  /**
   * 重置成交价快照；不传 planId 时清空门店全部。返回清除条数。
   *
   * ⚠️ 只允许由管理端「重置成交价」显式触发。**不得**由关闭子账号能力等副作用
   * 自动调用：客户降级为免费后再次开通时，必须还能读到历史成交价。
   */
  async resetLockedPrices(
    storeId: number,
    planId?: PlatformMembershipPlanId,
  ): Promise<number> {
    const result = await this.prisma.storeMembershipLockedPrice.deleteMany({
      where: planId ? { storeId, planId } : { storeId },
    });

    if (result.count > 0) {
      this.logger.warn(
        JSON.stringify({
          event: 'store_membership_locked_price_reset',
          storeId,
          planId: planId ?? null,
          clearedCount: result.count,
        }),
      );
    }

    return result.count;
  }

  /**
   * 清空门店的子账号加价：关闭子账号能力后不应继续收子账号的钱。
   *
   * 只置空子账号两列，**保留** `price` 成交总额——
   * 于是续费价退化成纯配置价（成交总额不参与定价，保留它只为对账与快照展示）。
   * 返回受影响行数。
   *
   * ⚠️ 只走 `this.prisma`：调用方（关闭子账号能力）不在事务里，
   * 一旦将来把它挪进事务，这里会读到事务外的数据。需要事务支持时请加 `executor` 参数。
   */
  async clearSubAccountAmounts(storeId: number): Promise<number> {
    const result = await this.prisma.storeMembershipLockedPrice.updateMany({
      // 两列任一非空都要清：只判 `subAccountAmount` 会漏掉
      // 「数量已录入、加价仍是 NULL」的行，关掉子账号后数量却还挂着
      where: {
        storeId,
        OR: [
          { subAccountAmount: { not: null } },
          { subAccountCount: { not: null } },
        ],
      },
      data: { subAccountAmount: null, subAccountCount: null },
    });

    if (result.count > 0) {
      this.logger.warn(
        JSON.stringify({
          event: 'store_membership_sub_account_amount_cleared',
          storeId,
          clearedCount: result.count,
        }),
      );
    }

    return result.count;
  }

  /**
   * 补录 / 撤销子账号加价：**只动子账号字段，不碰成交总额**。
   *
   * 面向存量门店——它们成交时还没拆分口径，成交总额本身是对的，
   * 缺的只是「子账号那部分值多少」这一个分量。补录后定价公式立即切换：
   * 标准总价从 `配置价` 变成 `配置价 + 子账号加价`，配置涨价也能正确传导。
   *
   * 传 `null` 即撤销补录，续费价回到纯配置价口径（成交总额不参与定价）。
   * 返回 false 表示该门店该档位没有成交记录（补录无从附着）。
   */
  async updateSubAccountSnapshot(params: {
    storeId: number;
    planId: PlatformMembershipPlanId;
    subAccountAmount: number | null;
    subAccountCount: number | null;
    executor?: PrismaExecutor;
  }): Promise<boolean> {
    const { storeId, planId, subAccountAmount, subAccountCount } = params;
    const executor = params.executor ?? this.prisma;

    if (
      subAccountAmount !== null &&
      (!Number.isInteger(subAccountAmount) || subAccountAmount < 0)
    ) {
      this.logger.warn(
        `[locked-price] 忽略非法子账号加价 storeId=${storeId} planId=${planId} subAccountAmount=${subAccountAmount}`,
      );
      return false;
    }

    // 数量与加价同源，同样要拦：写进负数 / 小数会让续费卡展示「包含 -1 个子账号」
    if (
      subAccountCount !== null &&
      (!Number.isInteger(subAccountCount) || subAccountCount < 0)
    ) {
      this.logger.warn(
        `[locked-price] 忽略非法子账号数量 storeId=${storeId} planId=${planId} subAccountCount=${subAccountCount}`,
      );
      return false;
    }

    this.logger.warn(
      JSON.stringify({
        event: 'store_membership_sub_account_amount_backfilled',
        storeId,
        planId,
        subAccountAmount,
        subAccountCount,
      }),
    );

    const result = await executor.storeMembershipLockedPrice.updateMany({
      where: { storeId, planId },
      data: { subAccountAmount, subAccountCount },
    });

    return result.count > 0;
  }

  /**
   * 列出「有子账号、但成交价快照里没有子账号加价」的门店，供运营批量补录。
   *
   * 判据用 `pulseSubAccountQuota > 0`（曾开通，到期不失效）——到期门店同样需要补录，
   * 否则配置价一涨过成交总额，它们就会按「不含子账号」的标准价续费，白送子账号。
   */
  async listStoresPendingSubAccountBackfill(): Promise<number[]> {
    const profiles = await this.prisma.storeMembershipProfile.findMany({
      where: { pulseSubAccountQuota: { gt: 0 } },
      select: { storeId: true },
    });

    if (profiles.length === 0) {
      return [];
    }

    const storeIds = profiles.map((profile) => profile.storeId);

    // 需要「至少有一个年 / 永久档位缺子账号加价」才算待补录：
    // 月 / 季会员开不了子账号，它们的快照永远不需要补录，不该把门店捞进清单
    const pendingRows = await this.prisma.storeMembershipLockedPrice.findMany({
      where: {
        storeId: { in: storeIds },
        planId: { in: [...SUB_ACCOUNT_PRICING_PLAN_IDS] },
        subAccountAmount: null,
      },
      select: { storeId: true },
      distinct: ['storeId'],
    });

    return pendingRows.map((row) => row.storeId);
  }

  /**
   * 加载续费定价上下文：当前档位 + 待续费档位 + 子账号能力 + 已锁定价格。
   *
   * executor 需一路透传到子账号能力快照读取，保证「能力快照」与「锁定价」
   * 在同一事务快照下取值，避免下单事务内的价格基于事务外的能力状态计算。
   */
  async loadRenewalPricingContext(
    storeId: number,
    executor: PrismaExecutor = this.prisma,
  ): Promise<StoreRenewalPricingContext> {
    const [bonusSnapshot, dealSnapshots] = await Promise.all([
      this.accessService.getSubAccountBenefitSnapshot(storeId, executor),
      this.loadDealPriceSnapshots(storeId, executor),
    ]);

    return {
      level: bonusSnapshot.level,
      // 到期后 bonusSnapshot.level 会回落成 'free'，续费保护必须用档案里的原档位
      renewalLevel: bonusSnapshot.featureOwned
        ? bonusSnapshot.previousLevel
        : bonusSnapshot.level,
      subAccountEnabled: bonusSnapshot.enabled,
      subAccountFeatureOwned: bonusSnapshot.featureOwned,
      // 到期后配额被归零（能力已收回），但续费卡仍需说明「包含 x 个子账号」，
      // 退回档案里配置的原始额度
      subAccountQuota: bonusSnapshot.enabled
        ? bonusSnapshot.quota
        : bonusSnapshot.rawQuota,
      lockedPrices: dealSnapshots.prices,
      lockedSubAccountAmounts: dealSnapshots.subAccountAmounts,
      lockedSubAccountCounts: dealSnapshots.subAccountCounts,
    };
  }

  /**
   * 解析套餐实际支付价。
   *
   * **定价公式：`当前配置价 + 子账号加价`**
   *
   * - `当前配置价` 实时读取 `membership_plan_setting`，因此平台**涨价与降价都能传导**
   *   给所有门店，同一档位的所有客户永远同价，档位之间的比例恒等于配置价之比
   *   （不会出现「季度月均比年度还便宜」的倒挂）。
   * - `子账号加价` 是唯一长期锁定的分量：它在成交时由运营录入，之后不随配置价变动，
   *   客户续费时持续按这个金额收。
   * - 成交总额（`price`）**不参与定价**，只作记账 / 流水用途：
   *   运营在管理端议出的价格只对本次充值和续费生效，不锁定未来。
   *
   * 展示价（套餐列表）与实付价（预览 / 下单）必须走同一入口，否则会出现
   * 「看到的价格 ≠ 实际扣款」。
   */
  resolvePlanPrice(params: {
    plan: Pick<MembershipPlanConfig, 'id' | 'price'>;
    context: StoreRenewalPricingContext;
  }): ResolvedPlanPrice {
    const { plan, context } = params;

    // 子账号加价只对年 / 永久档位参与定价：月 / 季开不了子账号，
    // 即便快照里残留了误录数据也不得计入
    const subAccountAmount = isSubAccountPricingPlan(plan.id)
      ? (context.lockedSubAccountAmounts.get(plan.id) ?? 0)
      : 0;

    return { price: plan.price + subAccountAmount };
  }
}

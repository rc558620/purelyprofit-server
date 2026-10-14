import { Injectable, Logger } from '@nestjs/common';
import { resolveRenewalPriceFen } from './platform-membership.constants';
import { PrismaService } from '../../../prisma/prisma.service';
import { PlatformMembershipAccessService } from './platform-membership-access.service';
import type { PlatformMembershipPlanId } from './dto/platform-membership-query.dto';
import type {
  MembershipPlanConfig,
  PrismaExecutor,
} from './platform-membership.types';
import {
  findDealPriceRows,
  findLockedPriceAuditRows,
  findStoresEverRenewalPriceAdjusted,
  findStoresPendingSubAccountBackfill,
} from './store-membership-locked-price.query';
import {
  collectDealPriceSnapshots,
  toLockedPriceSnapshots,
} from './store-membership-locked-price.shared';
import type {
  DealPriceSnapshotTables,
  LockedPriceSnapshot,
  LockedPriceSource,
  ResolvedPlanPrice,
  StoreRenewalPricingContext,
} from './store-membership-locked-price.types';
import {
  clearStoreSubAccountAmounts,
  resetStoreLockedPrices,
  writeDealPriceUpsert,
  writeFirstDealPrice,
  writeRenewalPriceOverride,
  writeSubAccountSnapshot,
} from './store-membership-locked-price.write';

/** 对外保持原有导入路径，类型实现已下沉到 `.types.ts` */
export type {
  LockedPriceSource,
  LockedPriceSnapshot,
  ResolvedPlanPrice,
  StoreRenewalPricingContext,
} from './store-membership-locked-price.types';

/**
 * 会员套餐成交价快照与续费定价。
 *
 * 业务背景：年度 / 永久会员支持子账号功能，平台会为「含子账号权益」调高套餐价。
 * 套餐基础价日后还会调整，因此拆成两个分量各自处理：
 *
 * ```
 * 续费价 = max(当前配置价, 议定价) + 子账号加价
 *                          └─ 随调价涨跌 ─┘   └─ 长期锁定 ─┘
 * ```
 *
 * 「议定价与配置价取高者」是有意设计：配置价上调必须传导到所有门店（议定价低于
 * 配置价时仍按配置价收），议定价高于配置价时又不能被配置价吞掉。
 *
 * 「成交总额不参与定价」同样是有意设计：若把成交价当护城河，平台**降价**时老客
 * 被旧成交价托住、其它档位却跟降，档位间比例会倒挂（季度月均反而低于年度）。
 * 成交总额只回显记账，定价基数一律按上面那条。
 *
 * 规则：
 * - 成交（商家端下单成功 / 平台侧设置会员等级）即写入快照，**不再区分门店是否
 *   开通子账号**——那是档位裁剪的事，不该决定要不要记录成交价
 * - 商家端自助购买走 `lockPriceOnFirstDeal`：已存在**不覆盖**（首充语义）
 * - 管理端「设置会员等级」走 `upsertDealPrice`：**覆盖**（一次显式成交 / 重新议价）
 * - `subAccountAmount` 为空时按 0 处理，存量数据自动回退到旧口径，无需数据迁移
 * - `resetLockedPrices` 只允许由管理端显式触发；关闭子账号能力不再自动清空成交价，
 *   否则「客户降级为免费后再次开通」会丢失历史价
 *
 * 本类是 Nest 注入入口，**只做参数装配**：写路径（校验 → 审计日志 → 落库）在
 * `.write.ts`，SQL 一律在 `.query.ts`，纯计算与校验在 `.shared.ts`。
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
   *
   * 只返回**确实成交过**的行：仅为承载续费价覆盖而建的占位行（`dealLockedAt` 为空）
   * 会被剔除——它的 `price` 只是建行时抄的配置价，当成成交价展示会误导运营。
   */
  async listLockedPrices(
    storeId: number,
    executor: PrismaExecutor = this.prisma,
  ): Promise<LockedPriceSnapshot[]> {
    const rows = await findLockedPriceAuditRows(executor, storeId);

    return toLockedPriceSnapshots(rows);
  }

  /**
   * 读取门店成交价快照，返回定价公式两侧所需的四张表。
   *
   * 各表的收录口径见 `collectDealPriceSnapshots`。
   */
  async loadDealPriceSnapshots(
    storeId: number,
    executor: PrismaExecutor = this.prisma,
  ): Promise<DealPriceSnapshotTables> {
    const rows = await findDealPriceRows(executor, storeId);

    return collectDealPriceSnapshots(rows);
  }

  /**
   * 首次成交时写入成交价快照；返回 false 表示沿用原成交价。
   * 管理端重新议定价格要走 `upsertDealPrice`，不要用这个。
   *
   * ⚠️ 「已成交」以 `dealLockedAt` 为准而非「行是否存在」，因此运营先议定续费价
   * 时建下的占位行会被首笔成交认领（而不是挡住写入）。详见 `writeFirstDealPrice`。
   *
   * ⚠️ 这里**不再**限定「只有曾开通子账号功能的门店才写入」。
   * 早期实现为了规避「门店日后开通子账号、旧价突然生效」而跳过写入，
   * 代价是运营洽谈的价格被静默丢弃——未开通子账号的门店一律按配置价续费，
   * 议出的高价次年就蒸发。定价基数改看「当前配置价与议定价的较高者」后，
   * 「是否开通子账号」只影响档位裁剪，不再决定要不要记录成交价。
   */
  lockPriceOnFirstDeal(params: {
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
    const { executor = this.prisma, ...writeParams } = params;

    return writeFirstDealPrice(this.logger, executor, writeParams);
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
  upsertDealPrice(params: {
    storeId: number;
    planId: PlatformMembershipPlanId;
    price: number;
    source: LockedPriceSource;
    executor?: PrismaExecutor;
    subAccountAmount?: number | null;
    subAccountCount?: number | null;
  }): Promise<void> {
    const { executor = this.prisma, ...writeParams } = params;

    return writeDealPriceUpsert(this.logger, executor, writeParams);
  }

  /**
   * 重置成交价快照；不传 planId 时清空门店全部。返回清除条数。
   *
   * ⚠️ 只允许由管理端「重置成交价」显式触发。**不得**由关闭子账号能力等副作用
   * 自动调用：客户降级为免费后再次开通时，必须还能读到历史成交价。
   *
   * 只走 `this.prisma`：本方法不在事务里，一旦将来把它挪进事务，这里会读到事务外
   * 的数据。需要事务支持时请加 `executor` 参数。
   */
  resetLockedPrices(
    storeId: number,
    planId?: PlatformMembershipPlanId,
  ): Promise<number> {
    return resetStoreLockedPrices(this.logger, this.prisma, storeId, planId);
  }

  /**
   * 清空门店的子账号加价：关闭子账号能力后不应继续收子账号的钱。返回受影响行数。
   *
   * ⚠️ 只走 `this.prisma`：调用方（关闭子账号能力）不在事务里，
   * 一旦将来把它挪进事务，这里会读到事务外的数据。需要事务支持时请加 `executor` 参数。
   */
  clearSubAccountAmounts(storeId: number): Promise<number> {
    return clearStoreSubAccountAmounts(this.logger, this.prisma, storeId);
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
  updateSubAccountSnapshot(params: {
    storeId: number;
    planId: PlatformMembershipPlanId;
    subAccountAmount: number | null;
    subAccountCount: number | null;
    executor?: PrismaExecutor;
  }): Promise<boolean> {
    const { executor = this.prisma, ...writeParams } = params;

    return writeSubAccountSnapshot(this.logger, executor, writeParams);
  }

  /**
   * 列出「有子账号、但成交价快照里没有子账号加价」的门店，供运营批量补录。
   *
   * `storeIds` 是必须项（先用可见门店收窄查询），判据详见
   * `findStoresPendingSubAccountBackfill`。
   */
  listStoresPendingSubAccountBackfill(storeIds: number[]): Promise<number[]> {
    return findStoresPendingSubAccountBackfill(this.prisma, storeIds);
  }

  /**
   * 列出「续费价**被调整过**」的门店，供管理端筛选复核。
   *
   * 口径是**曾经调过**而非「当前还调着」；`storeIds` 是必须项。
   * 判据与兜底详见 `findStoresEverRenewalPriceAdjusted`。
   */
  listStoresEverRenewalPriceAdjusted(storeIds: number[]): Promise<number[]> {
    return findStoresEverRenewalPriceAdjusted(this.prisma, storeIds);
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
      lockedPriceOverrides: dealSnapshots.priceOverrides,
      lockedSubAccountAmounts: dealSnapshots.subAccountAmounts,
      lockedSubAccountCounts: dealSnapshots.subAccountCounts,
    };
  }

  /**
   * 解析套餐实际支付价。
   *
   * **定价公式：`max(当前配置价, 议定价) + 子账号加价`**
   *
   * - `当前配置价` 实时读取 `membership_plan_setting`，因此平台**涨价与降价都能传导**
   *   给所有门店（议定价低于配置价时不生效），档位之间的比例始终跟配置价走，
   *   不会出现「季度月均比年度还便宜」的倒挂。
   * - `议定价` 是运营为**单个门店 x 单个档位**谈下来的基础价，按档位独立存储。
   *   它只在**高于配置价**时生效（成交价高于标准价的客户续费不该被配置价打回原形）；
   *   低于配置价一律按配置价收——陈旧的低价必须被配置价上涨顶掉。
   *   它取代的只是基数，不是最终续费价，年 / 永久档位的子账号加价仍然叠加，
   *   两者正交：既不会重复计价，也不会吞掉已经议定的子账号费用。
   *   未议定（key 不存在或值为 null）时完全回落到标准口径。
   * - `子账号加价` 同为长期锁定的分量：成交时由运营录入，之后不随配置价变动。
   * - 成交总额（`price`）**不参与定价**，只作记账 / 流水用途。
   *
   * 展示价（套餐列表）、管理端预览价与实付价（预览 / 下单）必须走同一入口，
   * 否则会出现「看到的价格 ≠ 实际扣款」。
   */
  resolvePlanPrice(params: {
    plan: Pick<MembershipPlanConfig, 'id' | 'price'>;
    context: StoreRenewalPricingContext;
  }): ResolvedPlanPrice {
    const { plan, context } = params;

    return {
      price: resolveRenewalPriceFen({
        planId: plan.id,
        configPrice: plan.price,
        overridePrice: context.lockedPriceOverrides.get(plan.id),
        subAccountAmount: context.lockedSubAccountAmounts.get(plan.id),
      }),
    };
  }

  /**
   * 写入 / 清除某个门店某档位的**续费价覆盖**。
   *
   * 与 `upsertDealPrice`（设置会员等级）的关键区别：
   * - 本方法只动 `renewalPriceOverride`，**不触碰** `price` / `subAccountAmount`
   *   / `subAccountCount`，因此不会污染成交记账，也不会因为一次「设置会员等级」
   *   就把运营议定的覆盖价清掉。
   * - 传 `null` 表示清除覆盖、恢复标准口径（配置价 + 子账号加价）。
   *   传入的价位**低于当前配置价**时照常落库，但按取高者口径不会生效——
   *   等配置价回落到它之下才重新生效，因此不做丢弃也不做裁剪。
   *
   * 门店首次覆盖时该档位可能还没有成交快照行，因此用 upsert 建行：
   * `price` 以当前配置价兜底（纯记账占位，不参与定价），`source` 写 admin，
   * 且**刻意不写 `dealLockedAt`** —— 本行此刻只是承载覆盖价的占位行，
   * 不是一次成交：它不进「成交价快照」展示，也不会拦住商家首次成交的写入
   * （`lockPriceOnFirstDeal` 见到 `dealLockedAt` 为空会认领本行并补上真实成交分量）。
   */
  upsertRenewalPriceOverride(params: {
    storeId: number;
    planId: PlatformMembershipPlanId;
    /** 覆盖价（分）；null = 清除覆盖 */
    overridePrice: number | null;
    /** 建行兜底用的当前配置价（分） */
    fallbackConfigPrice: number;
    executor?: PrismaExecutor;
  }): Promise<{ oldPrice: number | null }> {
    const { executor = this.prisma, ...writeParams } = params;

    return writeRenewalPriceOverride(this.logger, executor, writeParams);
  }
}

import { BadRequestException, Injectable, Logger } from '@nestjs/common';
// 仅用于类型别名（不参与运行时求值），使用 import type 避免误入运行时依赖，
// 也避免 isolatedModules 下被 transpiler 保留成无用 import
import type { StoreMembershipLockedPriceSource } from '@prisma/client';
import {
  resolveRenewalPriceFen,
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
   * **只作记账与快照展示，不参与定价**：续费价基数只取「当前配置价与议定价的
   * 较高者」，成交总额不当护城河——否则平台降价时老客被旧成交价托住，
   * 会出现「季度月均反而低于年度」的档位倒挂。
   */
  lockedPrices: Map<PlatformMembershipPlanId, number>;
  /**
   * 运营为该门店单独议定的**基础价**（分），key 为套餐标识。
   *
   * 定价公式的基数部分：`max(当前配置价, 本表对应值) + 子账号加价`。
   * 只收录**已议定**的档位；key 不存在即按「未议定」处理，完全回落标准口径。
   */
  lockedPriceOverrides: Map<PlatformMembershipPlanId, number>;
  /**
   * 门店已成交的各套餐子账号加价（分），key 为套餐标识。
   *
   * 定价公式 max 的**右侧加数**：`max(当前配置价, 议定价) + 本字段` = 标准总价。
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
  /** 续费价覆盖（分）；null 表示该档位未覆盖，按配置价走 */
  renewalPriceOverride: number | null;
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
 * 续费价 = max(当前配置价, 议定价) + 子账号加价
 *                          └─ 随调价涨跌 ─┘   └─ 长期锁定 ─┘
 * ```
 *
 * 「议定价与配置价取高者」是有意设计：配置价上调必须传导到所有门店
 * （议定价低于配置价时仍按配置价收，陈旧的低价压不住平台的涨价），
 * 议定价高于配置价时又不能被配置价吞掉（那是运营谈下来的高价）。
 *
 * 「成交总额不参与定价」同样是有意设计：若把成交价当护城河，
 * 平台**降价**时老客被旧成交价托住、其它档位却跟降，档位间比例会倒挂
 * （季度月均反而低于年度）。成交总额只回显记账，定价基数一律按上面那条。
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
   *
   * 只返回**确实成交过**的行：仅为承载续费价覆盖而建的占位行（`dealLockedAt` 为空）
   * 会被剔除——它的 `price` 只是建行时抄的配置价，当成成交价展示会误导运营。
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
        renewalPriceOverride: true,
        dealLockedAt: true,
        source: true,
        lockedAt: true,
      },
      orderBy: { planId: 'asc' },
    });

    return rows
      // typeof 兜底：mock 残行 / 漏 select 的行该字段为 undefined，
      // 此时按「已成交」处理，不改变旧行为
      .filter(
        (row) =>
          typeof row.dealLockedAt === 'undefined' || row.dealLockedAt !== null,
      )
      .map((row) => ({
        planId: row.planId as PlatformMembershipPlanId,
        price: row.price,
        subAccountAmount: row.subAccountAmount,
        subAccountCount: row.subAccountCount,
        renewalPriceOverride: row.renewalPriceOverride,
        source: row.source,
        lockedAt: row.lockedAt,
      }));
  }

  /**
   * 读取门店成交价快照，返回定价公式两侧所需的两张表。
   *
   * - `prices`：成交总额，只作记账 / 快照展示，不参与定价
   * - `priceOverrides`：运营议定的基础价，与当前配置价**取高者**作为定价基数
   * - `subAccountAmounts`：子账号加价，`max(当前配置价, 议定价) + 本字段` 的组成部分
   *
   * `subAccountAmounts` **只收录已录入的行**：缺失与该 key 不存在等价（按 0 处理），
   * 存量为 `null` 的数据因此自动回退旧口径，不会被误判成「这家店子账号不要钱」。
   * `priceOverrides` 同理只收录**已议定**的档位。
   */
  async loadDealPriceSnapshots(
    storeId: number,
    executor: PrismaExecutor = this.prisma,
  ): Promise<{
    prices: Map<PlatformMembershipPlanId, number>;
    priceOverrides: Map<PlatformMembershipPlanId, number>;
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
        renewalPriceOverride: true,
        dealLockedAt: true,
      },
    });

    const prices = new Map<PlatformMembershipPlanId, number>();
    const priceOverrides = new Map<PlatformMembershipPlanId, number>();
    const subAccountAmounts = new Map<PlatformMembershipPlanId, number>();
    const subAccountCounts = new Map<PlatformMembershipPlanId, number>();

    for (const row of rows) {
      const planId = row.planId as PlatformMembershipPlanId;
      // 成交总额只收录真正成交过的行：占位行（仅承载续费价覆盖）的 price
      // 是建行时抄的配置价，收进来会被当成该门店的成交价。
      // typeof 兜底同上：字段缺失时按已成交处理，不改旧行为。
      if (
        typeof row.dealLockedAt === 'undefined' ||
        row.dealLockedAt !== null
      ) {
        prices.set(planId, row.price);
      }
      // 用 typeof 而非 `!== null` 兜底：select 漏字段、或是 mock 返回残行时
      // 值是 undefined，`!== null` 会让 undefined 混进表里
      if (typeof row.subAccountAmount === 'number') {
        subAccountAmounts.set(planId, row.subAccountAmount);
      }
      if (typeof row.subAccountCount === 'number') {
        subAccountCounts.set(planId, row.subAccountCount);
      }
      if (typeof row.renewalPriceOverride === 'number') {
        priceOverrides.set(planId, row.renewalPriceOverride);
      }
    }

    return { prices, priceOverrides, subAccountAmounts, subAccountCounts };
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
   * 已**成交**过的档位不覆盖（「首充锁定」语义），返回 false 表示沿用原成交价。
   * 管理端重新议定价格要走 `upsertDealPrice`，不要用这个。
   *
   * ⚠️ 「是否已成交」以 `dealLockedAt` 为准，**不是**「行是否存在」：
   * 运营先在管理端议定续费价时，`upsertRenewalPriceOverride` 会为尚无成交的档位
   * 建一行占位行（`dealLockedAt` 为空、price 抄的是当时的配置价）。若沿用
   * `createMany + skipDuplicates`，这类行会挡住商家首次成交的写入——
   * 真实成交价与 `source: purchase` 永久丢失，快照里留下一个假成交价。
   * 因此先尝试「认领占位行」，只有行确实不存在时才新建。
   *
   * ⚠️ 这里**不再**限定「只有曾开通子账号功能的门店才写入」。
   * 早期实现为了规避「门店日后开通子账号、旧价突然生效」而跳过写入，
   * 代价是运营洽谈的价格被静默丢弃——未开通子账号的门店一律按配置价续费，
   * 议出的高价次年就蒸发。定价基数改看「当前配置价与议定价的较高者」后，
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

    // 先认领「尚未成交」的行：它可能只是运营议定续费价时建的占位行，
    // 必须让首笔成交的真实金额与来源落进去
    const claimed = await executor.storeMembershipLockedPrice.updateMany({
      where: { storeId, planId, dealLockedAt: null },
      data: {
        price,
        source,
        lockedAt: new Date(),
        dealLockedAt: new Date(),
        // 只在调用方明确给了分量时才写：占位行上可能已有运营「补录」的子账号加价，
        // 首笔成交只负责补上成交金额与来源，不该把议定好的分量抹成 null
        ...(typeof subAccountAmount === 'number' ? { subAccountAmount } : {}),
        ...(typeof subAccountCount === 'number' ? { subAccountCount } : {}),
      },
    });

    if (claimed.count > 0) {
      return true;
    }

    // 行不存在才新建；并发下由唯一键 + skipDuplicates 兜底（不会覆盖已成交的行）
    const created = await executor.storeMembershipLockedPrice.createMany({
      data: [
        {
          storeId,
          planId,
          price,
          subAccountAmount,
          subAccountCount,
          source,
          dealLockedAt: new Date(),
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
        dealLockedAt: new Date(),
      },
      update: {
        price,
        source,
        // 一次显式成交：既刷新成交时点，也把「仅承载覆盖价」的占位行转成正式成交行
        lockedAt: new Date(),
        dealLockedAt: new Date(),
        ...(subAccountAmount !== undefined ? { subAccountAmount } : {}),
        ...(subAccountCount !== undefined ? { subAccountCount } : {}),
        //
        // ⚠️ 这里**绝不能**顺手清掉 `renewalPriceOverride`。
        // 「设置会员等级」是一次成交记账，而覆盖价是运营单独议定的、
        // 对未来每次续费都生效的定价输入；两者生命周期不同。
        // 一旦在这里写 null，运营在「调整续费价格」里议的价会被静默蒸发。
      },
    });
  }

  /**
   * 重置成交价快照；不传 planId 时清空门店全部。返回清除条数。
   *
   * ⚠️ 只允许由管理端「重置成交价」显式触发。**不得**由关闭子账号能力等副作用
   * 自动调用：客户降级为免费后再次开通时，必须还能读到历史成交价。
   *
   * ⚠️ **不得整行删除**：`renewalPriceOverride`（运营议定的续费价）与成交分量
   * 同住一行，整行删掉会让门店静默回落到配置价续费——议定价**高于**配置价时
   * 平台白丢一块收入，且没有任何提示。因此按有无议定价分两类处理：
   * - 无议定价：整行删除，下次成交重新锁价；
   * - 有议定价：保留该行，只作废成交分量（`dealLockedAt` 置空 + 子账号分量清空），
   *   续费价维持运营议定的口径。
   */
  async resetLockedPrices(
    storeId: number,
    planId?: PlatformMembershipPlanId,
  ): Promise<number> {
    const baseWhere = planId ? { storeId, planId } : { storeId };

    // 顺序：先作废（护住覆盖价），再删除。两步条件互斥且都只依赖 where，
    // 重复调用幂等；任一步失败都不会把运营议定的续费价丢掉。
    const revoked = await this.prisma.storeMembershipLockedPrice.updateMany({
      where: { ...baseWhere, renewalPriceOverride: { not: null } },
      data: {
        dealLockedAt: null,
        subAccountAmount: null,
        subAccountCount: null,
      },
    });

    const deleted = await this.prisma.storeMembershipLockedPrice.deleteMany({
      where: { ...baseWhere, renewalPriceOverride: null },
    });

    const clearedCount = revoked.count + deleted.count;

    if (clearedCount > 0) {
      this.logger.warn(
        JSON.stringify({
          event: 'store_membership_locked_price_reset',
          storeId,
          planId: planId ?? null,
          clearedCount,
          // 分开记：被作废的行仍保留覆盖价，排查「重置后价格没变」时看这里
          revokedCount: revoked.count,
          deletedCount: deleted.count,
        }),
      );
    }

    return clearedCount;
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
   * 在 `storeIds` 范围内列出「有子账号、但成交价快照里没有子账号加价」的门店，供运营批量补录。
   *
   * 判据用 `pulseSubAccountQuota > 0`（曾开通，到期不失效）——到期门店同样需要补录，
   * 否则配置价一涨过成交总额，它们就会按「不含子账号」的标准价续费，白送子账号。
   *
   * ⚠️ 必须先用 `storeIds` 收窄：这两张表都是**全平台**的，不带 `storeId in (...)`
   * 就是全表扫描后再到内存里求交集，管理端可见门店越多浪费越大；收窄后走
   * `storeId` 索引，读的只可能是最终要返回的那几行。
   */
  async listStoresPendingSubAccountBackfill(
    storeIds: number[],
  ): Promise<number[]> {
    if (storeIds.length === 0) {
      return [];
    }

    const profiles = await this.prisma.storeMembershipProfile.findMany({
      where: { storeId: { in: storeIds }, pulseSubAccountQuota: { gt: 0 } },
      select: { storeId: true },
    });

    if (profiles.length === 0) {
      return [];
    }

    const scopedStoreIds = profiles.map((profile) => profile.storeId);

    // 需要「至少有一个年 / 永久档位缺子账号加价」才算待补录：
    // 月 / 季会员开不了子账号，它们的快照永远不需要补录，不该把门店捞进清单
    const pendingRows = await this.prisma.storeMembershipLockedPrice.findMany({
      where: {
        storeId: { in: scopedStoreIds },
        planId: { in: [...SUB_ACCOUNT_PRICING_PLAN_IDS] },
        subAccountAmount: null,
      },
      select: { storeId: true },
      distinct: ['storeId'],
    });

    return pendingRows.map((row) => row.storeId);
  }

  /**
   * 在 `storeIds` 范围内列出「续费价**被调整过**」的门店，供管理端筛选复核。
   *
   * 口径是**曾经调过**，不是「当前还调着」：
   * 运营在弹窗里清空覆盖（恢复配置价）后 `renewalPriceOverride` 会变回 null，
   * 但改价这件事发生过，门店仍要留在清单里——否则运营会以为自己没议过价、再议一遍。
   *
   * 因此判据落在审计表 `store_membership_price_override_audits`：一次实际变更一行
   * （新建与清除都记，值没变则整批跳过）。再并上「当前仍有覆盖价」兜底：
   * 审计若将来按保留期清理，当前生效的议价不能被顺带清出清单。
   *
   * 与 `listStoresPendingSubAccountBackfill` 同理：`storeIds` 是必须项，
   * 否则每次筛选都要对全平台的审计表做一次 distinct 扫描。
   */
  async listStoresEverRenewalPriceAdjusted(
    storeIds: number[],
  ): Promise<number[]> {
    if (storeIds.length === 0) {
      return [];
    }

    const [auditRows, overrideRows] = await Promise.all([
      this.prisma.storeMembershipPriceOverrideAudit.findMany({
        where: { storeId: { in: storeIds } },
        select: { storeId: true },
        distinct: ['storeId'],
      }),
      this.prisma.storeMembershipLockedPrice.findMany({
        where: {
          storeId: { in: storeIds },
          renewalPriceOverride: { not: null },
        },
        select: { storeId: true },
        distinct: ['storeId'],
      }),
    ]);

    const adjustedStoreIds = new Set<number>([
      ...auditRows.map((row) => row.storeId),
      ...overrideRows.map((row) => row.storeId),
    ]);

    // 按入参顺序返回，调用方的分页 / 排序口径不被打乱
    return storeIds.filter((storeId) => adjustedStoreIds.has(storeId));
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
  async upsertRenewalPriceOverride(params: {
    storeId: number;
    planId: PlatformMembershipPlanId;
    /** 覆盖价（分）；null = 清除覆盖 */
    overridePrice: number | null;
    /** 建行兜底用的当前配置价（分） */
    fallbackConfigPrice: number;
    executor?: PrismaExecutor;
  }): Promise<{ oldPrice: number | null }> {
    const {
      storeId,
      planId,
      overridePrice,
      fallbackConfigPrice,
      executor = this.prisma,
    } = params;

    if (
      overridePrice !== null &&
      (!Number.isInteger(overridePrice) || overridePrice < 0)
    ) {
      this.logger.warn(
        `[locked-price] 忽略非法续费价覆盖 storeId=${storeId} planId=${planId} overridePrice=${overridePrice}`,
      );
      throw new BadRequestException('续费价必须是非负整数（分）');
    }

    const existing = await executor.storeMembershipLockedPrice.findUnique({
      where: { storeId_planId: { storeId, planId } },
      select: { price: true, renewalPriceOverride: true },
    });

    const oldPrice = existing?.renewalPriceOverride ?? null;

    // 无变化就不写库：避免产生一条没有实际变更的审计记录
    if (oldPrice === overridePrice) {
      return { oldPrice };
    }

    await executor.storeMembershipLockedPrice.upsert({
      where: { storeId_planId: { storeId, planId } },
      create: {
        storeId,
        planId,
        price: fallbackConfigPrice,
        renewalPriceOverride: overridePrice,
        source: 'admin',
      },
      update: { renewalPriceOverride: overridePrice },
    });

    this.logger.warn(
      JSON.stringify({
        event: 'store_membership_renewal_price_override_upsert',
        storeId,
        planId,
        oldPrice,
        newPrice: overridePrice,
      }),
    );

    return { oldPrice };
  }
}

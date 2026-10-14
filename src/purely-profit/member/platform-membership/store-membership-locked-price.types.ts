// 仅用于类型别名（不参与运行时求值），使用 import type 避免误入运行时依赖，
// 也避免 isolatedModules 下被 transpiler 保留成无用 import
import type { StoreMembershipLockedPriceSource } from '@prisma/client';
import type { PlatformMembershipPlanId } from './dto/platform-membership-query.dto';
import type { MembershipRuntimeLevel } from './platform-membership-access.service';

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
 * 成交价快照行：查询层对 `store_membership_locked_prices` 的最小投影。
 *
 * 字段刻意用**可空 + 运行时 typeof 兜底**而非全必填：mock 残行 / 漏 select 的行
 * 上字段会是 `undefined`，按「未录入 / 已成交」处理即可，不改旧行为。
 */
export interface LockedPriceRow {
  planId: PlatformMembershipPlanId;
  price: number;
  subAccountAmount: number | null;
  subAccountCount: number | null;
  renewalPriceOverride: number | null;
  /** 非空才代表本行来自一次真实成交；NULL / undefined 表示占位行 */
  dealLockedAt: Date | null;
}

/** 管理端展示用的快照行：在 `LockedPriceRow` 上补了来源与锁定时点 */
export interface LockedPriceAuditRow extends LockedPriceRow {
  source: LockedPriceSource;
  lockedAt: Date;
}

/** 定价公式两侧所需的四张表（`loadDealPriceSnapshots` 的返回） */
export interface DealPriceSnapshotTables {
  /** 成交总额（分），只作记账 / 快照展示，不参与定价 */
  prices: Map<PlatformMembershipPlanId, number>;
  /** 运营议定的基础价（分），与当前配置价取高者作为定价基数 */
  priceOverrides: Map<PlatformMembershipPlanId, number>;
  /** 子账号加价（分） */
  subAccountAmounts: Map<PlatformMembershipPlanId, number>;
  /** 子账号数量 */
  subAccountCounts: Map<PlatformMembershipPlanId, number>;
}

/** 写入成交价快照的参数（首充锁定 / 覆盖写入共用） */
export interface DealPriceWriteParams {
  storeId: number;
  planId: PlatformMembershipPlanId;
  price: number;
  source: LockedPriceSource;
  /** 子账号加价（分）；undefined = 本次不动该字段，null = 置空 */
  subAccountAmount?: number | null;
  /** 子账号数量；undefined = 本次不动该字段，null = 置空 */
  subAccountCount?: number | null;
}

/** 只动子账号两列的参数 */
export interface SubAccountSnapshotWriteParams {
  storeId: number;
  planId: PlatformMembershipPlanId;
  subAccountAmount: number | null;
  subAccountCount: number | null;
}

/** 续费价覆盖写入参数 */
export interface RenewalPriceOverrideWriteParams {
  storeId: number;
  planId: PlatformMembershipPlanId;
  /** 覆盖价（分）；null = 清除覆盖 */
  overridePrice: number | null;
  /** 建行兜底用的当前配置价（分） */
  fallbackConfigPrice: number;
}

import { Injectable, Logger } from '@nestjs/common';
// 仅用于类型别名（不参与运行时求值），使用 import type 避免误入运行时依赖，
// 也避免 isolatedModules 下被 transpiler 保留成无用 import
import type { StoreMembershipLockedPriceSource } from '@prisma/client';
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
  /** 门店已锁定的套餐价格（分），key 为套餐标识 */
  lockedPrices: Map<PlatformMembershipPlanId, number>;
}

export interface ResolvedPlanPrice {
  /** 实际应支付价格（分） */
  price: number;
  /** 是否命中首购锁定价 */
  locked: boolean;
}

/** 锁定价快照条目（含来源与锁定时点，管理端展示用） */
export interface LockedPriceSnapshot {
  planId: PlatformMembershipPlanId;
  /** 锁定价格（分） */
  price: number;
  source: LockedPriceSource;
  lockedAt: Date;
}

/**
 * 会员套餐「首购锁定价」。
 *
 * 业务背景：年度 / 永久会员支持子账号功能，平台会为「含子账号权益」调高套餐价；
 * 已开通子账号功能的老客必须继续按**首次成交价**续费，避免被涨价影响。
 *
 * 规则：
 * - 首次成交（商家端下单成功 / 平台侧设置会员等级）写入快照，**已存在则不覆盖**（锁定语义）
 * - 快照**只对曾开通子账号功能**（`pulseSubAccountQuota > 0`）的门店写入：锁定价只在
 *   `resolvePlanPrice` 的「曾开通」分支生效，未开通时写入永不生效，却会在门店日后
 *   开通子账号时突然生效（`pulseSubAccountQuota` 由 0 变正不触发 `resetLockedPrices`）
 * - 锁定价仅在该门店**曾开通子账号功能**时生效；未开通的门店跟随配置价。
 *   注意是「曾开通」——会员到期后仍需按首次成交价续费，
 *   否则门店会在到期那一刻被涨回配置价
 * - 重置（关闭子账号功能 / 平台运营手动重置）后可重新锁价
 */
@Injectable()
export class StoreMembershipLockedPriceService {
  private readonly logger = new Logger(StoreMembershipLockedPriceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accessService: PlatformMembershipAccessService,
  ) {}

  /** 读取门店全部锁定价 */
  async findLockedPrices(
    storeId: number,
    executor: PrismaExecutor = this.prisma,
  ): Promise<Map<PlatformMembershipPlanId, number>> {
    const rows = await executor.storeMembershipLockedPrice.findMany({
      where: { storeId },
      select: { planId: true, price: true },
    });

    return new Map(
      rows.map((row) => [row.planId as PlatformMembershipPlanId, row.price]),
    );
  }

  /**
   * 读取门店全部锁定价（含来源与锁定时点），供管理端展示「当前锁了什么价」。
   *
   * 结算 / 定价路径请用 `findLockedPrices`（Map，少读两列）。
   */
  async listLockedPrices(
    storeId: number,
    executor: PrismaExecutor = this.prisma,
  ): Promise<LockedPriceSnapshot[]> {
    const rows = await executor.storeMembershipLockedPrice.findMany({
      where: { storeId },
      select: { planId: true, price: true, source: true, lockedAt: true },
      orderBy: { planId: 'asc' },
    });

    return rows.map((row) => ({
      planId: row.planId as PlatformMembershipPlanId,
      price: row.price,
      source: row.source,
      lockedAt: row.lockedAt,
    }));
  }

  /**
   * 首次成交时写入锁定价。
   *
   * 已存在快照时不覆盖（这是「锁定」的核心语义），返回 false 表示保留原锁定价。
   *
   * 与 `resolvePlanPrice` 的读取口径严格对称：**只有曾开通子账号功能**的门店才写入。
   * 未开通时写入不会影响任何展示价 / 实付价（运营输入的成交价被静默丢弃），
   * 却会在门店日后开通子账号（`pulseSubAccountQuota` 由 0 变正）时突然生效，
   * 导致门店按「不含子账号权益」的旧价续费——所以宁可不写。
   */
  async lockPriceOnFirstDeal(params: {
    storeId: number;
    planId: PlatformMembershipPlanId;
    price: number;
    source: LockedPriceSource;
    executor?: PrismaExecutor;
    /** 调用方已加载的「曾开通子账号功能」标志；不传时由本方法自行读取能力快照 */
    featureOwned?: boolean;
  }): Promise<boolean> {
    const { storeId, planId, price, source, executor = this.prisma } = params;

    if (!Number.isInteger(price) || price < 0) {
      this.logger.warn(
        `[locked-price] 忽略非法锁定价 storeId=${storeId} planId=${planId} price=${price}`,
      );
      return false;
    }

    const featureOwned =
      params.featureOwned ??
      (await this.accessService.getSubAccountBenefitSnapshot(storeId, executor))
        .featureOwned;

    if (!featureOwned) {
      this.logger.warn(
        JSON.stringify({
          event: 'store_membership_locked_price_skipped',
          reason: 'sub_account_feature_not_owned',
          storeId,
          planId,
          price,
          source,
        }),
      );
      return false;
    }

    const created = await executor.storeMembershipLockedPrice.createMany({
      data: [{ storeId, planId, price, source }],
      skipDuplicates: true,
    });

    return created.count > 0;
  }

  /** 重置锁定价；不传 planId 时清空门店全部锁定价。返回清除条数。 */
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
   * 加载续费定价上下文：当前档位 + 待续费档位 + 子账号能力 + 已锁定价格。
   *
   * executor 需一路透传到子账号能力快照读取，保证「能力快照」与「锁定价」
   * 在同一事务快照下取值，避免下单事务内的价格基于事务外的能力状态计算。
   */
  async loadRenewalPricingContext(
    storeId: number,
    executor: PrismaExecutor = this.prisma,
  ): Promise<StoreRenewalPricingContext> {
    const bonusSnapshot = await this.accessService.getSubAccountBenefitSnapshot(
      storeId,
      executor,
    );
    const lockedPrices = await this.findLockedPrices(storeId, executor);

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
      lockedPrices,
    };
  }

  /**
   * 解析套餐实际支付价：曾开通子账号功能且存在锁定价时使用锁定价，否则使用配置价。
   *
   * 展示价（套餐列表）与实付价（预览 / 下单）必须走同一入口，否则会出现
   * 「看到的价格 ≠ 实际扣款」。
   */
  resolvePlanPrice(params: {
    plan: Pick<MembershipPlanConfig, 'id' | 'price'>;
    context: StoreRenewalPricingContext;
  }): ResolvedPlanPrice {
    const { plan, context } = params;

    if (!context.subAccountFeatureOwned) {
      return { price: plan.price, locked: false };
    }

    const lockedPrice = context.lockedPrices.get(plan.id);
    if (lockedPrice === undefined) {
      return { price: plan.price, locked: false };
    }

    return { price: lockedPrice, locked: true };
  }
}

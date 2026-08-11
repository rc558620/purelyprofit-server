import { Injectable } from '@nestjs/common';
import { ClubMemberLevelsService } from '../member/member-levels/club-member-levels.service';
import { ClubMemberProfileService } from '../member/member-profile/club-member-profile.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ClubPromotionRepository } from '../shared/club-promotion.repository';
import {
  type ClubPricingCandidate,
  type ClubServicePromotionType,
  resolveReduceConfig,
  toDiscountCandidate,
} from './club-order-promotions.utils';

export type { ClubServicePromotionType };

export interface ClubServicePricingResolution {
  /** 最终应付金额（分）= 竞争胜出价 - 满减 */
  amountFen: number;
  /**
   * 会员基准价 = product.price（分）
   *
   * product.price 本身就是会员价（admin 设定），不需要再施加会员等级折扣。
   * 活动折扣直接基于此价格计算，与会员价竞争（取力度最大的一个）。
   */
  memberBaselineFen: number;
  /** 总优惠金额 = product.price - 最终价（分），含活动折扣 + 满减 */
  discountAmountFen: number;
  /** 命中的活动 ID（多个活动中优惠力度最大的一个） */
  promotionId: number | null;
  /** 命中的活动类型 */
  promotionType: ClubServicePromotionType | null;
  /**
   * 命中活动的折扣率（0-100 整数，如 79 表示 7.9折）
   *
   * 注意：此值为整数百分比，与 memberDiscountRate（0-1 小数）格式不同。
   * 传入 formatDiscountRateLabel 前必须先除以 100。
   */
  discountRate: number | null;
  /** 活动标签（如 "限时 7 折"） */
  promotionTag: string | null;
  /**
   * 活动折扣单独贡献的优惠金额（分）
   *
   * 计算公式：product.price - 活动折后价
   * 例：会员价 ¥333，活动 7.9折，活动价 = 33300 × 0.79 = 26307，
   *     则 promotionDiscountAmountFen = 33300 - 26307 = 6993 (¥69.93)
   */
  promotionDiscountAmountFen: number;
  /** 总满减减免金额（分），skipReduce=true 时为 0 */
  totalReduceFen: number;
  /**
   * 满减前的应付金额（分）= 活动折后价（即 afterDiscountFen）
   *
   * 供调用方（如 preview）基于订单总额重新计算满减。
   * preview 会先乘以数量得到 beforeReduceTotalFen，
   * 再用 resolveOrderReduceFen 基于总额判断满减门槛。
   */
  amountFenBeforeReduce: number;
}

@Injectable()
export class ClubOrderPromotionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clubMemberProfileService: ClubMemberProfileService,
    private readonly clubMemberLevelsService: ClubMemberLevelsService,
    private readonly clubPromotionRepository: ClubPromotionRepository,
  ) {}

  /**
   * 解析服务商品定价（活动折扣竞争 + 满减）
   *
   * 计算流水线：
   *   product.price（会员价） → [活动折扣竞争] → 胜出价 → [满减] → 最终价
   *
   * 竞争模型（非叠加模型）：
   *   - product.price 本身就是会员价，不再施加会员等级折扣
   *   - 活动折扣直接基于 product.price 计算
   *   - 会员价与活动价取力度最大的一个（amountFen 最低者胜出）
   *   - 多个活动折扣中取 amountFen 最低的一个（优惠力度最大）
   *   - 满减在竞争胜出价基础上叠加
   *
   * @param amountFen 商品单价（分），即 context.product.price（已是会员价）
   * @param options.skipReduce true 时跳过满减计算，由调用方基于订单总额重新计算
   */
  async resolvePricing(
    storeId: number,
    customerId: number,
    phone: string,
    amountFen: number,
    options?: { skipReduce?: boolean },
  ): Promise<ClubServicePricingResolution> {
    const [promotions, consumptionCount] = await Promise.all([
      this.clubPromotionRepository.loadActivePromotions(storeId),
      this.prisma.marketingConsumption.count({
        where: {
          storeId,
          customerId,
        },
      }),
    ]);

    // 1. 会员基准价 = product.price（已是会员价，不再施加会员等级折扣）
    //
    // ══════════════════════════════════════════════════════════════
    // ⚠️ 禁止在此处调用 applyMemberDiscount(amountFen, memberDiscountRate)！
    //
    // product.price 是 admin 设定的会员价，已经包含了会员折扣。
    // 如果再 × memberDiscountRate 会造成双重折扣（折上折）。
    // 例：product.price=333，memberDiscountRate=0.91，
    //     错误做法：333 × 0.91 = 303（双重折扣，不对）
    //     正确做法：baselineAmountFen = 333（直接用）
    // ══════════════════════════════════════════════════════════════
    const baselineAmountFen = amountFen;

    // 2. 活动折扣竞争：直接基于 product.price 计算，取力度最大的活动
    //    活动折扣与会员价竞争（取 amountFen 最低者），不做折上折
    let bestDiscount: ClubPricingCandidate | null = null;

    for (const promotion of promotions) {
      const candidate = toDiscountCandidate(
        promotion,
        baselineAmountFen,
        consumptionCount,
      );
      if (
        candidate &&
        candidate.amountFen < baselineAmountFen &&
        (!bestDiscount || candidate.amountFen < bestDiscount.amountFen)
      ) {
        bestDiscount = candidate;
      }
    }

    const chosenDiscount = bestDiscount as ClubPricingCandidate | null;
    const afterDiscountFen = chosenDiscount?.amountFen ?? baselineAmountFen;

    // 3. 满减叠加：所有满足门槛的满减活动均可叠加
    //    满减门槛基于原价（amountFen）判断，与产品列表展示逻辑一致
    //    skipReduce=true 时跳过，由调用方（如 preview）基于订单总额重新计算
    let totalReduceFen = 0;
    if (!options?.skipReduce) {
      for (const promotion of promotions) {
        if (promotion.type !== 'reduce') continue;
        const reduceConfig = resolveReduceConfig(promotion.params);
        // BUG-5 修复：满减门槛统一基于折扣后价（afterDiscountFen）判断，
        // 与产品详情 resolvePricing 保持一致
        if (!reduceConfig || afterDiscountFen < reduceConfig.thresholdFen)
          continue;
        totalReduceFen += reduceConfig.reduceAmountFen;
      }
    }

    // 4. 最终价 = 折扣后价 - 满减总额
    //    skipReduce 时 amountFenBeforeReduce 保留折扣后价，供调用方做订单级满减
    const finalAmountFen = Math.max(afterDiscountFen - totalReduceFen, 0);
    const amountFenBeforeReduce = afterDiscountFen;

    return {
      amountFen: finalAmountFen,
      memberBaselineFen: baselineAmountFen,
      discountAmountFen: Math.max(amountFen - finalAmountFen, 0),
      promotionId: chosenDiscount?.promotionId ?? null,
      promotionType: chosenDiscount?.promotionType ?? null,
      discountRate: chosenDiscount?.discountRate ?? null,
      promotionTag: chosenDiscount?.promotionTag ?? null,
      promotionDiscountAmountFen:
        chosenDiscount?.promotionDiscountAmountFen ?? 0,
      totalReduceFen,
      amountFenBeforeReduce,
    };
  }

  /**
   * 基于订单总金额计算满减优惠（单次生效，不叠加）
   *
   * 满减规则：
   *   - 门槛基于订单总额（折扣后单价 × 数量）判断，而非单价
   *   - 每个满减活动最多生效一次，不随购买数量叠加
   *   - 示例：满 50 减 9，订单总额 ¥200 也只减 ¥9，不是 ¥9 × 4 = ¥36
   *
   * @param orderTotalFen 订单总额（分）= 折扣后单价 × 数量
   */
  async resolveOrderReduceFen(
    storeId: number,
    orderTotalFen: number,
  ): Promise<number> {
    const detail = await this.resolveOrderReduceDetail(storeId, orderTotalFen);
    return detail.totalReduceFen;
  }

  /**
   * 基于订单总金额计算满减优惠明细（含门槛规则，用于生成“满xxx减xxx”展示标签）
   *
   * @param orderTotalFen 订单总额（分）= 折扣后单价 × 数量
   */
  async resolveOrderReduceDetail(
    storeId: number,
    orderTotalFen: number,
  ): Promise<{
    totalReduceFen: number;
    reduceRules: Array<{ thresholdFen: number; reduceAmountFen: number }>;
  }> {
    const promotions =
      await this.clubPromotionRepository.loadActivePromotions(storeId);
    let totalReduceFen = 0;
    const reduceRules: Array<{
      thresholdFen: number;
      reduceAmountFen: number;
    }> = [];
    for (const promotion of promotions) {
      if (promotion.type !== 'reduce') continue;
      const reduceConfig = resolveReduceConfig(promotion.params);
      if (!reduceConfig || orderTotalFen < reduceConfig.thresholdFen) continue;
      totalReduceFen += reduceConfig.reduceAmountFen;
      reduceRules.push({
        thresholdFen: reduceConfig.thresholdFen,
        reduceAmountFen: reduceConfig.reduceAmountFen,
      });
    }
    return { totalReduceFen, reduceRules };
  }

  async resolveMemberDiscountRate(
    storeId: number,
    phone: string,
  ): Promise<number | null> {
    const snapshot =
      await this.clubMemberProfileService.getSnapshotByStoreAndPhone(
        storeId,
        phone,
      );
    if (!snapshot) {
      return null;
    }

    const levelConfig =
      await this.clubMemberLevelsService.resolveCurrentLevelConfig(snapshot);
    return levelConfig.discountRate > 0 && levelConfig.discountRate < 1
      ? levelConfig.discountRate
      : null;
  }
}

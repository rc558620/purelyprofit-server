/**
 * Club 服务订单价格预计算服务
 *
 * ══════════════════════════════════════════════════════════════════════════
 *                       金额计算核心规则（修改前必读）
 * ══════════════════════════════════════════════════════════════════════════
 *
 * 【规则 1】折扣叠加模型（非竞争模型）
 *   - 会员折扣先应用于商品原价 → 得到「会员基准价」
 *   - 活动折扣再应用于会员基准价 → 得到「活动折后价」
 *   - 两者叠加生效，不是二选一
 *   - 示例：原价 ¥777 × 会员 7.8折 = ¥606.06，再 × 活动 7.9折 = ¥478.79
 *
 * 【规则 2】满减活动单次生效
 *   - 满减基于「折扣后订单总额」判断门槛，而非单价
 *   - 每个满减活动最多生效一次，不随购买数量叠加
 *   - resolvePricing 使用 skipReduce=true 跳过单件满减
 *   - 然后由 resolveOrderReduceFen 基于订单总额重新计算
 *
 * 【规则 3】金额精度规范
 *   - 所有内部计算统一在「分」级别（整数），使用 Decimal.js + ROUND_HALF_UP
 *   - 输出时通过 Money.toOutputYuan() 转为元（保留两位小数）
 *   - 禁止浮点数直接运算，必须走 Money 或 Decimal
 *
 * 【规则 4】前端严禁业务金额计算
 *   - 所有金额字段由本服务计算后返回，前端仅做展示
 *   - breakdownItems 中的 label/value/isStrikethrough 全部由后端决定
 *
 * 【规则 5】折扣明细行展示规则
 *   - 会员折扣行：显示会员折扣率（如 "折扣 7.8折"），金额为 (原价 - 会员价) × 数量
 *   - 活动折扣行：显示活动折扣率（如 "折扣 7.9折"），金额为 (会员价 - 活动价) × 数量
 *   - 当活动折扣率 < 会员折扣率时（活动更优），会员折扣行显示删除线
 *   - 满减行：固定标签 "满减优惠"，金额为订单级满减（单次）
 *   - 删除线行 (isStrikethrough=true) 仅信息展示，不参与实际金额计算
 *
 * ══════════════════════════════════════════════════════════════════════════
 */
import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { Money } from '../../shared/money.utils';
import { ClubOrderPromotionsService } from './club-order-promotions.service';
import { ClubOrderServiceContextService } from './club-order-service-context.service';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import type {
  ClubOrderBreakdownItemDto,
  ClubServiceOrderPreviewResponseDto,
  PreviewClubServiceOrderDto,
} from './dto/club-order.dto';
import type { ClubPointsRedeemConfig } from './club-order-drafts.utils';
import { resolvePointsRedeemConfig } from './club-order-drafts.utils';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ClubOrderPreviewService {
  constructor(
    private readonly clubOrderServiceContextService: ClubOrderServiceContextService,
    private readonly clubOrderPromotionsService: ClubOrderPromotionsService,
    private readonly prisma: PrismaService,
  ) {}

  async previewServiceOrder(
    currentContext: ClubCurrentContext,
    dto: PreviewClubServiceOrderDto,
  ): Promise<ClubServiceOrderPreviewResponseDto> {
    const context =
      await this.clubOrderServiceContextService.resolveCreateServiceOrderContext(
        currentContext,
        {
          storeId: dto.storeId,
          productId: dto.productId,
        },
      );

    const pricing = await this.clubOrderPromotionsService.resolvePricing(
      context.store.id,
      context.customer.id,
      currentContext.user.phone,
      context.product.price,
      { skipReduce: true },
    );

    const quantity = dto.quantity ?? 1;

    // ── 订单级金额计算 ──
    const originalPriceFen =
      (context.product.originalPrice ?? context.product.price) * quantity;
    // 会员基准价总额 = 单价会员基准价 × 数量
    const memberBaselineTotalFen = pricing.memberBaselineFen * quantity;
    // 活动折扣总额 = 单价活动折扣额 × 数量
    const promotionDiscountTotalFen =
      pricing.promotionDiscountAmountFen * quantity;
    // 满减前应付总额 = 折扣后单价 × 数量
    const beforeReduceTotalFen = pricing.amountFenBeforeReduce * quantity;

    // ── 满减：基于订单总额计算，单次生效，不叠加 ──
    const orderReduceFen =
      await this.clubOrderPromotionsService.resolveOrderReduceFen(
        context.store.id,
        beforeReduceTotalFen,
      );

    // 最终应付 = 满减前总额 - 满减
    const finalPriceFen = Math.max(beforeReduceTotalFen - orderReduceFen, 0);

    // 折扣总额 = (单价折扣额 + 订单满减) × 数量
    // pricing.discountAmountFen 含会员/活动折扣，不含满减（skipReduce）；
    // buildBreakdownItems 的 levelDiscountFen 公式需要总优惠（含满减），
    // 所以这里要把 orderReduceFen 加进去
    const discountTotalFen =
      (pricing.discountAmountFen + orderReduceFen) * quantity;

    // 积分抵扣计算（基于乘以数量后的金额）
    const { pointsDeductFen, pointsUsed } = await this.calcPointsDeduction(
      currentContext.store.id,
      context.customer.id,
      finalPriceFen,
      dto.usePoints === true,
    );
    const afterPointsPriceFen = Money.fromDbCents(finalPriceFen)
      .subtractClampedToZero(Money.fromDbCents(pointsDeductFen))
      .toDbCents();

    const totalSavingAmount = Money.fromDbCents(originalPriceFen)
      .subtractClampedToZero(Money.fromDbCents(finalPriceFen))
      .toOutputYuan();
    const memberDiscountRate =
      await this.clubOrderPromotionsService.resolveMemberDiscountRate(
        context.store.id,
        currentContext.user.phone,
      );

    const breakdownItems = this.buildBreakdownItems({
      memberBaselineFen: memberBaselineTotalFen,
      discountAmountFen: discountTotalFen,
      promotionDiscountAmountFen: promotionDiscountTotalFen,
      promotionType: pricing.promotionType,
      promotionTag: pricing.promotionTag,
      discountRate: pricing.discountRate,
      totalReduceFen: orderReduceFen,
      finalPriceFen,
      memberDiscountRate,
    });

    return {
      originalPrice: Money.fromDbCents(originalPriceFen).toOutputYuan(),
      memberBaselinePrice: Money.fromDbCents(
        memberBaselineTotalFen,
      ).toOutputYuan(),
      afterDiscountPrice:
        Money.fromDbCents(beforeReduceTotalFen).toOutputYuan(),
      reduceAmount: Money.fromDbCents(orderReduceFen).toOutputYuan(),
      finalPrice: Money.fromDbCents(finalPriceFen).toOutputYuan(),
      totalSavingAmount,
      pointsDeductionAmount: Money.fromDbCents(pointsDeductFen).toOutputYuan(),
      pointsUsed,
      afterPointsPrice: Money.fromDbCents(afterPointsPriceFen).toOutputYuan(),
      promotionId:
        pricing.promotionId !== null ? String(pricing.promotionId) : null,
      promotionType: pricing.promotionType,
      discountRate: pricing.discountRate,
      promotionTag: pricing.promotionTag,
      quantity,
      breakdownItems,
    };
  }

  /**
   * 计算积分抵扣金额：预览接口始终计算可抵扣金额（不受 enabled 开关限制），
   * 前端根据 usePoints 决定是否展示；实际下单时仍由 creation service 管控 enabled。
   */
  private async calcPointsDeduction(
    storeId: number,
    customerId: number,
    priceAfterDiscountFen: number,
    usePoints: boolean,
  ): Promise<{ pointsDeductFen: number; pointsUsed: number }> {
    if (!usePoints || priceAfterDiscountFen <= 0) {
      return { pointsDeductFen: 0, pointsUsed: 0 };
    }

    const pointsRatio = await this.getPointsRatioConfig(storeId);

    if (pointsRatio.redeemRatioPoints <= 0 || pointsRatio.maxRedeemRatio <= 0) {
      return { pointsDeductFen: 0, pointsUsed: 0 };
    }

    const customer = await this.prisma.marketingCustomer.findUnique({
      where: { id: customerId },
      select: { points: true },
    });

    const availablePoints = customer?.points ?? 0;
    if (availablePoints <= 0) {
      return { pointsDeductFen: 0, pointsUsed: 0 };
    }

    const maxDeductFen = Math.floor(
      new Decimal(priceAfterDiscountFen)
        .mul(pointsRatio.maxRedeemRatio)
        .toNumber(),
    );

    const pointsToFenRatio = 100 / pointsRatio.redeemRatioPoints;
    const availableDeductFen = availablePoints * pointsToFenRatio;

    const pointsDeductFen = Math.min(maxDeductFen, availableDeductFen);
    const pointsUsed = Math.ceil(pointsDeductFen / pointsToFenRatio);

    return { pointsDeductFen, pointsUsed };
  }

  private async getPointsRatioConfig(
    storeId: number,
  ): Promise<ClubPointsRedeemConfig> {
    const settings = await this.prisma.marketingMemberLevelSetting.findUnique({
      where: { storeId },
      select: { pointsRatio: true },
    });

    const config = resolvePointsRedeemConfig(settings?.pointsRatio);

    if (!config.enabled) {
      const now = new Date();
      const promo = await this.prisma.marketingPromotion.findFirst({
        where: {
          storeId,
          type: 'points_recharge',
          enabled: true,
          startAt: { lte: now },
          endAt: { gte: now },
        },
        select: { id: true },
      });
      if (promo) {
        return { ...config, enabled: true };
      }
    }

    return config;
  }

  private formatFenToYuanText(cents: number): string {
    return Money.fromDbCents(cents)
      .toFixedOutputYuan()
      .replace(/\.00$/, '')
      .replace(/(\.\d)0$/, '$1');
  }

  /**
   * 格式化折扣率为中文“X.X折”标签。
   *
   * 参数契约：rate 必须是 0-1 范围的小数（如 0.78 表示 7.8折）。
   * 禁止传入 0-100 整数（如 78），否则会输出 "780折" 等荒谬结果。
   * 活动折扣的 discountRate 为 0-100 整数，调用前必须先除以 100。
   */
  private static formatDiscountRateLabel(rate: number): string {
    const zhe = +(rate * 10).toFixed(1);
    return Number.isInteger(zhe) ? `${zhe}折` : `${zhe}折`;
  }

  /**
   * 构建价格明细展示行。
   *
   * 展示行顺序：会员售价 → 会员折扣行 → 活动折扣行 → 满减行 → 优惠后小计 → 积分抵扣
   *
   * 关键公式：
   *   levelDiscountFen = discountAmountFen - promotionDiscountAmountFen - totalReduceFen
   *
   * 其中 discountAmountFen 必须是「总优惠」（含会员折扣 + 活动折扣 + 满减），
   * 这样减去活动和满减后才能得到纯会员折扣额。
   * 调用方传入时务必确认 discountAmountFen = (pricing.discountAmountFen + orderReduceFen) * quantity。
   *
   * 删除线规则：
   *   当活动折扣率（discountRate/100）< 会员折扣率（memberDiscountRate）时，
   *   说明活动折扣比会员折扣更优，会员折扣行显示删除线（仅信息展示，不参与实际扣减）。
   */
  private buildBreakdownItems(params: {
    memberBaselineFen: number;
    discountAmountFen: number;
    promotionDiscountAmountFen: number;
    promotionType: string | null;
    promotionTag: string | null;
    /** 命中活动的折扣率（0-100 整数），用于活动折扣行显示几折 */
    discountRate: number | null;
    totalReduceFen: number;
    finalPriceFen: number;
    memberDiscountRate: number | null;
  }): ClubOrderBreakdownItemDto[] {
    const items: ClubOrderBreakdownItemDto[] = [];

    // 会员售价行
    items.push({
      id: 'member-price',
      label: '会员售价',
      value: `¥${this.formatFenToYuanText(params.memberBaselineFen)}`,
      isDeduction: false,
      isStrikethrough: false,
    });

    // 等级折扣行（会员折扣与活动折扣可叠加，分别展示）
    const levelDiscountFen =
      params.discountAmountFen -
      params.promotionDiscountAmountFen -
      params.totalReduceFen;
    // 当活动折扣率优于会员折扣率时，会员折扣行显示删除线
    const hasBetterActivityDiscount =
      params.promotionType !== null &&
      params.promotionDiscountAmountFen > 0 &&
      params.discountRate != null &&
      params.memberDiscountRate != null &&
      params.discountRate / 100 < params.memberDiscountRate;
    if (levelDiscountFen > 0) {
      const discountRateLabel =
        params.memberDiscountRate != null
          ? ` ${ClubOrderPreviewService.formatDiscountRateLabel(params.memberDiscountRate)}`
          : '';
      items.push({
        id: 'level-discount',
        label: `折扣${discountRateLabel}`,
        value: `-¥${this.formatFenToYuanText(levelDiscountFen)}`,
        isDeduction: !hasBetterActivityDiscount,
        isStrikethrough: hasBetterActivityDiscount,
      });
    }

    // 活动折扣行（如有命中的活动，展示全额折扣并附折扣率）
    if (
      params.promotionType !== null &&
      params.promotionDiscountAmountFen > 0
    ) {
      // 优先用折扣率构建标签（如 "折扣 9.1折"），回退到 promotionTag
      // discountRate 为 0-100 整数（如 91），需除以 100 转为 0-1 再传入格式化
      const activityLabel =
        params.discountRate != null
          ? `折扣 ${ClubOrderPreviewService.formatDiscountRateLabel(params.discountRate / 100)}`
          : (params.promotionTag ?? '活动折扣');
      items.push({
        id: `promotion-${params.promotionType}`,
        label: activityLabel,
        value: `-¥${this.formatFenToYuanText(params.promotionDiscountAmountFen)}`,
        isDeduction: true,
        isStrikethrough: false,
      });
    }

    // 满减行（如有满减）
    if (params.totalReduceFen > 0) {
      items.push({
        id: 'reduce',
        label: '满减优惠',
        value: `-¥${this.formatFenToYuanText(params.totalReduceFen)}`,
        isDeduction: true,
        isStrikethrough: false,
      });
    }

    // 优惠后小计
    items.push({
      id: 'price-before-points',
      label: '优惠后小计',
      value: `¥${this.formatFenToYuanText(params.finalPriceFen)}`,
      isDeduction: false,
      isStrikethrough: false,
    });

    return items;
  }
}

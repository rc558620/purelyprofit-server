/**
 * Club 服务订单价格预计算服务
 *
 * ══════════════════════════════════════════════════════════════════════════
 *                       金额计算核心规则（修改前必读）
 * ══════════════════════════════════════════════════════════════════════════
 *
 * 【规则 1】折扣竞争模型（非叠加模型）
 *   - product.price 本身就是会员价（admin 设定），不再施加会员等级折扣
 *   - 活动折扣直接基于 product.price 计算
 *   - 会员价与活动价取力度最大的一个（amountFen 最低者胜出）
 *   - 不做折上折，只有一个折扣生效
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
 * 【规则 5】折扣明细行展示规则（竞争模型）
 *   - 会员折扣行（划掉行）：
 *     · 标签：使用 resolveMemberDiscountRate() 获取的会员等级折扣率（如 "折扣 9.1折"）
 *     · 金额：会员价 × (1 - 会员折扣率)，例：333 × 0.09 = ¥29.97
 *     · ⚠️ 禁止用 originalPrice - memberPrice 作为金额（会与折扣率不匹配）
 *     · ⚠️ 禁止用 memberPrice / originalPrice 推算折扣率（不是会员等级折扣率）
 *     · 活动胜出时显示删除线 (isStrikethrough=true)
 *   - 活动折扣行：显示活动折扣率（如 "折扣 7.9折"），金额为 (会员价 - 活动价) × 数量
 *   - 满减行：固定标签 "满减优惠"，金额为订单级满减（单次）
 *   - 删除线行 (isStrikethrough=true) 仅信息展示，不参与实际金额计算
 *
 * ══════════════════════════════════════════════════════════════════════════
 */
import { Injectable } from '@nestjs/common';
import { Money } from '../../shared/money.utils';
import { ClubOrderPromotionsService } from './club-order-promotions.service';
import { ClubOrderServiceContextService } from './club-order-service-context.service';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import type {
  ClubOrderBreakdownItemDto,
  ClubServiceOrderPreviewResponseDto,
  PreviewClubServiceOrderDto,
} from './dto/club-order.dto';
import {
  fetchPointsRedeemConfig,
  calcPointsRedeemDetail,
} from './club-order-points.utils';
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
    // ── 价格展示基准规则（设计决策，勿修改）──
    // "会员售价"（breakdown 首行）和"会员价"（header）统一使用 product.price 展示。
    // product.price 本身就是会员价，活动折扣在此基础上计算。
    // resolvePricing 不再施加会员等级折扣（竞争模型）。
    const memberBaselineTotalFen = context.product.price * quantity;
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

    // 折扣总额 = (单价活动折扣额 + 订单满减) × 数量
    // pricing.discountAmountFen 含活动折扣，不含满减（skipReduce）；
    // buildBreakdownItems 需要总优惠（含满减）
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

    // BUG-5 修复：新增 totalSavingWithPoints，含积分抵扣的总节省
    const totalSavingWithPoints =
      pointsDeductFen > 0
        ? Money.fromDbCents(originalPriceFen)
            .subtractClampedToZero(Money.fromDbCents(afterPointsPriceFen))
            .toOutputYuan()
        : null;
    const memberDiscountRate =
      await this.clubOrderPromotionsService.resolveMemberDiscountRate(
        context.store.id,
        currentContext.user.phone,
      );

    // BUG-4 修复：totalReduceFen 应传入 orderReduceFen * quantity 保持量纲一致
    const breakdownItems = this.buildBreakdownItems({
      memberBaselineFen: memberBaselineTotalFen,
      originalPriceFen,
      discountAmountFen: discountTotalFen,
      promotionDiscountAmountFen: promotionDiscountTotalFen,
      promotionType: pricing.promotionType,
      promotionTag: pricing.promotionTag,
      discountRate: pricing.discountRate,
      totalReduceFen: orderReduceFen * quantity,
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
      totalSavingWithPoints,
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
   * 计算积分抵扣金额：预览接口始终计算可抵扣金额（不受 enabled 开关限制）。
   *
   * ════════════════════════════════════════════════════════════════
   *  ⚠️  项目设计决策（禁止修改）：
   *      积分抵扣不受 enabled 开关限制——preview 和 creation 两个 service
   *      均不检查 enabled 字段。前端积分开关仅由「用户是否有积分」控制。
   *      禁止在任何一处引入 enabled 拦截逻辑。
   * ════════════════════════════════════════════════════════════════
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

    // ⚠️ 设计决策：fetchPointsRedeemConfig 返回的 enabled 字段在此处被有意忽略。
    // 积分抵扣不受 enabled 开关限制，只取 redeemRatioPoints / maxRedeemRatio 进行计算。
    // 禁止在此方法中引入 enabled 检查逻辑。
    const pointsRatio = await fetchPointsRedeemConfig(this.prisma, storeId);

    const customer = await this.prisma.marketingCustomer.findUnique({
      where: { id: customerId },
      select: { points: true },
    });

    const availablePoints = customer?.points ?? 0;

    return calcPointsRedeemDetail(
      priceAfterDiscountFen,
      pointsRatio,
      availablePoints,
    );
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
   * 竞争模型展示规则：
   *   - 会员折扣行：显示从原价到会员价的节省（originalPrice - memberPrice）
   *   - 活动折扣行：显示活动折扣金额（memberPrice - activityPrice）
   *   - 两者竞争：活动胜出时会员折扣行显示删除线（仅信息展示）
   *   - 满减始终叠加
   */
  private buildBreakdownItems(params: {
    memberBaselineFen: number;
    /** 商品原价（分）× 数量，用于计算会员折扣行金额 */
    originalPriceFen: number;
    discountAmountFen: number;
    promotionDiscountAmountFen: number;
    promotionType: string | null;
    promotionTag: string | null;
    /** 命中活动的折扣率（0-100 整数），用于活动折扣行显示几折 */
    discountRate: number | null;
    totalReduceFen: number;
    finalPriceFen: number;
    /** 会员等级折扣率（0-1 小数，如 0.91 表示 9.1折），用于划掉行显示 */
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

    // 会员折扣行：会员价 × (1 - 会员折扣率) = 会员折扣可省金额
    //
    // ══════════════════════════════════════════════════════════════
    // ⚠️ 金额和折扣率必须匹配，禁止以下错误做法：
    //
    // ❌ 错误 1：用 originalPrice - memberPrice 作为金额
    //    例：555 - 333 = 222，但 9.1折 对应的金额是 29.97，不是 222
    // ❌ 错误 2：用 memberPrice / originalPrice 推算折扣率
    //    例：333 / 555 ≈ 0.6 → "6折"，但实际会员等级是 9.1折
    //
    // ✅ 正确做法：
    //    · 折扣率 = resolveMemberDiscountRate() 返回的会员等级配置值（如 0.91）
    //    · 金额 = memberPrice × (1 - memberDiscountRate)
    //    · 例：333 × (1 - 0.91) = 333 × 0.09 = 29.97 → "折扣 9.1折 -¥29.97"
    // ══════════════════════════════════════════════════════════════
    const memberRate = params.memberDiscountRate;
    const hasMemberRate = memberRate != null && memberRate < 1;
    const levelDiscountFen = hasMemberRate
      ? Math.round(params.memberBaselineFen * (1 - memberRate))
      : 0;
    // 竞争模型：活动折扣胜出时，会员折扣行显示删除线
    const hasActivity = params.promotionType !== null;
    if (levelDiscountFen > 0 && hasMemberRate) {
      const levelLabel = `折扣 ${ClubOrderPreviewService.formatDiscountRateLabel(memberRate)}`;
      items.push({
        id: 'level-discount',
        label: levelLabel,
        value: `-¥${this.formatFenToYuanText(levelDiscountFen)}`,
        isDeduction: !hasActivity,
        isStrikethrough: hasActivity,
      });
    }

    // 活动折扣行（竞争胜出时展示全额折扣并附折扣率）
    if (
      params.promotionType !== null &&
      params.promotionDiscountAmountFen > 0
    ) {
      // 优先用折扣率构建标签（如 "折扣 7.9折"），回退到 promotionTag
      // discountRate 为 0-100 整数（如 79），需除以 100 转为 0-1 再传入格式化
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

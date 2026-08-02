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
import { ClubOrderPreviewBreakdownService } from './club-order-preview-breakdown.service';

export interface ClubMarketingPreviewLine {
  unitAmountFen: number;
  quantity: number;
}

export interface ClubMarketingPreviewResult {
  productDiscountAmountFen: number;
  orderDiscountAmountFen: number;
  /** 积分抵扣前的优惠后小计。 */
  payableAmountFen: number;
  pointsDeductFen: number;
  pointsUsed: number;
  afterPointsPriceFen: number;
  redeemRatioPoints: number;
  availablePoints: number;
  breakdownItems: ClubOrderBreakdownItemDto[];
}

@Injectable()
export class ClubOrderPreviewService {
  constructor(
    private readonly clubOrderServiceContextService: ClubOrderServiceContextService,
    private readonly clubOrderPromotionsService: ClubOrderPromotionsService,
    private readonly prisma: PrismaService,
    private readonly breakdownService: ClubOrderPreviewBreakdownService,
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
    const breakdownItems = this.breakdownService.build({
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

  async previewMarketingLines(
    storeId: number,
    customerId: number,
    phone: string,
    lines: ClubMarketingPreviewLine[],
    usePoints: boolean,
  ): Promise<ClubMarketingPreviewResult> {
    const resolutions = await Promise.all(
      lines.map((line) =>
        this.clubOrderPromotionsService.resolvePricing(
          storeId,
          customerId,
          phone,
          line.unitAmountFen,
          { skipReduce: true },
        ),
      ),
    );
    const beforeReduceAmountFen = resolutions.reduce(
      (total, resolution, index) =>
        total + resolution.amountFenBeforeReduce * lines[index].quantity,
      0,
    );
    const orderDiscountAmountFen =
      await this.clubOrderPromotionsService.resolveOrderReduceFen(
        storeId,
        beforeReduceAmountFen,
      );
    const productDiscountAmountFen = resolutions.reduce(
      (total, resolution, index) =>
        total + resolution.promotionDiscountAmountFen * lines[index].quantity,
      0,
    );
    const payableAmountFen = Math.max(
      beforeReduceAmountFen - orderDiscountAmountFen,
      0,
    );
    const memberDiscountRate =
      await this.clubOrderPromotionsService.resolveMemberDiscountRate(
        storeId,
        phone,
      );
    const pointsPreview = await this.resolveMarketingPointsPreview(
      storeId,
      customerId,
      payableAmountFen,
      usePoints,
    );
    const representativeResolution =
      resolutions.find((resolution) => resolution.promotionType !== null) ??
      resolutions[0];
    const memberBaselineFen = lines.reduce(
      (total, line) => total + line.unitAmountFen * line.quantity,
      0,
    );
    const breakdownItems = this.breakdownService
      .build({
        memberBaselineFen,
        originalPriceFen: memberBaselineFen,
        discountAmountFen: productDiscountAmountFen + orderDiscountAmountFen,
        promotionDiscountAmountFen: productDiscountAmountFen,
        promotionType: representativeResolution?.promotionType ?? null,
        promotionTag: representativeResolution?.promotionTag ?? null,
        discountRate: representativeResolution?.discountRate ?? null,
        totalReduceFen: orderDiscountAmountFen,
        finalPriceFen: payableAmountFen,
        memberDiscountRate,
      })
      .filter(
        (item) =>
          item.id !== 'member-price' && item.id !== 'price-before-points',
      );
    return {
      productDiscountAmountFen,
      orderDiscountAmountFen,
      payableAmountFen,
      ...pointsPreview,
      breakdownItems,
    };
  }

  private async resolveMarketingPointsPreview(
    storeId: number,
    customerId: number,
    payableAmountFen: number,
    usePoints: boolean,
  ): Promise<{
    pointsDeductFen: number;
    pointsUsed: number;
    afterPointsPriceFen: number;
    redeemRatioPoints: number;
    availablePoints: number;
  }> {
    const [config, customer] = await Promise.all([
      fetchPointsRedeemConfig(this.prisma, storeId),
      this.prisma.marketingCustomer.findUnique({
        where: { id: customerId },
        select: { points: true },
      }),
    ]);
    const availablePoints = customer?.points ?? 0;
    const { pointsDeductFen, pointsUsed } = usePoints
      ? calcPointsRedeemDetail(payableAmountFen, config, availablePoints)
      : { pointsDeductFen: 0, pointsUsed: 0 };
    return {
      pointsDeductFen,
      pointsUsed,
      afterPointsPriceFen: Math.max(payableAmountFen - pointsDeductFen, 0),
      redeemRatioPoints: config.redeemRatioPoints,
      availablePoints,
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
}

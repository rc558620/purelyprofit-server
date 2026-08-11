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
import type { ClubServicePricingResolution } from './club-order-promotions.service';
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
  /** 会员等级折扣（分）。扫码点餐菜单的 unitAmountFen 是原价，不含会员折扣，
   *  因此会员折扣在此实际生效；调用方需将其累加进商品级优惠一起分摊到行级。 */
  memberDiscountFen: number;
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
    const memberBaselineTotalFen = context.product.price * quantity;

    // ── 竞争模型：会员等级折扣 vs 活动折扣，取更低者生效（与 purelyClub 扫码点餐口径一致）──
    // resolvePricing 的活动竞争仅基于会员价（product.price）；此处额外把会员等级
    // 折扣率纳入竞争：会员折后价更低时会员胜出（活动被覆盖，活动行划线展示）。
    const memberDiscountRate =
      await this.clubOrderPromotionsService.resolveMemberDiscountRate(
        context.store.id,
        currentContext.user.phone,
      );
    const effectiveMemberRate =
      memberDiscountRate != null && memberDiscountRate < 1
        ? memberDiscountRate
        : 1;
    const memberPriceFen = Math.round(
      context.product.price * effectiveMemberRate,
    );
    const activityPriceFen = pricing.amountFenBeforeReduce;
    const memberWins =
      effectiveMemberRate < 1 && memberPriceFen <= activityPriceFen;
    const bestPriceFen = Math.min(memberPriceFen, activityPriceFen);
    // 满减前应付总额 = 竞争胜出价 × 数量
    const beforeReduceTotalFen = bestPriceFen * quantity;

    // ── 满减：基于订单总额计算，单次生效，不叠加 ──
    const reduceDetail =
      await this.clubOrderPromotionsService.resolveOrderReduceDetail(
        context.store.id,
        beforeReduceTotalFen,
      );
    const orderReduceFen = reduceDetail.totalReduceFen;

    // 最终应付 = 满减前总额 - 满减
    const finalPriceFen = Math.max(beforeReduceTotalFen - orderReduceFen, 0);

    // 折扣总额 = 原价 - 最终价（含活动/会员折扣与满减，不含积分）
    const discountTotalFen = Math.max(originalPriceFen - finalPriceFen, 0);
    // 活动理论优惠额（分，×数量）：用于 breakdown 展示（会员胜出时划线展示）
    const promotionDiscountTotalFen =
      pricing.promotionDiscountAmountFen * quantity;

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

    // ── 余额充足性判断（由后端计算，前端仅展示结果） ──
    // 余额是否足够支付积分抵扣后的实付金额；文案由后端拼装，含全部金额信息
    const customer = await this.prisma.marketingCustomer.findUnique({
      where: { id: context.customer.id },
      select: { balance: true },
    });
    const customerBalanceFen = customer?.balance ?? 0;
    const balanceEnough = customerBalanceFen >= afterPointsPriceFen;
    const insufficientBalanceMessage = balanceEnough
      ? null
      : `当前余额 ¥${Money.fromDbCents(customerBalanceFen).toFixedOutputYuan()}，本次需支付 ¥${Money.fromDbCents(afterPointsPriceFen).toFixedOutputYuan()}，请先充值`;

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

    // 满减为订单级单次优惠：totalReduceFen 传 orderReduceFen（不乘数量），
    // 与 previewMarketingLines 的 breakdown 口径保持一致
    const breakdownItems = this.breakdownService.build({
      memberBaselineFen: memberBaselineTotalFen,
      originalPriceFen,
      discountAmountFen: discountTotalFen,
      promotionDiscountAmountFen: promotionDiscountTotalFen,
      promotionType: pricing.promotionType,
      promotionTag: pricing.promotionTag,
      discountRate: pricing.discountRate,
      totalReduceFen: orderReduceFen,
      reduceRules: reduceDetail.reduceRules,
      finalPriceFen,
      memberDiscountRate,
      memberWins,
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
      balanceEnough,
      insufficientBalanceMessage,
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
    const memberDiscountRate =
      await this.clubOrderPromotionsService.resolveMemberDiscountRate(
        storeId,
        phone,
      );
    // 竞争模型：每行取会员折后价与活动折后价中更低者生效（不叠加），
    // 与 breakdown 划线语义一致——活动胜出时会员折扣不生效。
    const competition = this.resolveLineCompetition(
      lines,
      resolutions,
      memberDiscountRate,
    );
    const reduceDetail =
      await this.clubOrderPromotionsService.resolveOrderReduceDetail(
        storeId,
        competition.beforeReduceAmountFen,
      );
    const orderDiscountAmountFen = reduceDetail.totalReduceFen;
    const payableAmountFen = Math.max(
      competition.beforeReduceAmountFen - orderDiscountAmountFen,
      0,
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
    // 活动理论优惠额（分）：resolvePricing 的原始活动优惠 × 数量。
    // 与竞争结果无关——会员胜出时活动被覆盖，仍以理论值划线展示活动行。
    const activityDiscountAmountFen = resolutions.reduce(
      (total, resolution, index) =>
        total + resolution.promotionDiscountAmountFen * lines[index].quantity,
      0,
    );
    const memberBaselineFen = lines.reduce(
      (total, line) => total + line.unitAmountFen * line.quantity,
      0,
    );
    const breakdownItems = this.breakdownService
      .build({
        memberBaselineFen,
        originalPriceFen: memberBaselineFen,
        discountAmountFen:
          competition.productDiscountAmountFen +
          orderDiscountAmountFen +
          competition.memberDiscountFen,
        promotionDiscountAmountFen: activityDiscountAmountFen,
        promotionType: representativeResolution?.promotionType ?? null,
        promotionTag: representativeResolution?.promotionTag ?? null,
        discountRate: representativeResolution?.discountRate ?? null,
        totalReduceFen: orderDiscountAmountFen,
        reduceRules: reduceDetail.reduceRules,
        finalPriceFen: payableAmountFen,
        memberDiscountRate,
        // 会员折扣实际生效（至少一行会员胜出）时：会员行正常、活动行划线
        memberWins: competition.memberDiscountFen > 0,
      })
      .filter(
        (item) =>
          item.id !== 'member-price' && item.id !== 'price-before-points',
      );
    return {
      productDiscountAmountFen: competition.productDiscountAmountFen,
      orderDiscountAmountFen,
      memberDiscountFen: competition.memberDiscountFen,
      payableAmountFen,
      ...pointsPreview,
      breakdownItems,
    };
  }

  /**
   * 行级竞争：会员折后价 vs 活动折后价，取更低者生效（不叠加）。
   * 返回竞争后的满减前总额、活动优惠总额、会员优惠总额（均为分）。
   */
  private resolveLineCompetition(
    lines: ClubMarketingPreviewLine[],
    resolutions: ClubServicePricingResolution[],
    memberDiscountRate: number | null,
  ): {
    beforeReduceAmountFen: number;
    productDiscountAmountFen: number;
    memberDiscountFen: number;
  } {
    // 会员折扣率有效（0-1）时参与竞争；否则会员价即原价
    const effectiveMemberRate =
      memberDiscountRate != null && memberDiscountRate < 1
        ? memberDiscountRate
        : 1;
    let beforeReduceAmountFen = 0;
    let productDiscountAmountFen = 0;
    let memberDiscountFen = 0;
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      const resolution = resolutions[index];
      const memberPriceFen = Math.round(
        line.unitAmountFen * effectiveMemberRate,
      );
      const activityPriceFen = resolution.amountFenBeforeReduce;
      const bestPriceFen = Math.min(memberPriceFen, activityPriceFen);
      const quantity = line.quantity;
      beforeReduceAmountFen += bestPriceFen * quantity;
      if (memberPriceFen <= activityPriceFen) {
        // 会员折扣胜出（或与活动持平）：优惠来自会员折扣
        memberDiscountFen += (line.unitAmountFen - memberPriceFen) * quantity;
      } else {
        // 活动胜出：优惠来自活动折扣
        productDiscountAmountFen +=
          (line.unitAmountFen - activityPriceFen) * quantity;
      }
    }
    return {
      beforeReduceAmountFen,
      productDiscountAmountFen,
      memberDiscountFen,
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

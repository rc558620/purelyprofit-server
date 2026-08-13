/**
 * Club 服务订单价格预计算服务
 *
 * ════════════════════════════════════════════════════════
 *            金额计算核心规则（修改前必读）
 * ════════════════════════════════════════════════════════
 * 1. 折扣竞争模型（非叠加）：product.price 即会员价（admin 设定），
 *    活动折扣直接基于它计算；会员价与活动价取力度最大者（amountFen 最低）
 *    生效，不做折上折，只有一个折扣生效。
 * 2. 满减订单级单次生效：门槛基于「折扣后订单总额」而非单价，每个满减活动
 *    最多生效一次，不随数量叠加；resolvePricing 用 skipReduce=true 跳过
 *    单件满减，再由本服务基于订单总额重算（resolveOrderReduceDetail）。
 * 3. 金额精度：内部计算统一「分」级整数（Decimal.js + ROUND_HALF_UP），
 *    输出经 Money.toOutputYuan() 转元（两位小数），禁止浮点直接运算。
 * 4. 前端严禁业务金额计算：所有金额字段由本服务计算后返回，前端仅做展示；
 *    breakdownItems 的 label/value/isStrikethrough 全部由后端决定。
 * 5. 折扣明细行展示（竞争模型）：
 *    - 会员折扣行：标签用 resolveMemberDiscountRate() 折扣率（如"折扣 9.1折"），
 *      金额 = 会员价 × (1 - 折扣率)；禁止用原价差或倒推折扣率；
 *    - 活动折扣行：金额 = (会员价 - 活动价) × 数量；
 *    - 满减行：固定标签"满减优惠"，金额为订单级单次；
 *    - 划线行（isStrikethrough=true）仅信息展示，不参与实际金额计算。
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
import { resolvePointsDeduction } from './club-order-points.utils';
import { PrismaService } from '../../prisma/prisma.service';
import { ClubOrderPreviewBreakdownService } from './club-order-preview-breakdown.service';
import type {
  ClubBalanceCheckResult,
  ClubBuildPreviewResponseParams,
  ClubResolveServiceOrderAmountsParams,
  ClubServiceOrderAmounts,
} from './club-order-preview.types';

// 对外类型契约保持导出不变（扫码点餐适配器等依赖）
export type {
  ClubMarketingPreviewLine,
  ClubMarketingPreviewResult,
} from './club-order-preview.types';

@Injectable()
export class ClubOrderPreviewService {
  constructor(
    private readonly clubOrderServiceContextService: ClubOrderServiceContextService,
    private readonly clubOrderPromotionsService: ClubOrderPromotionsService,
    private readonly prisma: PrismaService,
    private readonly breakdownService: ClubOrderPreviewBreakdownService,
  ) {}

  /** 单商品服务订单预览：原价 → 会员/活动竞争 → 满减 → 积分抵扣 → 余额检查 */
  async previewServiceOrder(
    currentContext: ClubCurrentContext,
    dto: PreviewClubServiceOrderDto,
  ): Promise<ClubServiceOrderPreviewResponseDto> {
    const context =
      await this.clubOrderServiceContextService.resolveCreateServiceOrderContext(
        currentContext,
        { storeId: dto.storeId, productId: dto.productId },
      );
    // 并行解析：活动定价（skipReduce 跳过单件满减）+ 会员等级折扣率
    const [pricing, memberDiscountRate] = await Promise.all([
      this.clubOrderPromotionsService.resolvePricing(
        context.store.id,
        context.customer.id,
        currentContext.user.phone,
        context.product.price,
        { skipReduce: true },
      ),
      this.clubOrderPromotionsService.resolveMemberDiscountRate(
        context.store.id,
        currentContext.user.phone,
      ),
    ]);
    const quantity = dto.quantity ?? 1;
    // 订单级金额计算：竞争模型（会员 vs 活动）+ 满减（订单总额、单次生效）
    const amounts = await this.resolveServiceOrderAmounts({
      storeId: context.store.id,
      productPriceFen: context.product.price,
      originalPriceFen:
        (context.product.originalPrice ?? context.product.price) * quantity,
      quantity,
      pricing,
      memberDiscountRate,
    });
    // 积分抵扣计算（基于乘以数量后的金额）
    const { pointsDeductFen, pointsUsed } = await resolvePointsDeduction(
      this.prisma,
      currentContext.store.id,
      context.customer.id,
      amounts.finalPriceFen,
      dto.usePoints === true,
    );
    // 余额充足性判断（由后端计算，前端仅展示结果）
    const balanceCheck = await this.resolveBalanceCheck(
      context.customer.id,
      amounts.finalPriceFen,
      pointsDeductFen,
    );

    return this.buildPreviewResponse({
      amounts,
      pricing,
      quantity,
      memberDiscountRate,
      pointsDeductFen,
      pointsUsed,
      balanceCheck,
    });
  }

  /**
   * 订单级金额计算：会员/活动竞争模型 + 满减（订单总额、单次生效）。
   *
   * 价格展示基准规则（设计决策，勿修改）："会员售价"（breakdown 首行）与
   * "会员价"（header）统一使用 product.price 展示；product.price 本身就是
   * 会员价，活动折扣在此基础上计算。
   */
  private async resolveServiceOrderAmounts(
    params: ClubResolveServiceOrderAmountsParams,
  ): Promise<ClubServiceOrderAmounts> {
    const {
      storeId,
      productPriceFen,
      originalPriceFen,
      quantity,
      pricing,
      memberDiscountRate,
    } = params;
    const memberBaselineTotalFen = productPriceFen * quantity;

    // 竞争模型：会员等级折扣 vs 活动折扣，取更低者生效（与 purelyClub 扫码点餐
    // 口径一致）。resolvePricing 的活动竞争仅基于会员价（product.price）；
    // 此处额外把会员等级折扣率纳入竞争：会员折后价更低时会员胜出（活动行划线）。
    const effectiveMemberRate =
      memberDiscountRate != null && memberDiscountRate < 1
        ? memberDiscountRate
        : 1;
    const memberPriceFen = Math.round(productPriceFen * effectiveMemberRate);
    const activityPriceFen = pricing.amountFenBeforeReduce;
    const memberWins =
      effectiveMemberRate < 1 && memberPriceFen <= activityPriceFen;
    const bestPriceFen = Math.min(memberPriceFen, activityPriceFen);
    // 满减前应付总额 = 竞争胜出价 × 数量
    const beforeReduceTotalFen = bestPriceFen * quantity;

    // 满减：基于订单总额计算，单次生效，不叠加
    const reduceDetail =
      await this.clubOrderPromotionsService.resolveOrderReduceDetail(
        storeId,
        beforeReduceTotalFen,
      );
    const orderReduceFen = reduceDetail.totalReduceFen;
    // 最终应付 = 满减前总额 - 满减
    const finalPriceFen = Math.max(beforeReduceTotalFen - orderReduceFen, 0);

    return {
      memberBaselineTotalFen,
      originalPriceFen,
      beforeReduceTotalFen,
      orderReduceFen,
      finalPriceFen,
      // 折扣总额 = 原价 - 最终价（含活动/会员折扣与满减，不含积分）
      discountTotalFen: Math.max(originalPriceFen - finalPriceFen, 0),
      // 活动理论优惠额（分，×数量）：用于 breakdown 展示（会员胜出时划线展示）
      promotionDiscountTotalFen: pricing.promotionDiscountAmountFen * quantity,
      memberWins,
      reduceRules: reduceDetail.reduceRules,
    };
  }

  /** 余额充足性判断：余额 >= 积分抵扣后实付；提示文案由后端拼装（前端仅展示） */
  private async resolveBalanceCheck(
    customerId: number,
    finalPriceFen: number,
    pointsDeductFen: number,
  ): Promise<ClubBalanceCheckResult> {
    const afterPointsPriceFen = Money.fromDbCents(finalPriceFen)
      .subtractClampedToZero(Money.fromDbCents(pointsDeductFen))
      .toDbCents();
    const customer = await this.prisma.marketingCustomer.findUnique({
      where: { id: customerId },
      select: { balance: true },
    });
    const customerBalanceFen = customer?.balance ?? 0;
    const balanceEnough = customerBalanceFen >= afterPointsPriceFen;
    const insufficientBalanceMessage = balanceEnough
      ? null
      : `当前余额 ¥${Money.fromDbCents(customerBalanceFen).toFixedOutputYuan()}，本次需支付 ¥${Money.fromDbCents(afterPointsPriceFen).toFixedOutputYuan()}，请先充值`;
    return { balanceEnough, insufficientBalanceMessage, afterPointsPriceFen };
  }

  /** 组装预览响应 DTO：总节省金额 + 价格拆解行 */
  private buildPreviewResponse(
    params: ClubBuildPreviewResponseParams,
  ): ClubServiceOrderPreviewResponseDto {
    const {
      amounts,
      pricing,
      quantity,
      memberDiscountRate,
      pointsDeductFen,
      pointsUsed,
      balanceCheck,
    } = params;
    const totalSavingAmount = Money.fromDbCents(amounts.originalPriceFen)
      .subtractClampedToZero(Money.fromDbCents(amounts.finalPriceFen))
      .toOutputYuan();
    // BUG-5 修复：新增 totalSavingWithPoints，含积分抵扣的总节省
    const totalSavingWithPoints =
      pointsDeductFen > 0
        ? Money.fromDbCents(amounts.originalPriceFen)
            .subtractClampedToZero(
              Money.fromDbCents(balanceCheck.afterPointsPriceFen),
            )
            .toOutputYuan()
        : null;
    const breakdownItems = this.buildServiceOrderBreakdown({
      amounts,
      pricing,
      memberDiscountRate,
    });
    return {
      originalPrice: Money.fromDbCents(amounts.originalPriceFen).toOutputYuan(),
      memberBaselinePrice: Money.fromDbCents(
        amounts.memberBaselineTotalFen,
      ).toOutputYuan(),
      afterDiscountPrice: Money.fromDbCents(
        amounts.beforeReduceTotalFen,
      ).toOutputYuan(),
      reduceAmount: Money.fromDbCents(amounts.orderReduceFen).toOutputYuan(),
      finalPrice: Money.fromDbCents(amounts.finalPriceFen).toOutputYuan(),
      totalSavingAmount,
      totalSavingWithPoints,
      pointsDeductionAmount: Money.fromDbCents(pointsDeductFen).toOutputYuan(),
      pointsUsed,
      afterPointsPrice: Money.fromDbCents(
        balanceCheck.afterPointsPriceFen,
      ).toOutputYuan(),
      promotionId:
        pricing.promotionId !== null ? String(pricing.promotionId) : null,
      promotionType: pricing.promotionType,
      discountRate: pricing.discountRate,
      promotionTag: pricing.promotionTag,
      quantity,
      balanceEnough: balanceCheck.balanceEnough,
      insufficientBalanceMessage: balanceCheck.insufficientBalanceMessage,
      breakdownItems,
    };
  }

  /** 单商品订单价格拆解行构建 */
  private buildServiceOrderBreakdown(params: {
    amounts: ClubServiceOrderAmounts;
    pricing: ClubServicePricingResolution;
    memberDiscountRate: number | null;
  }): ClubOrderBreakdownItemDto[] {
    const { amounts, pricing, memberDiscountRate } = params;
    // 满减为订单级单次优惠：totalReduceFen 传 orderReduceFen（不乘数量），
    // 与 previewMarketingLines 的 breakdown 口径保持一致
    return this.breakdownService.build({
      memberBaselineFen: amounts.memberBaselineTotalFen,
      originalPriceFen: amounts.originalPriceFen,
      discountAmountFen: amounts.discountTotalFen,
      promotionDiscountAmountFen: amounts.promotionDiscountTotalFen,
      promotionType: pricing.promotionType,
      promotionTag: pricing.promotionTag,
      discountRate: pricing.discountRate,
      totalReduceFen: amounts.orderReduceFen,
      reduceRules: amounts.reduceRules,
      finalPriceFen: amounts.finalPriceFen,
      memberDiscountRate,
      memberWins: amounts.memberWins,
    });
  }
}

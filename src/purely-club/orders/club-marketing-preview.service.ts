/**
 * Club 营销多行预览服务（扫码点餐）
 *
 * 从 club-order-preview.service.ts 拆分（refactor 模式）：
 * - ClubOrderPreviewService 专注单商品服务订单预览（C 端服务购买页）
 * - 本服务专注多行营销预览（扫码点餐菜单），消费方为 ScanOrderingPromotionAdapter
 *
 * 金额计算核心规则与 ClubOrderPreviewService 一致（见该文件头部注释）：
 * 竞争模型非叠加、满减订单级单次生效、分级别整数运算、前端严禁金额计算。
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ClubOrderPromotionsService } from './club-order-promotions.service';
import type { ClubServicePricingResolution } from './club-order-promotions.service';
import { ClubOrderPreviewBreakdownService } from './club-order-preview-breakdown.service';
import {
  calcPointsRedeemDetail,
  fetchPointsRedeemConfig,
} from './club-order-points.utils';
import type {
  ClubBuildMarketingBreakdownParams,
  ClubLineCompetitionResult,
  ClubLinesPricingResult,
  ClubMarketingPreviewLine,
  ClubMarketingPreviewResult,
  ClubPointsPreviewResult,
} from './club-order-preview.types';
import type { ClubOrderBreakdownItemDto } from './dto/club-order.dto';

@Injectable()
export class ClubMarketingPreviewService {
  constructor(
    private readonly clubOrderPromotionsService: ClubOrderPromotionsService,
    private readonly prisma: PrismaService,
    private readonly breakdownService: ClubOrderPreviewBreakdownService,
  ) {}

  /** 多行营销预览（扫码点餐）：每行独立竞争，订单级满减单次生效 */
  async previewMarketingLines(
    storeId: number,
    customerId: number,
    phone: string,
    lines: ClubMarketingPreviewLine[],
    usePoints: boolean,
  ): Promise<ClubMarketingPreviewResult> {
    const memberDiscountRate =
      await this.clubOrderPromotionsService.resolveMemberDiscountRate(
        storeId,
        phone,
      );
    const {
      resolutions,
      competition,
      reduceDetail,
      orderDiscountAmountFen,
      payableAmountFen,
    } = await this.resolveLinesPricing(
      storeId,
      customerId,
      phone,
      lines,
      memberDiscountRate,
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
    const breakdownItems = this.buildMarketingBreakdown({
      lines,
      resolutions,
      competition,
      reduceDetail,
      orderDiscountAmountFen,
      payableAmountFen,
      memberDiscountRate,
      representativeResolution,
    });
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
   * 行级定价：每行 resolvePricing（skipReduce）→ 竞争模型 → 订单级满减
   */
  private async resolveLinesPricing(
    storeId: number,
    customerId: number,
    phone: string,
    lines: ClubMarketingPreviewLine[],
    memberDiscountRate: number | null,
  ): Promise<ClubLinesPricingResult> {
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
    return {
      resolutions,
      competition,
      reduceDetail,
      orderDiscountAmountFen,
      payableAmountFen,
    };
  }

  /** 营销预览价格拆解行构建（含活动理论优惠额汇总，与竞争结果无关） */
  private buildMarketingBreakdown(
    params: ClubBuildMarketingBreakdownParams,
  ): ClubOrderBreakdownItemDto[] {
    const {
      lines,
      resolutions,
      competition,
      reduceDetail,
      orderDiscountAmountFen,
      payableAmountFen,
      memberDiscountRate,
      representativeResolution,
    } = params;
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
    return this.breakdownService
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
  }

  /**
   * 行级竞争：会员折后价 vs 活动折后价，取更低者生效（不叠加）。
   * 返回竞争后的满减前总额、活动优惠总额、会员优惠总额（均为分）。
   */
  private resolveLineCompetition(
    lines: ClubMarketingPreviewLine[],
    resolutions: ClubServicePricingResolution[],
    memberDiscountRate: number | null,
  ): ClubLineCompetitionResult {
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
  ): Promise<ClubPointsPreviewResult> {
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
}

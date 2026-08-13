/**
 * Club 服务订单预览公共类型
 *
 * 从 club-order-preview.service.ts 提取（refactor 模式），供单商品预览服务、
 * 多行营销预览服务与扫码点餐适配器复用，避免类型定义与主 service 文件耦合。
 */
import type { ClubOrderBreakdownItemDto } from './dto/club-order.dto';
import type { ClubServicePricingResolution } from './club-order-promotions.service';

/** 营销预览行（扫码点餐菜单行：单价分 + 数量） */
export interface ClubMarketingPreviewLine {
  unitAmountFen: number;
  quantity: number;
}

/** 营销预览结果（扫码点餐适配器消费） */
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

/** 行级竞争结果：会员折后价 vs 活动折后价，取更低者生效（不叠加） */
export interface ClubLineCompetitionResult {
  beforeReduceAmountFen: number;
  productDiscountAmountFen: number;
  memberDiscountFen: number;
}

/** 满减生效规则（门槛分 / 减免分） */
export interface ClubReduceRule {
  thresholdFen: number;
  reduceAmountFen: number;
}

/** 单商品服务订单预览的订单级金额结果（全部为分） */
export interface ClubServiceOrderAmounts {
  memberBaselineTotalFen: number;
  originalPriceFen: number;
  beforeReduceTotalFen: number;
  orderReduceFen: number;
  finalPriceFen: number;
  discountTotalFen: number;
  promotionDiscountTotalFen: number;
  memberWins: boolean;
  reduceRules: ClubReduceRule[];
}

/** 余额充足性检查结果（由后端计算，前端仅展示） */
export interface ClubBalanceCheckResult {
  balanceEnough: boolean;
  insufficientBalanceMessage: string | null;
  /** 积分抵扣后实付（分），供响应组装复用 */
  afterPointsPriceFen: number;
}

/** 积分抵扣预览结果 */
export interface ClubPointsPreviewResult {
  pointsDeductFen: number;
  pointsUsed: number;
  afterPointsPriceFen: number;
  redeemRatioPoints: number;
  availablePoints: number;
}

/** resolveServiceOrderAmounts 参数（订单级金额计算） */
export interface ClubResolveServiceOrderAmountsParams {
  storeId: number;
  productPriceFen: number;
  originalPriceFen: number;
  quantity: number;
  pricing: ClubServicePricingResolution;
  memberDiscountRate: number | null;
}

/** buildPreviewResponse 参数（预览响应组装） */
export interface ClubBuildPreviewResponseParams {
  amounts: ClubServiceOrderAmounts;
  pricing: ClubServicePricingResolution;
  quantity: number;
  memberDiscountRate: number | null;
  pointsDeductFen: number;
  pointsUsed: number;
  balanceCheck: ClubBalanceCheckResult;
}

/** buildMarketingBreakdown 参数（营销预览拆解行构建） */
export interface ClubBuildMarketingBreakdownParams {
  lines: ClubMarketingPreviewLine[];
  resolutions: ClubServicePricingResolution[];
  competition: ClubLineCompetitionResult;
  reduceDetail: { totalReduceFen: number; reduceRules: ClubReduceRule[] };
  orderDiscountAmountFen: number;
  payableAmountFen: number;
  memberDiscountRate: number | null;
  representativeResolution: ClubServicePricingResolution;
}

/** 营销行级定价结果（每行定价 + 竞争 + 订单级满减） */
export interface ClubLinesPricingResult {
  resolutions: ClubServicePricingResolution[];
  competition: ClubLineCompetitionResult;
  reduceDetail: { totalReduceFen: number; reduceRules: ClubReduceRule[] };
  orderDiscountAmountFen: number;
  payableAmountFen: number;
}

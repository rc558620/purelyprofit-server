import {
  toOptionalMediaText,
  toOptionalText,
} from '../commerce/commerce.utils';
import { Money } from '../../shared/money.utils';
import type {
  MarketingConsumptionDto,
  MarketingCustomerDto,
  MarketingPointsRecordDto,
  MarketingPromotionDto,
  MarketingRechargeDto,
} from './dto/marketing-response.dto';
import type {
  MarketingProductCategoryDto,
  MarketingProductDto,
} from './dto/marketing-product.dto';
import type {
  MarketingConsumptionRow,
  MarketingCustomerRow,
  MarketingPointsRecordRow,
  MarketingProductCategoryRow,
  MarketingProductRow,
  MarketingPromotionRow,
  MarketingRechargeRow,
} from './marketing.types';
import {
  MARKETING_CUSTOMER_TIER_VALUES,
  type MarketingCustomerTierValue,
  calcCustomerStatus,
  calcPromotionStatus,
  normalizePhone,
  safeEnumCoerce,
  MARKETING_PAY_TYPE_VALUES,
  MARKETING_POINTS_CHANGE_TYPE_VALUES,
  MARKETING_RECHARGE_TYPE_VALUES,
  type MarketingPayTypeValue,
  type MarketingPointsChangeTypeValue,
  type MarketingPromotionParamsValue,
  type MarketingPromotionTypeValue,
  type MarketingRechargeTypeValue,
} from './marketing.utils';
import {
  normalizePromotionParams,
  mapPromotionParamsForOutput,
} from './marketing.mapper.promotion-params';

export {
  normalizePromotionParams,
  mapPromotionParamsForWrite,
  mapPromotionParamsForOutput,
} from './marketing.mapper.promotion-params';

export {
  buildEmptyMarketingOverview,
  buildOverviewLast30Days,
  buildOverviewMonthlyTrend,
} from './marketing.mapper.overview';

// ─── 活动展示文案计算 ─────────────────────────────────────────────

/**
 * 根据活动类型和参数计算展示文案。
 * 此函数是后端 source of truth，前端应优先消费 displayText 而非自行推导。
 *
 * @param type 活动类型
 * @param params 已归一化的活动参数
 * @returns 展示文案字符串，未知类型返回空字符串
 */
export function buildPromotionDisplayText(
  type: string,
  params: MarketingPromotionParamsValue,
): string {
  if (type === 'discount' || type === 'discount_day') {
    const discountRate =
      typeof params.discountRate === 'number'
        ? params.discountRate
        : typeof params.rate === 'number'
          ? Math.round(params.rate * 100)
          : undefined;
    if (discountRate === undefined) return '';
    const fold = discountRate / 10;
    return `打 ${Number.isInteger(fold) ? fold : fold.toFixed(1)} 折`;
  }

  if (type === 'reduce') {
    const threshold =
      typeof params.threshold === 'number' ? params.threshold : undefined;
    const reduceAmount =
      typeof params.reduceAmount === 'number' ? params.reduceAmount : undefined;
    if (threshold === undefined || reduceAmount === undefined) return '';
    return `满 ¥${threshold} 减 ¥${reduceAmount}`;
  }

  if (type === 'recharge_gift') {
    const gradients = Array.isArray(params.gradients)
      ? params.gradients
      : undefined;
    const firstGradient = gradients?.[0];
    if (!firstGradient || typeof firstGradient !== 'object') {
      return '多档储值赠送';
    }
    const gradient = firstGradient as Record<string, unknown>;
    const rechargeAmount =
      typeof gradient.rechargeAmount === 'number'
        ? gradient.rechargeAmount
        : undefined;
    if (rechargeAmount === undefined) return '多档储值赠送';

    // giftAmount 优先，fallback 到 giftRatio 推导
    // 所有金额运算走 Money 体系，禁止裸 number 乘法
    let giftAmountYuan: number;
    if (typeof gradient.giftAmount === 'number' && gradient.giftAmount > 0) {
      giftAmountYuan = gradient.giftAmount as number;
    } else if (
      typeof gradient.giftRatio === 'number' &&
      gradient.giftRatio > 0
    ) {
      giftAmountYuan = Money.fromInputYuan(rechargeAmount)
        .multiply(gradient.giftRatio as number)
        .toOutputYuan();
    } else {
      giftAmountYuan = 0;
    }

    const baseText = `充 ¥${rechargeAmount} 赠 ¥${giftAmountYuan}`;
    return gradients!.length > 1 ? `${baseText} 起` : baseText;
  }

  if (type === 'free') return '免单';

  if (type === 'first_order_discount') {
    const discountRate =
      typeof params.discountRate === 'number'
        ? params.discountRate
        : typeof params.rate === 'number'
          ? Math.round(params.rate * 100)
          : undefined;
    if (discountRate === undefined) return '';
    const fold = discountRate / 10;
    return `首单 ${Number.isInteger(fold) ? fold : fold.toFixed(1)} 折`;
  }

  if (type === 'points_recharge') {
    const rechargeRatioPercent =
      typeof params.rechargeRatioPercent === 'number'
        ? params.rechargeRatioPercent
        : typeof params.pointsRatio === 'number'
          ? (params.pointsRatio as number)
          : undefined;
    if (rechargeRatioPercent === undefined) return '';
    const pts = Number.isInteger(rechargeRatioPercent)
      ? rechargeRatioPercent
      : Number(rechargeRatioPercent.toFixed(2));
    return `充 ¥100 赠 ${pts} 积分`;
  }

  if (type === 'points_2x') return '双倍积分';

  return '';
}

export function mapCustomerRow(
  row: MarketingCustomerRow,
): MarketingCustomerDto {
  return {
    id: String(row.id),
    name: row.name,
    phone: normalizePhone(row.phone) ?? '',
    avatar: toOptionalMediaText(row.avatar) ?? undefined,
    tier: safeEnumCoerce(
      row.tier as string,
      MARKETING_CUSTOMER_TIER_VALUES,
      'regular' as MarketingCustomerTierValue,
    ),
    balance: Money.fromDbCents(row.balance).toOutputYuan(),
    points: row.points,
    totalSpent: Money.fromDbCents(row.totalSpent).toOutputYuan(),
    visitCount: row.visitCount,
    registeredAt: row.createdAt.getTime(),
    lastVisitAt: row.lastVisitAt ? row.lastVisitAt.getTime() : null,
    status: calcCustomerStatus(row.lastVisitAt),
    remark: row.remark ?? undefined,
  };
}

export function mapRechargeRow(
  row: MarketingRechargeRow,
): MarketingRechargeDto {
  const amount = Money.fromDbCents(row.amount).toOutputYuan();
  const giftAmount = Money.fromDbCents(row.giftAmount).toOutputYuan();
  const totalAmount = Money.fromDbCents(row.totalAmount).toOutputYuan();
  const isRefund = (row.type as string) === 'refund';
  return {
    id: String(row.id),
    customerId: String(row.customerId),
    customerName: row.customerName,
    amount,
    giftAmount,
    totalAmount,
    signedAmount: isRefund ? -amount : amount,
    signedTotalAmount: isRefund ? -totalAmount : totalAmount,
    type: safeEnumCoerce(
      row.type as string,
      MARKETING_RECHARGE_TYPE_VALUES,
      'recharge' as MarketingRechargeTypeValue,
    ),
    promotionId: row.promotionId ? String(row.promotionId) : undefined,
    promotionName: row.promotionName ?? undefined,
    note: row.note ?? undefined,
    createdAt: row.createdAt.getTime(),
  };
}

export function mapConsumptionRow(
  row: MarketingConsumptionRow,
): MarketingConsumptionDto {
  return {
    id: String(row.id),
    customerId: String(row.customerId),
    amount: Money.fromDbCents(row.amount).toOutputYuan(),
    balancePaid: Money.fromDbCents(row.balancePaid).toOutputYuan(),
    pointsDeducted: Money.fromDbCents(row.pointsDeducted).toOutputYuan(),
    actualPointsDeducted: row.actualPointsDeducted,
    payType: safeEnumCoerce(
      row.payType as string,
      MARKETING_PAY_TYPE_VALUES,
      'cash' as MarketingPayTypeValue,
    ),
    itemsSummary: row.itemsSummary ?? undefined,
    promotionId: row.promotionId ? String(row.promotionId) : undefined,
    promotionName: row.promotionName ?? undefined,
    createdAt: row.createdAt.getTime(),
  };
}

export function mapPointsRecordRow(
  row: MarketingPointsRecordRow,
): MarketingPointsRecordDto {
  return {
    id: String(row.id),
    customerId: String(row.customerId),
    amount: row.amount,
    type: safeEnumCoerce(
      row.type as string,
      MARKETING_POINTS_CHANGE_TYPE_VALUES,
      'earn' as MarketingPointsChangeTypeValue,
    ),
    description: row.description,
    createdAt: row.createdAt.getTime(),
  };
}

export function buildPointsSpendDescription(
  itemsSummary?: string | null,
): string {
  const normalizedSummary = itemsSummary?.trim();
  if (normalizedSummary) {
    return `消费抵扣：${normalizedSummary}`;
  }
  return '消费抵扣积分';
}

export function mapPromotionRow(
  row: MarketingPromotionRow,
): MarketingPromotionDto {
  const params = normalizePromotionParams(row.params, row.type);
  // DB 存储（分）→ 前端输出（元）
  const outputParams = mapPromotionParamsForOutput(params, row.type);
  return {
    id: String(row.id),
    name: row.name,
    type: row.type as MarketingPromotionTypeValue,
    description: row.description,
    params: outputParams,
    displayText: buildPromotionDisplayText(row.type, outputParams) || undefined,
    startAt: row.startAt.getTime(),
    endAt: row.endAt.getTime(),
    usageCount: row.usageCount,
    totalDiscount: Money.fromDbCents(row.totalDiscount).toOutputYuan(),
    enabled: row.enabled,
    status: calcPromotionStatus(row.startAt, row.endAt),
    createdAt: row.createdAt.getTime(),
  };
}

export function mapProductCategoryRow(
  row: MarketingProductCategoryRow,
): MarketingProductCategoryDto {
  return {
    id: String(row.id),
    name: row.name,
    icon: toOptionalText(row.icon) ?? undefined,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

export function mapProductRow(row: MarketingProductRow): MarketingProductDto {
  return {
    id: String(row.id),
    name: row.name,
    categoryId: String(row.categoryId),
    categoryName: row.categoryName,
    price: Money.fromDbCents(row.price).toOutputYuan(),
    originalPrice:
      row.originalPrice !== null && row.originalPrice !== undefined
        ? Money.fromDbCents(row.originalPrice).toOutputYuan()
        : undefined,
    image: toOptionalMediaText(row.image) ?? undefined,
    descriptionTitle: toOptionalText(row.descriptionTitle) ?? undefined,
    description: toOptionalText(row.description) ?? undefined,
    stock: row.stock,
    durationMinutes: row.durationMinutes ?? undefined,
    personCount: row.personCount ?? undefined,
    unit: row.unit ?? undefined,
    type: row.type,
    validDays: row.validDays ?? undefined,
    billingMode: row.billingMode ?? 'items',
    hourlyRate:
      row.hourlyRate !== null && row.hourlyRate !== undefined
        ? Money.fromDbCents(row.hourlyRate).toOutputYuan()
        : undefined,
    countdownMinutes: row.countdownMinutes ?? undefined,
    countdownPrice:
      row.countdownPrice !== null && row.countdownPrice !== undefined
        ? Money.fromDbCents(row.countdownPrice).toOutputYuan()
        : undefined,
    autoCheckout: row.autoCheckout ?? false,
    isActive: row.isActive,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

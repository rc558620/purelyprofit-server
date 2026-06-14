import {
  toOptionalMediaText,
  toOptionalText,
} from '../commerce/commerce.utils';
import type {
  MarketingConsumptionDto,
  MarketingCustomerDto,
  MarketingOverviewDto,
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
  MarketingOverviewMonthlyTrendPoint,
  MarketingOverviewTrendPoint,
  MarketingPointsRecordRow,
  MarketingProductCategoryRow,
  MarketingProductRow,
  MarketingPromotionRow,
  MarketingRechargeRow,
} from './marketing.types';
import {
  calcCustomerStatus,
  calcPromotionStatus,
  maskPhone,
  type MarketingPayTypeValue,
  type MarketingPointsChangeTypeValue,
  type MarketingPromotionParamsValue,
  type MarketingPromotionParamValue,
  type MarketingPromotionTypeValue,
  type MarketingRechargeTypeValue,
} from './marketing.utils';

const OVERVIEW_MONTH_LABELS = Array.from(
  { length: 12 },
  (_, index) => `${index + 1}月`,
);

export function mapCustomerRow(
  row: MarketingCustomerRow,
): MarketingCustomerDto {
  return {
    id: String(row.id),
    name: row.name,
    phone: maskPhone(row.phone),
    avatar: toOptionalMediaText(row.avatar) ?? undefined,
    tier: row.tier,
    balance: row.balance,
    points: row.points,
    totalSpent: row.totalSpent,
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
  return {
    id: String(row.id),
    customerId: String(row.customerId),
    customerName: row.customerName,
    amount: row.amount,
    giftAmount: row.giftAmount,
    type: row.type as MarketingRechargeTypeValue,
    promotionId: row.promotionId ? String(row.promotionId) : undefined,
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
    amount: row.amount,
    balancePaid: row.balancePaid,
    pointsDeducted: row.pointsDeducted,
    payType: row.payType as MarketingPayTypeValue,
    itemsSummary: row.itemsSummary ?? undefined,
    promotionId: row.promotionId ? String(row.promotionId) : undefined,
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
    type: row.type as MarketingPointsChangeTypeValue,
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

function normalizePromotionParamValue(
  value: unknown,
): MarketingPromotionParamValue | undefined {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    const normalizedItems = value
      .map((item) => normalizePromotionParamValue(item))
      .filter(
        (item): item is MarketingPromotionParamValue => item !== undefined,
      );
    return normalizedItems;
  }

  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const normalizedEntries = Object.entries(value)
    .map(([key, entryValue]) => {
      const normalizedValue = normalizePromotionParamValue(entryValue);
      return normalizedValue === undefined ? null : [key, normalizedValue];
    })
    .filter(
      (entry): entry is [string, MarketingPromotionParamValue] =>
        entry !== null,
    );

  return Object.fromEntries(normalizedEntries);
}

function normalizeRechargeGiftParams(
  value: MarketingPromotionParamsValue,
): MarketingPromotionParamsValue {
  const gradientsSource =
    (Array.isArray(value.gradients) ? value.gradients : undefined) ??
    (Array.isArray(value.tiers) ? value.tiers : undefined);

  if (gradientsSource) {
    const gradients = gradientsSource
      .map((gradient) => normalizePromotionParamValue(gradient))
      .filter(
        (gradient): gradient is MarketingPromotionParamValue =>
          gradient !== undefined,
      );

    const { tiers: _tiers, gradients: _gradients, ...rest } = value;
    return {
      ...rest,
      gradients,
    };
  }

  const rechargeAmount =
    typeof value.rechargeAmount === 'number'
      ? value.rechargeAmount
      : typeof value.threshold === 'number'
        ? value.threshold
        : undefined;

  const giftAmount =
    typeof value.giftAmount === 'number' ? value.giftAmount : undefined;
  const giftRatio =
    typeof value.giftRatio === 'number' ? value.giftRatio : undefined;

  if (
    typeof rechargeAmount === 'number' &&
    (typeof giftAmount === 'number' || typeof giftRatio === 'number')
  ) {
    return {
      gradients: [
        {
          rechargeAmount,
          ...(typeof giftAmount === 'number' ? { giftAmount } : {}),
          ...(typeof giftRatio === 'number' ? { giftRatio } : {}),
        },
      ],
    };
  }

  return value;
}

export function normalizePromotionParams(
  value: unknown,
  type?: string,
): MarketingPromotionParamsValue {
  const normalizedValue = normalizePromotionParamValue(value);
  if (
    !normalizedValue ||
    Array.isArray(normalizedValue) ||
    typeof normalizedValue !== 'object'
  ) {
    return {};
  }

  const objectValue = normalizedValue as MarketingPromotionParamsValue;

  if (type === 'recharge_gift') {
    return normalizeRechargeGiftParams(objectValue);
  }

  return objectValue;
}

export function mapPromotionRow(
  row: MarketingPromotionRow,
): MarketingPromotionDto {
  return {
    id: String(row.id),
    name: row.name,
    type: row.type as MarketingPromotionTypeValue,
    description: row.description,
    params: normalizePromotionParams(row.params, row.type),
    startAt: row.startAt.getTime(),
    endAt: row.endAt.getTime(),
    usageCount: row.usageCount,
    totalDiscount: row.totalDiscount,
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
    price: row.price,
    originalPrice: row.originalPrice ?? undefined,
    image: toOptionalMediaText(row.image) ?? undefined,
    descriptionTitle: toOptionalText(row.descriptionTitle) ?? undefined,
    description: toOptionalText(row.description) ?? undefined,
    stock: row.stock,
    durationMinutes: row.durationMinutes ?? undefined,
    personCount: row.personCount ?? undefined,
    isActive: row.isActive,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

export function buildOverviewLast30Days(
  dailyTotals: Array<{ date: Date; amount: number }>,
): MarketingOverviewTrendPoint[] {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const rangeStart = new Date(todayStart.getTime() - 29 * 86400_000);

  const buckets = Array.from({ length: 30 }, (_, index) => {
    const date = new Date(rangeStart.getTime() + index * 86400_000);
    return {
      date: `${date.getMonth() + 1}/${date.getDate()}`,
      amount: 0,
    } satisfies MarketingOverviewTrendPoint;
  });

  const dailyMap = new Map<number, number>();
  for (const row of dailyTotals) {
    const dayTs = new Date(row.date);
    dayTs.setHours(0, 0, 0, 0);
    dailyMap.set(dayTs.getTime(), row.amount);
  }

  for (let i = 0; i < buckets.length; i++) {
    const dayStart = rangeStart.getTime() + i * 86400_000;
    buckets[i].amount = dailyMap.get(dayStart) ?? 0;
  }

  return buckets;
}

export function buildOverviewMonthlyTrend(
  monthlyTotals: Array<{ year: number; month: number; amount: number }>,
  year: number,
): MarketingOverviewMonthlyTrendPoint[] {
  const monthly = OVERVIEW_MONTH_LABELS.map((label) => ({
    label,
    amount: null as number | null,
  }));

  for (const row of monthlyTotals) {
    if (row.year !== year) {
      continue;
    }
    monthly[row.month].amount = row.amount;
  }

  return monthly;
}

export function buildEmptyMarketingOverview(): MarketingOverviewDto {
  const currentYear = new Date().getFullYear();

  return {
    totalBalance: 0,
    totalRecharge: 0,
    todayRecharge: 0,
    thisMonthRecharge: 0,
    rechargeCount: 0,
    activeMemberCount: 0,
    inviteCode: '',
    inviteCodeQrCodeImageUrl: '',
    last30Days: buildOverviewLast30Days([]),
    currentYear,
    thisYearMonthlyTrend: buildOverviewMonthlyTrend([], currentYear),
    lastYearMonthlyTrend: buildOverviewMonthlyTrend([], currentYear - 1),
    wechatPayConfig: { configured: false },
  };
}

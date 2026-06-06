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
  calcRechargeTotal,
  maskPhone,
  type MarketingPayTypeValue,
  type MarketingPointsChangeTypeValue,
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

export function normalizePromotionParams(
  value: unknown,
): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const entries = Object.entries(value).filter(
    (entry): entry is [string, number] => typeof entry[1] === 'number',
  );

  return Object.fromEntries(entries);
}

export function mapPromotionRow(
  row: MarketingPromotionRow,
): MarketingPromotionDto {
  return {
    id: String(row.id),
    name: row.name,
    type: row.type as MarketingPromotionTypeValue,
    description: row.description,
    params: normalizePromotionParams(row.params),
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
    description: toOptionalText(row.description) ?? undefined,
    durationMinutes: row.durationMinutes ?? undefined,
    personCount: row.personCount ?? undefined,
    isActive: row.isActive,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

export function buildOverviewLast30Days(
  rechargeRows: Array<{ createdAt: Date; amount: number; giftAmount: number }>,
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

  for (const row of rechargeRows) {
    const createdAt = new Date(row.createdAt);
    createdAt.setHours(0, 0, 0, 0);
    const bucketIndex = Math.floor(
      (createdAt.getTime() - rangeStart.getTime()) / 86400_000,
    );
    if (bucketIndex >= 0 && bucketIndex < buckets.length) {
      buckets[bucketIndex].amount += calcRechargeTotal(
        row.amount,
        row.giftAmount,
      );
    }
  }

  return buckets;
}

export function buildOverviewMonthlyTrend(
  rechargeRows: Array<{ createdAt: Date; amount: number; giftAmount: number }>,
  year: number,
): MarketingOverviewMonthlyTrendPoint[] {
  const monthly = OVERVIEW_MONTH_LABELS.map((label) => ({
    label,
    amount: null as number | null,
  }));

  for (const row of rechargeRows) {
    const createdAt = new Date(row.createdAt);
    if (createdAt.getFullYear() !== year) {
      continue;
    }

    const monthIndex = createdAt.getMonth();
    monthly[monthIndex].amount =
      (monthly[monthIndex].amount ?? 0) +
      calcRechargeTotal(row.amount, row.giftAmount);
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
    last30Days: buildOverviewLast30Days([]),
    currentYear,
    thisYearMonthlyTrend: buildOverviewMonthlyTrend([], currentYear),
    lastYearMonthlyTrend: buildOverviewMonthlyTrend([], currentYear - 1),
  };
}

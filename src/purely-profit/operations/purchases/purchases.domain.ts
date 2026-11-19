import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  buildPreviousPurchaseDateRange,
  buildPurchaseDateRange,
  type PurchasePeriodValue,
  toOptionalText,
} from '../../commerce/commerce.utils';
import {
  Money,
  calcPercentChangeWithFallback,
} from '../../../shared/money.utils';
import type {
  PreparedPurchaseItem,
  PurchaseCreateItemInput,
  PurchaseListQuery,
  PurchaseProductRecord,
  PurchaseStatsQuery,
} from './purchases.types';

/**
 * 单笔进货金额上限（分）：金额列为 Postgres Int（上限 2,147,483,647 分）。
 * 与数据库列宽保持一致，超出即业务错误，避免落库时抛 SQL 异常变成 500。
 */
const MAX_PURCHASE_AMOUNT_CENTS = 2_147_483_647;

export function buildPurchaseListWhere(
  storeId: number,
  query: PurchaseListQuery,
): Prisma.PurchaseOrderWhereInput {
  assertPurchaseDateRangeParams(query);

  const dateRange = buildPurchaseDateRange(
    query.period,
    query.customDate,
    query.rangeStartDate,
    query.rangeEndDate,
  );

  return {
    storeId,
    ...(dateRange ? { date: dateRange } : {}),
  };
}

export function resolvePurchaseStatsRanges(
  storeId: number,
  query: PurchaseStatsQuery,
): {
  currentWhere: Prisma.PurchaseOrderWhereInput;
  previousRange?: { gte: Date; lte: Date };
} {
  assertPurchaseDateRangeParams(query);

  const currentRange = buildPurchaseDateRange(
    query.period,
    query.customDate,
    query.rangeStartDate,
    query.rangeEndDate,
  );

  return {
    currentWhere: {
      storeId,
      ...(currentRange ? { date: currentRange } : {}),
    },
    previousRange: buildPreviousPurchaseDateRange(currentRange, query.period),
  };
}

export function normalizePurchaseSupplierName(
  supplierName?: string,
): string | null {
  return toOptionalText(supplierName) ?? null;
}

/**
 * 校验时间周期与配套日期参数的一致性。
 *
 * `buildPurchaseDateRange` 在 `custom_month` 缺 `customDate`、
 * 或 `custom_range` 缺 `rangeStartDate`/`rangeEndDate` 时会返回 `undefined`，
 * 导致上层不加任何日期过滤、静默返回全量数据。此处显式拦截，
 * 避免“筛选参数不完整却返回全部进货单/全量统计”的隐患。
 */
function assertPurchaseDateRangeParams(query: {
  period?: PurchasePeriodValue;
  customDate?: number;
  rangeStartDate?: number;
  rangeEndDate?: number;
}): void {
  if (query.period === 'custom_month' && query.customDate === undefined) {
    throw new BadRequestException('自定义月份周期需提供 customDate');
  }

  if (query.period === 'custom_range') {
    if (
      query.rangeStartDate === undefined ||
      query.rangeEndDate === undefined
    ) {
      throw new BadRequestException(
        '自定义区间周期需提供 rangeStartDate 与 rangeEndDate',
      );
    }
  }
}

export function normalizePurchaseNote(note?: string): string | null {
  return toOptionalText(note) ?? null;
}

export function assertPurchaseSupplierInput(
  supplierId: number | undefined,
  supplierName: string | null,
): void {
  if (supplierId === undefined && !supplierName) {
    throw new BadRequestException('请选择供应商或填写供应商名称');
  }
}

export function extractUniqueProductIds(
  items: PurchaseCreateItemInput[],
): number[] {
  const productIds = items
    .map((item) => item.productId)
    .filter((productId): productId is number => productId !== undefined);
  const uniqueProductIds = Array.from(new Set(productIds));

  if (uniqueProductIds.length !== productIds.length) {
    throw new ConflictException('同一商品请合并成一条进货明细');
  }

  return uniqueProductIds;
}

export function createPurchaseProductMap(
  products: PurchaseProductRecord[],
  expectedProductIds: number[],
): Map<number, PurchaseProductRecord> {
  const productMap = new Map<number, PurchaseProductRecord>(
    products.map((item) => [item.id, item]),
  );

  if (productMap.size !== expectedProductIds.length) {
    throw new NotFoundException('存在无效商品');
  }

  return productMap;
}

export function preparePurchaseItems(
  items: PurchaseCreateItemInput[],
  productMap: Map<number, PurchaseProductRecord>,
): PreparedPurchaseItem[] {
  return items.map((item) => preparePurchaseItem(item, productMap));
}

export function sumPreparedPurchaseAmount(
  items: PreparedPurchaseItem[],
): number {
  // items.amount 已经是分（Int），统一走 Money.sum 语义
  const totalAmount = Money.sum(
    items.map((item) => Money.fromDbCents(item.amount)),
  ).toDbCents();

  if (totalAmount > MAX_PURCHASE_AMOUNT_CENTS) {
    throw new BadRequestException('进货单总金额超出系统上限，请拆分录入');
  }

  return totalAmount;
}

export function previewPurchaseAmounts(
  items: PurchaseCreateItemInput[],
  productMap: Map<number, PurchaseProductRecord>,
): { items: PreparedPurchaseItem[]; totalAmount: number } {
  const preparedItems = preparePurchaseItems(items, productMap);
  const totalAmount = sumPreparedPurchaseAmount(preparedItems);
  return { items: preparedItems, totalAmount };
}

export function buildPurchaseCostTitle(supplierName?: string | null): string {
  return supplierName ? `${supplierName}进货成本` : '进货成本';
}

export function calculatePurchaseCompareLastPeriod(
  currentTotal: number,
  previousTotal: number,
  hasPreviousRange: boolean,
): number | null {
  if (!hasPreviousRange) {
    return null;
  }

  return calcPercentChangeWithFallback(currentTotal, previousTotal, {
    fallback: null,
    precision: 1,
  });
}

function preparePurchaseItem(
  item: PurchaseCreateItemInput,
  productMap: Map<number, PurchaseProductRecord>,
): PreparedPurchaseItem {
  const product =
    item.productId !== undefined ? productMap.get(item.productId) : undefined;

  if (item.productId !== undefined && !product) {
    throw new NotFoundException('存在无效商品');
  }
  if (!Number.isFinite(item.unitPrice) || item.unitPrice <= 0) {
    throw new BadRequestException('进货单价必须大于 0');
  }

  const productName = toOptionalText(item.productName) ?? product?.name;
  if (!productName) {
    throw new BadRequestException('无码商品必须填写商品名称');
  }

  const requestedUnit = toOptionalText(item.unit);
  assertPurchaseUnitMatchesProduct(requestedUnit, product);

  const unitPriceCents = Money.fromInputYuan(item.unitPrice).toDbCents();
  const amountCents = Money.fromInputYuan(item.unitPrice)
    .multiply(item.quantity)
    .toDbCents();

  // 金额列为数据库 Int：超过 21,474,836.47 元会写库失败，提前以业务错误拦截
  if (amountCents > MAX_PURCHASE_AMOUNT_CENTS) {
    throw new BadRequestException(`商品【${productName}】的进货金额超出系统上限`);
  }

  return {
    productId: product?.id ?? null,
    productName,
    unit: requestedUnit ?? product?.unit ?? null,
    quantity: item.quantity,
    unitPrice: unitPriceCents,
    amount: amountCents,
  };
}

/**
 * 已关联商品的单据单位必须与商品库存单位一致。
 *
 * 入库只按明细 quantity 累加，不做单位换算：允许「商品单位=瓶、单据单位=箱」会让
 * 一张 6 箱的单据只入库 6 瓶，且账面口径无法回溯。无码商品没有库存单位，不校验。
 */
function assertPurchaseUnitMatchesProduct(
  requestedUnit: string | undefined,
  product: PurchaseProductRecord | undefined,
): void {
  if (!product || !requestedUnit || requestedUnit === product.unit) {
    return;
  }

  throw new BadRequestException(
    `商品【${product.name}】的库存单位是「${product.unit}」，单据单位「${requestedUnit}」不一致，请按库存单位录入`,
  );
}

// 销售记录增强：
// 1. 扫码点餐订单 —— 规格行 + 优惠前单价 + 金额汇总（对齐 scan-ordering 详情）；
// 2. 空间会话结账订单 —— 仅规格行（自助下单 / 追加点单的规格展示）。
import {
  fenToYuan,
  pointsDeductAmountFen,
  toDiscountItems,
} from '../../../purely-club/scan-ordering/club-scan-ordering-order.mapper';
import type { ScanOrderingAmountSummaryDto } from './dto/sales-record-response.dto';
import type { SaleOrderWithItems } from './sales-record.domain';
import type { SalesRecordSpecsEnrichment } from './sales-record-item-aggregation';

/** 销售记录关联的扫码点餐订单最小查询形态（金额均为分）。 */
export interface ScanOrderingDetailSource {
  id: number;
  marketingSnapshot: unknown;
  itemOriginalAmount: number;
  specificationExtraAmount: number;
  payableAmount: number;
  items: Array<{
    productNameSnapshot: string;
    quantity: number;
    lineTotalAmount: number;
    payableLineAmount: number;
    specs: Array<{ specOptionNameSnapshot: string }>;
  }>;
}

/** 扫码点餐订单增强结果：规格行（与可见商品行一一对应）+ 原价单价（元）+ 金额汇总（元）。 */
export interface ScanOrderingEnrichment {
  specsRows: string[][];
  originalUnitPrices: number[];
  amountSummary: ScanOrderingAmountSummaryDto;
}

/**
 * 组装扫码点餐订单增强数据：
 * 1. 规格行与原价单价按 bridge 展开顺序与销售商品行一一对应（scanOrderItem 按数量展开为 unit）；
 * 2. 原价单价 = 未扣优惠的原价小计（lineTotalAmount）按数量分摊，余数补到最后一件，总和守恒；
 * 3. 金额汇总以分转元输出，总优惠额由后端计算，前端只读展示。
 */
export function buildScanOrderingEnrichment(
  order: SaleOrderWithItems,
  scan: ScanOrderingDetailSource,
): ScanOrderingEnrichment {
  const unitRows = buildScanOrderingUnitRows(scan.items);
  return {
    specsRows: buildSpecsRows(order.items, unitRows),
    originalUnitPrices: buildOriginalUnitPrices(order.items, unitRows),
    amountSummary: buildScanOrderingAmountSummary(scan),
  };
}

/** 扫码订单商品按数量展开的 unit 序列（规格 + 原价分摊单价，分）。 */
interface ScanOrderingUnit {
  specs: string[];
  originalUnitPriceFen: number;
}

/** 将扫码订单商品行按数量展开为 unit，原价小计分摊到每件（余数补到最后一件）。 */
function buildScanOrderingUnitRows(
  scanItems: ScanOrderingDetailSource['items'],
): ScanOrderingUnit[] {
  const units: ScanOrderingUnit[] = [];
  for (const item of scanItems) {
    const specs = (item.specs ?? []).map((spec) => spec.specOptionNameSnapshot);
    const quantity = Math.max(item.quantity, 0);
    const originalTotalFen = item.lineTotalAmount ?? 0;
    const unitPriceFen =
      quantity > 0 ? Math.floor(originalTotalFen / quantity) : 0;
    const remainder = quantity > 0 ? originalTotalFen % quantity : 0;
    for (let index = 0; index < quantity; index += 1) {
      units.push({
        specs,
        originalUnitPriceFen: unitPriceFen + (index < remainder ? 1 : 0),
      });
    }
  }
  return units;
}

/** 规格游标匹配：unit 序列与销售商品行一一对应，数量不一致时回退空规格。 */
function buildSpecsRows(
  saleItems: SaleOrderWithItems['items'],
  units: ScanOrderingUnit[],
): string[][] {
  if (units.length !== saleItems.length) {
    return saleItems.map(() => []);
  }
  return units.map((unit) => unit.specs);
}

/** 原价单价（分→元）：unit 序列与销售商品行一一对应，数量不一致时回退 0。 */
function buildOriginalUnitPrices(
  saleItems: SaleOrderWithItems['items'],
  units: ScanOrderingUnit[],
): number[] {
  if (units.length !== saleItems.length) {
    return saleItems.map(() => 0);
  }
  return units.map((unit) => fenToYuan(unit.originalUnitPriceFen));
}

/** 组装扫码点餐金额汇总（元）：优惠清单复用 club 营销快照解析，总优惠由后端计算。 */
function buildScanOrderingAmountSummary(
  scan: ScanOrderingDetailSource,
): ScanOrderingAmountSummaryDto {
  const itemOriginalAmount = fenToYuan(scan.itemOriginalAmount ?? 0);
  const specificationExtraAmount = fenToYuan(
    scan.specificationExtraAmount ?? 0,
  );
  const payableAmount = fenToYuan(scan.payableAmount ?? 0);
  // 优惠前总价 = 商品基础价 + 规格加价（分单位相加避免浮点误差），未扣任何优惠
  const totalBeforeDiscount = fenToYuan(
    (scan.itemOriginalAmount ?? 0) + (scan.specificationExtraAmount ?? 0),
  );
  const discountAmount = Math.max(
    itemOriginalAmount + specificationExtraAmount - payableAmount,
    0,
  );
  return {
    itemOriginalAmount,
    specificationExtraAmount,
    totalBeforeDiscount,
    payableAmount,
    discountAmount,
    pointsDeductAmount: fenToYuan(
      pointsDeductAmountFen(scan.marketingSnapshot),
    ),
    discountItems: toDiscountItems(scan.marketingSnapshot),
  };
}

/** 销售记录关联的空间会话最小查询形态（规格为行级 JSON）。 */
export interface SpaceSessionSpecSource {
  id: number;
  saleOrderId: number | null;
  sessionItems: Array<{
    productName: string;
    quantity: number;
    specNames: unknown;
  }>;
}

/**
 * 组装空间会话结账订单的规格增强：
 * 空间结账的 saleOrderItem 由 sessionItems 按顺序复制（**行级对应**，不按数量展开），
 * 因此规格行按行索引一一对应；长度不一致（防御性回退）时输出空规格。
 */
export function buildSpaceSessionSpecsEnrichment(
  order: SaleOrderWithItems,
  session: SpaceSessionSpecSource,
): SalesRecordSpecsEnrichment {
  const sessionItems = session.sessionItems;
  const specsRows =
    sessionItems.length === order.items.length
      ? order.items.map((_, index) => {
          const names = sessionItems[index]?.specNames;
          return Array.isArray(names)
            ? names.filter((name): name is string => typeof name === 'string')
            : [];
        })
      : order.items.map(() => []);
  return { specsRows };
}

// 台位费展示名（列表 / 报表 / CSV 共用），从 sales-record.domain 抽出，保持口径唯一。
import {
  TABLE_FEE_NAME_RE,
  toOptionalText,
} from '../../commerce/commerce.utils';
import type { SalesReportOrder } from './sales-record-report.query';

function shouldPrefixReportSpaceName(productName: string): boolean {
  return TABLE_FEE_NAME_RE.test(productName);
}

/**
 * 台位费商品拼接空间名称前缀（空格分隔）：列表、报表、CSV 共用的唯一拼接来源。
 * 非台位费商品或缺失空间名时原样返回。
 */
export function prefixSpaceName(
  spaceName: string | null | undefined,
  productName: string,
): string {
  if (!spaceName || !shouldPrefixReportSpaceName(productName)) {
    return productName;
  }
  return `${spaceName} ${productName}`;
}

/** 台位费商品展示名：从订单空间会话取空间名并拼接前缀（报表/CSV 复用）。 */
export function resolveReportProductName(
  order: SalesReportOrder,
  item: SalesReportOrder['items'][number],
): string {
  return prefixSpaceName(
    toOptionalText(order.spaceSession?.space?.name),
    item.productName,
  );
}

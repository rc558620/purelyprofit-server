// 台位费展示名 / 结账操作员展示名（列表 / 报表 / CSV 共用），从 sales-record.domain 抽出，保持口径唯一。
import {
  TABLE_FEE_NAME_RE,
  toOptionalText,
} from '../../commerce/commerce.utils';
import { AUTO_SETTLEMENT_OPERATOR_NAME } from '../handover/handover.constants';
import type { SalesReportOrder } from './sales-record-report.query';

/** 结账操作员展示名所需的最小订单形态（列表与 CSV 查询形态都能直接传入）。 */
interface OperatorDisplaySource {
  operatorNameSnapshot?: string | null;
  spaceSession?: { autoCheckout?: boolean | null } | null;
}

/**
 * 结账操作员展示名（列表 / 打印 / CSV 同一口径）：
 *
 * 自动结账（会话 `autoCheckout=true`）统一由系统用户落单，
 * `operatorNameSnapshot` 必为空，这里兜底为「空间自动结账」，
 * 与交班页口径一致，避免列表 / 打印 / CSV 三处分别出现空白与短横线。
 * 普通订单取员工姓名快照；无档案时返回 undefined 由调用方决定占位符。
 */
export function resolveOperatorDisplayName(
  order: OperatorDisplaySource,
): string | undefined {
  const snapshot = toOptionalText(order.operatorNameSnapshot);
  if (snapshot) return snapshot;
  return order.spaceSession?.autoCheckout === true
    ? AUTO_SETTLEMENT_OPERATOR_NAME
    : undefined;
}

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

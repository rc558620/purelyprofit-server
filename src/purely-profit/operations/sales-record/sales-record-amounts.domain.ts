import { Money } from '../../../shared/money.utils';
import type { PreparedSalesItem } from './sales-record-item-preparation.service';

/**
 * 销售记录金额聚合结果（单一权威来源）
 * 所有金额相关计算都必须通过此域对象产出
 */
export interface SalesRecordAmountsSnapshot {
  /** 商品明细行及其衍生金额 */
  items: Array<{
    salePrice: number;
    profit: number;
    quantity: number;
    /** 商品小计 = salePrice × quantity */
    subtotal: number;
    /** 单件利润小计 = profit × quantity */
    profitSubtotal: number;
  }>;
  /** 总营业额 = sum(subtotal) */
  totalRevenue: number;
  /** 总利润 = sum(profitSubtotal) */
  totalProfit: number;
  /** 总销售件数 = sum(quantity of non-deduction items) */
  totalQuantity: number;
}

/**
 * 销售记录金额聚合域服务
 * 唯一权威入口：所有 sales-record 金额计算都必须通过此服务
 */
export class SalesRecordAmountsDomain {
  /**
   * 从准备好的商品项聚合权威金额快照
   * @param preparedItems 经过验证和规范化的商品项
   * @param options.excludeDeductionItems 是否排除抵扣项（默认 true，用于销售统计）
   */
  static aggregateFromPreparedItems(
    preparedItems: PreparedSalesItem[],
    options: { excludeDeductionItems?: boolean } = {},
  ): SalesRecordAmountsSnapshot {
    const shouldExcludeDeductions = options.excludeDeductionItems !== false;

    let totalRevenue = Money.zero();
    let totalProfit = Money.zero();
    let totalQuantity = 0;

    const items = preparedItems.map((item) => {
      const subtotal = item.salePrice.multiply(item.quantity);
      const profitSubtotal = item.profit.multiply(item.quantity);

      // 金额聚合逻辑：
      // - 如果不排除抵扣项，所有项都计入
      // - 如果排除抵扣项，只有 countsTowardTotalQuantity=true 的项才计入
      const shouldIncludeInAmounts =
        !shouldExcludeDeductions || item.countsTowardTotalQuantity;
      if (shouldIncludeInAmounts) {
        totalRevenue = totalRevenue.add(subtotal);
        totalProfit = totalProfit.add(profitSubtotal);
      }

      // 件数只计算 countsTowardTotalQuantity=true 的项
      if (item.countsTowardTotalQuantity) {
        totalQuantity += item.quantity;
      }

      return {
        salePrice: item.salePrice.toOutputYuan(),
        profit: item.profit.toOutputYuan(),
        quantity: item.quantity,
        subtotal: subtotal.toOutputYuan(),
        profitSubtotal: profitSubtotal.toOutputYuan(),
      };
    });

    return {
      items,
      totalRevenue: totalRevenue.toOutputYuan(),
      totalProfit: totalProfit.toOutputYuan(),
      totalQuantity,
    };
  }

  /**
   * 校验金额快照中的金额一致性（用于测试和断言）
   */
  static assertConsistency(snapshot: SalesRecordAmountsSnapshot): void {
    // 验证 subtotal 汇总是否等于 totalRevenue
    const revenueSum = snapshot.items.reduce(
      (sum, item) => sum + item.subtotal,
      0,
    );
    const revenueRounded = Math.round(revenueSum * 100) / 100;
    const totalRevenueRounded = Math.round(snapshot.totalRevenue * 100) / 100;

    if (Math.abs(revenueRounded - totalRevenueRounded) > 0.01) {
      throw new Error(
        `销售额汇总不一致: sum(subtotal)=${revenueRounded}, totalRevenue=${totalRevenueRounded}`,
      );
    }

    // 验证 profitSubtotal 汇总是否等于 totalProfit
    const profitSum = snapshot.items.reduce(
      (sum, item) => sum + item.profitSubtotal,
      0,
    );
    const profitRounded = Math.round(profitSum * 100) / 100;
    const totalProfitRounded = Math.round(snapshot.totalProfit * 100) / 100;

    if (Math.abs(profitRounded - totalProfitRounded) > 0.01) {
      throw new Error(
        `利润汇总不一致: sum(profitSubtotal)=${profitRounded}, totalProfit=${totalProfitRounded}`,
      );
    }
  }
}

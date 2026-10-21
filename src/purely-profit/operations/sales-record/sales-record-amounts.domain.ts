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
      // - 如果排除抵扣项，只有计入金额的项才计入
      //
      // ⚠️ 金额纳入必须与件数纳入分开判定：台位费行不计件数（按时间计费，
      // 不是商品销量），但它是真实营收，必须计入营业额 / 利润。此前此处复用
      // countsTowardTotalQuantity，导致非餐饮门店的台位费订单金额被整单抹成 0，
      // 与统计卡 / 报表 / CSV 口径不一致。
      const countsTowardAmounts =
        item.countsTowardAmounts ?? item.countsTowardTotalQuantity;
      const shouldIncludeInAmounts =
        !shouldExcludeDeductions || countsTowardAmounts;
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
   * 团购券（纯利宝等平台券）空间订单的金额口径。
   *
   * 业务模型：顾客在小程序买券（原价 → 会员价 → 各类折扣 → 积分抵扣）后，
   * 券面金额 = 顾客实际掏的钱（ClubVoucherOrder.paidAmountFen，注释即"券面金额口径"），
   * 也就是门店最终能从平台结算到的钱；到店核销时券买断台位费/服务，
   * 台位费与券面之间的差额是门店营销让利，再向顾客收取属于重复收费。
   *
   * 因此这类订单不能按消费毛额记收入：
   *   营业额 = 券面金额 + 超时台位费 + 点单全额
   *   利润 = 券面金额 + 超时台位费 + 点单毛利
   *   实付 = 营业额
   *
   * ⚠️ 台位费部分（券抵 / 超时）无成本，利润即等于金额，故本方法不接收
   * tableFeeProfit 入参；点单部分仍按商品毛利（otherProfit）计。
   *
   * 超时：券程可抵台位费 = 券预设的 1 小时台位费（session.hourlyRate）/ 固定价；
   * 实际台位费超出部分由顾客到店另付，计入营业额与利润。
   */
  static resolveGrouponVoucherAmounts(input: {
    /** 券面金额（元）= 顾客买券实付 = 门店券结算收入 */
    voucherFaceAmount: number;
    /** 台位费行金额合计（元） */
    tableFeeRevenue: number;
    /** 非台位费、非抵扣行（点单）金额合计（元） */
    otherRevenue: number;
    /** 非台位费、非抵扣行利润合计（元） */
    otherProfit: number;
    /** 券程可抵台位费（元）；null 表示券全包（按实际台位费抵扣，无超时） */
    entitledTableFee?: number | null;
  }): {
    totalRevenue: number;
    totalProfit: number;
    /** 券实际抵扣部分 = min(券程内台位费, 券面)；券面大于消费时按消费计 */
    voucherCoveredRevenue: number;
    /** 超时台位费（由顾客到店另付） */
    overtimeRevenue: number;
  } {
    const face = Money.fromInputYuan(input.voucherFaceAmount);
    const tableFee = Money.fromInputYuan(input.tableFeeRevenue);
    const entitled =
      input.entitledTableFee == null
        ? tableFee
        : Money.fromInputYuan(input.entitledTableFee);
    const overtimeRaw = tableFee.subtract(entitled);
    const overtime = overtimeRaw.isPositive() ? overtimeRaw : Money.zero();
    const other = Money.fromInputYuan(input.otherRevenue);
    const otherProfit = Money.fromInputYuan(input.otherProfit);
    // 券实际抵扣 = min(券程内台位费, 券面)：券面大于本次台位费消费时按消费计，
    // 多付的券面在结账时退回顾客（产品口径：超额按退款处理），不计入本单营业额
    const covered = Money.min(
      tableFee.isPositive() ? Money.min(tableFee, entitled) : tableFee,
      face,
    );

    return {
      totalRevenue: covered.add(overtime).add(other).toOutputYuan(),
      totalProfit: covered.add(overtime).add(otherProfit).toOutputYuan(),
      voucherCoveredRevenue: covered.toOutputYuan(),
      overtimeRevenue: overtime.toOutputYuan(),
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

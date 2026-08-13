/**
 * 扫码点餐订单金额对外映射。
 *
 * 数据库订单金额统一以「分」存储；purelyClub 查询类接口统一以「元」输出。
 * 订单创建时已将优惠构成写入订单快照（productDiscountAmount /
 * orderDiscountAmount / marketingSnapshot.pointsDeductAmount），此处只负责在
 * 查询响应组装阶段计算 discountAmount，不新增数据库字段。
 */

/** 优惠清单明细行（前端只读展示） */
export interface OrderDiscountItem {
  /** 展示标签（如“会员等级折扣 8折”“满50减8”） */
  label: string;
  /** 金额（元）；负数表示减免 */
  amount: number;
  /** 被覆盖/失效优惠：true 时前端划掉展示（如活动胜出时会员等级折扣） */
  isStrikethrough: boolean;
}

/** 订单对外输出的金额字段（单位：元，最多两位小数） */
export interface OrderAmountSummary {
  itemOriginalAmount: number;
  specificationExtraAmount: number;
  productDiscountAmount: number;
  orderDiscountAmount: number;
  pointsDeductAmount: number;
  discountAmount: number;
  payableAmount: number;
  paidAmount: number;
  /** 优惠清单明细（由后端从营销快照组装，金额已换算为元） */
  discountItems: OrderDiscountItem[];
}

/** 计算优惠金额所需的最小订单字段集合 */
export interface OrderDiscountAmountSource {
  itemOriginalAmount?: number | null;
  specificationExtraAmount?: number | null;
  productDiscountAmount?: number | null;
  orderDiscountAmount?: number | null;
  marketingSnapshot?: unknown;
}

/** 将分为单位金额转换为元（输入缺失按 0，输出最多两位小数） */
export const fenToYuan = (cents: number | null | undefined): number =>
  Math.round(cents ?? 0) / 100;

/** 安全读取非负整数分：缺失、负数、非有限数一律按 0 处理 */
const toNonNegativeFen = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return value > 0 ? Math.round(value) : 0;
};

/**
 * 安全读取营销快照中的积分抵扣金额（分）。
 * marketingSnapshot 是 JSON 字段，历史数据可能缺失该字段或类型异常，
 * 必须做类型守卫，不能直接强制断言。
 * 导出供 purely-profit 商家端订单查询映射复用。
 */
export const pointsDeductAmountFen = (marketingSnapshot: unknown): number => {
  if (marketingSnapshot === null || typeof marketingSnapshot !== 'object') {
    return 0;
  }
  const snapshot = marketingSnapshot as { pointsDeductAmount?: unknown };
  return toNonNegativeFen(snapshot.pointsDeductAmount);
};

/**
 * 从营销快照提取优惠清单明细（前端只读展示，不做任何金额计算）。
 * 只保留减免项（amount < 0），label 原样透出，金额由后端换算为元。
 * 导出供 purely-profit 商家端订单查询映射复用。
 */
export const toDiscountItems = (
  marketingSnapshot: unknown,
): OrderDiscountItem[] => {
  if (marketingSnapshot === null || typeof marketingSnapshot !== 'object') {
    return [];
  }
  const snapshot = marketingSnapshot as { breakdownItems?: unknown };
  if (!Array.isArray(snapshot.breakdownItems)) return [];
  return snapshot.breakdownItems
    .filter(
      (
        item,
      ): item is {
        label?: unknown;
        amount?: unknown;
        isStrikethrough?: unknown;
      } => item !== null && typeof item === 'object',
    )
    .map((item) => ({
      label: typeof item.label === 'string' ? item.label : '',
      amount: fenToYuan(
        typeof item.amount === 'number' && Number.isFinite(item.amount)
          ? item.amount
          : 0,
      ),
      isStrikethrough: item.isStrikethrough === true,
    }))
    .filter((item) => item.label !== '' && item.amount < 0);
};

/**
 * 计算订单总优惠金额（分）。
 *
 * 主公式（减法）：discountAmount = 商品原价 + 规格加价 − 应付金额 − 服务费 − 税费。
 * 该口径覆盖所有"减小应付金额"的优惠来源：商品优惠、订单优惠、会员等级折扣、
 * 优惠券、积分抵扣等。会员等级折扣等部分优惠渠道未单独写入
 * productDiscountAmount / orderDiscountAmount 字段，但已体现在 payableAmount，
 * 因此减法公式能完整还原用户视角的总优惠额。
 *
 * 兜底公式（加法）：productDiscountAmount + orderDiscountAmount + pointsDeductAmount。
 * 仅在减法公式因 payableAmount 异常（如缺失、为负、超大）退化为 0 时启用，
 * 避免漏算已明确写入的优惠字段。
 *
 * 最终结果封顶为 商品原价 + 规格加价，且不小于 0。
 */
export const computeOrderDiscountAmountFen = (
  order: OrderDiscountAmountSource & {
    payableAmount?: number | null;
    serviceFeeAmount?: number | null;
    taxAmount?: number | null;
  },
): number => {
  const original =
    toNonNegativeFen(order.itemOriginalAmount) +
    toNonNegativeFen(order.specificationExtraAmount);
  if (original <= 0) return 0;
  const nonDiscountExtras =
    toNonNegativeFen(order.serviceFeeAmount) +
    toNonNegativeFen(order.taxAmount);
  const payableFen = order.payableAmount;
  // 减法公式仅在 payableAmount 有效（number 且 ≥ 0）时启用。
  // 缺失/无效数据下减法公式会退化为「原价满减」，反而漏算已明确写入的优惠。
  const payableIsValid =
    typeof payableFen === 'number' &&
    Number.isFinite(payableFen) &&
    payableFen >= 0;
  const subtractive = payableIsValid
    ? Math.max(original - payableFen - nonDiscountExtras, 0)
    : 0;
  const additive =
    toNonNegativeFen(order.productDiscountAmount) +
    toNonNegativeFen(order.orderDiscountAmount) +
    pointsDeductAmountFen(order.marketingSnapshot);
  const discount = Math.max(subtractive, additive);
  return Math.min(discount, original);
};

/**
 * 组装订单对外输出的金额字段（单位：元）。
 * 输入为订单数据库记录（金额均为分），输出供 purelyClub 各查询接口直接返回。
 */
export const toOrderAmountSummary = (
  order: OrderDiscountAmountSource & {
    payableAmount?: number | null;
    paidAmount?: number | null;
    serviceFeeAmount?: number | null;
    taxAmount?: number | null;
  },
): OrderAmountSummary => ({
  itemOriginalAmount: fenToYuan(order.itemOriginalAmount),
  specificationExtraAmount: fenToYuan(order.specificationExtraAmount),
  productDiscountAmount: fenToYuan(order.productDiscountAmount),
  orderDiscountAmount: fenToYuan(order.orderDiscountAmount),
  pointsDeductAmount: fenToYuan(pointsDeductAmountFen(order.marketingSnapshot)),
  discountAmount: fenToYuan(computeOrderDiscountAmountFen(order)),
  payableAmount: fenToYuan(order.payableAmount),
  paidAmount: fenToYuan(order.paidAmount),
  discountItems: toDiscountItems(order.marketingSnapshot),
});

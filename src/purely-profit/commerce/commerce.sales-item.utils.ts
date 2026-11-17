/**
 * 商品行的「抵扣 / 券面 / 台位费」识别与净额还原。
 *
 * 空间结账、续费、自助下单、团购券等链路会把系统虚拟行写入 sale_order_items，
 * 这些行落库后 product_id 一律为 null，读取侧只能按 productName（必要时叠加
 * 分类名）反向识别。判定口径统一收敛在本文件，避免各处复制导致统计漂移。
 */

/**
 * 空间预付款商品的 productName。
 * 在数据库 sale_order_items 中，预付款行的 productId 为 null，
 * 只能通过 productName 识别。
 *
 * 在非财务模块（profit-detail、business-analysis、dashboard-home、sales-record、report-center）
 * 中应排除此 productName 的行，只算实际消费。
 * 财务模块（finance-overview）保留完整流水口径，不排除。
 */
export const PREPAID_DEDUCTION_PRODUCT_NAME = '预付款';

/**
 * 空间续费抵扣商品的 productName。
 * 在数据库 sale_order_items 中，续费抵扣行的 productId 为 null，
 * 只能通过 productName 识别。
 *
 * 与预付款同理，非财务模块应排除此行，只算实际消费。
 */
export const RENEW_DEDUCTION_PRODUCT_NAME = '续费抵扣';

/**
 * 自助下单已在线支付商品的抵扣行。
 * 顾客在小程序侧已通过余额/微信完成支付，结算时以同名负向行把该部分
 * 从空间账单应付中冲减（与续费/预付款抵扣同一记账模式），避免重复收费。
 * productName 同样需要被非财务模块排除，只算实际消费。
 */
export const SELF_ORDER_DEDUCTION_PRODUCT_ID = 'SYS_SELF_ORDER_DEDUCTION';
export const SELF_ORDER_DEDUCTION_PRODUCT_NAME = '自助下单抵扣';

/**
 * 纯消费模式开台团购券的「券面消费行」后缀（如「分手大师（团购券）」）。
 *
 * 该行是券面金额的记账载体：金额必须计入营业额（券面 = 顾客买券实付 = 门店
 * 结算收入），但不是真实商品 —— 不计入销售件数、不进商品排行榜 / 品类分布。
 * 与之配对的负向「预付款」抵扣行照旧按抵扣行排除，两行在金额上不会重复计。
 */
export const GROUPON_VOUCHER_ITEM_SUFFIX = '（团购券）';

/**
 * 券面消费行的展示分类。落库后系统行 product_id 一律为 null，
 * 只能靠「后缀 + 分类」双条件反向识别，避免误伤同名真实商品。
 */
export const GROUPON_VOUCHER_CATEGORY_NAME = '团购券';

/**
 * 是否为券面消费行。
 *
 * 传入 categoryName 时走「后缀 + 系统分类」双条件：商家自建商品若恰好以
 * 「（团购券）」结尾，不会被误判成系统行（否则销量与商品排行榜会漏统计）。
 * 不传（历史调用点）时退化为按后缀判定，保持兼容且不改变既有行为。
 */
export function isGrouponVoucherItemName(
  productName: string,
  categoryName?: string,
): boolean {
  if (!productName.endsWith(GROUPON_VOUCHER_ITEM_SUFFIX)) return false;
  return (
    categoryName === undefined || categoryName === GROUPON_VOUCHER_CATEGORY_NAME
  );
}

/**
 * 台位费展示名正则：兼容「台位费（固定）/ 台位费（按单价）」
 * 与「台位费 2小时30分钟」（计时模式已去掉括号）两种形式。
 * 列表 / 报表 / CSV / 件数统计共用，避免各处复制正则导致判定漂移。
 */
export const TABLE_FEE_NAME_RE = /^台位费(（|\s|$)/;

/**
 * 是否为「不计入销售件数」的系统虚拟行。
 *
 * 与空间结账的 isNonQuantitySystemItem(productId) 同一口径，但落库后
 * 系统行的 product_id 一律为 null（SYS_ 前缀 ID 非数字，写入 Int 列被置空），
 * 因此读取侧只能按 productName 反向识别：
 * - 抵扣行（预付/续费/自助下单）：负数金额行，不表示真实销售件数；
 * - 台位费行（计时/一口价）：按时间计费，不是商品销量。
 *
 * ⚠️ 金额（营业额/利润）不在此排除——抵扣行必须与它对应的商品行配对后才能
 * 互相冲抵。单独剔除任一侧都会导致金额重复计算（详见 listVisibleSaleOrderItems）。
 */
export function isNonQuantitySalesRecordRow(
  productName: string,
  categoryName?: string,
): boolean {
  return (
    isDeductionProductName(productName) ||
    productName.endsWith(` · ${SELF_ORDER_DEDUCTION_PRODUCT_NAME}`) ||
    // 券面消费行是券面金额的记账载体，不是真实商品销量
    isGrouponVoucherItemName(productName, categoryName) ||
    TABLE_FEE_NAME_RE.test(productName)
  );
}

/**
 * 是否为「不计入金额聚合」的抵扣行（预付款 / 续费抵扣 / 自助下单抵扣）。
 *
 * 与 isNonQuantitySalesRecordRow 的区别：后者还额外包含台位费行。
 * 台位费只是「不计件数」（按时间计费，不是商品销量），但它是真实营收，
 * 金额（营业额 / 利润）**必须**计入——否则按时间计费的订单会被整单抹成
 * ¥0，与统计卡 / 报表 / CSV 导出口径不一致（非餐饮门店台位费订单恒显示 0 利润）。
 *
 * 仅抵扣行在金额侧排除：它们代表已在开台/续费/小程序侧收到的钱，
 * 落到本单只是冲减应收，不是本单新增营业额。
 */
export function isAmountDeductionSalesRecordRow(productName: string): boolean {
  return (
    isDeductionProductName(productName) ||
    productName.endsWith(` · ${SELF_ORDER_DEDUCTION_PRODUCT_NAME}`)
  );
}

/**
 * 从明细行还原「客人实收净额」（分）：Σ非抵扣行 − Σ|抵扣行|。
 *
 * 为什么不能直接用 sale_orders.total_revenue：该列是**营业额**口径
 * （纯消费券单已把券面计入，见 SpaceSessionSettlement.grossRevenue），
 * 而小票「合计」与整单退款要的是「客人本次实际掏的钱 / 门店该退的钱」，
 * 两者不是一回事。抵扣行在库里可能以正数（空间结账，代表已收到的钱）
 * 或负数（手工录单）存储，故统一按绝对值扣减，保证两种存储都成立。
 *
 * 无抵扣行的普通订单（扫码点餐 / 手工录单）→ 结果与 total_revenue 相同，
 * 因此该口径对历史数据与现有调用方均等价于原行为。
 */
export function sumNetPayableCents(
  items: Array<{ productName: string; salePrice: number; quantity: number }>,
): number {
  return sumNetBy(items, (item) => item.salePrice);
}

/** 同上，还原「净利」口径（用于整单退款的利润冲销）。 */
export function sumNetProfitCents(
  items: Array<{ productName: string; profit: number; quantity: number }>,
): number {
  return sumNetBy(items, (item) => item.profit);
}

function sumNetBy<T extends { productName: string; quantity: number }>(
  items: T[],
  pick: (item: T) => number,
): number {
  return items.reduce((sum, item) => {
    const quantity = Number.isFinite(item.quantity) ? item.quantity : 1;
    return isAmountDeductionSalesRecordRow(item.productName)
      ? sum - Math.abs(pick(item)) * quantity
      : sum + pick(item) * quantity;
  }, 0);
}

/**
 * 判断商品行是否为抵扣行（预付款/续费抵扣/自助下单抵扣），
 * 非财务模块应排除这些行，只算实际消费。
 * 兼容历史数据中 productName = '预付抵扣' 的旧值。
 */
export function isDeductionProductName(productName: string): boolean {
  return (
    productName === PREPAID_DEDUCTION_PRODUCT_NAME ||
    productName === '预付抵扣' || // 兼容历史数据
    productName === RENEW_DEDUCTION_PRODUCT_NAME ||
    productName === SELF_ORDER_DEDUCTION_PRODUCT_NAME
  );
}

/**
 * P2b fix: 基于 systemProductId 优先判定抵扣项，回退到 productName 兼容历史数据。
 * 供销售层替代 isDeductionProductName 使用，避免改名后判定静默失效。
 */
export function isDeductionItem(item: {
  systemProductId?: string;
  productName: string;
}): boolean {
  if (item.systemProductId) {
    return (
      item.systemProductId === 'SYS_RENEW_DEDUCTION' ||
      item.systemProductId === 'SYS_PREPAID_DEDUCTION' ||
      item.systemProductId === SELF_ORDER_DEDUCTION_PRODUCT_ID
    );
  }
  return isDeductionProductName(item.productName);
}

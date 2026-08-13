import type { ScanOrderStatus } from '@prisma/client';
import type { OrderDiscountItem } from '../../../purely-club/scan-ordering/club-scan-ordering-order.mapper';

/** 扫码点餐金额汇总，所有字段均由后端计算并以元输出。 */
export interface ScanOrderingAmountSummary {
  /** 商品基础价合计。 */
  itemOriginalAmount: number;
  /** 规格加价合计。 */
  specificationExtraAmount: number;
  /** 商品级优惠。 */
  productDiscountAmount: number;
  /** 订单级优惠。 */
  orderDiscountAmount: number;
  /** 税费。 */
  taxAmount: number;
  /** 服务费。 */
  serviceFeeAmount: number;
  /** 应付金额。 */
  payableAmount: number;
  /** 已支付金额。 */
  paidAmount: number;
  /** 待支付金额。 */
  outstandingAmount: number;
  /** 币种。 */
  currency: 'CNY';
}

/** 商家端订单金额汇总输出：在基础汇总上附加积分抵扣与优惠清单（均由后端计算）。 */
export interface ScanOrderingOrderAmountSummary extends ScanOrderingAmountSummary {
  /** 积分抵扣金额（元）。 */
  pointsDeductAmount: number;
  /** 优惠清单明细（前端只读展示）。 */
  discountItems: OrderDiscountItem[];
}

/** 商家订单详情响应。 */
export interface ScanOrderingOrderDetailPayload {
  /** 订单主键。 */
  id: number;
  /** 门店订单号。 */
  orderNo: string;
  /** 订单状态。 */
  status: ScanOrderStatus;
  /** 乐观锁版本。 */
  version: number;
  /** 桌台信息（含桌号编码）。 */
  table: { name: string; tableCode: string };
  /** 创建时间 ISO 字符串。 */
  createdAt: string;
  /** 取餐号数值；未分配为 null。 */
  pickupNumber: number | null;
  /** 取餐号展示文案；未分配为 null。 */
  pickupNumberLabel: string | null;
  /** 后端金额汇总。 */
  amountSummary: ScanOrderingOrderAmountSummary;
  /** 订单商品明细。 */
  items: Array<{
    /** 商品名称快照。 */
    name: string;
    /** 购买数量。 */
    quantity: number;
    /** 单项原价小计（元,未扣商品级优惠）。 */
    lineTotalAmount: number;
    /** 单项应付金额（元,已扣商品级优惠）。 */
    amount: number;
    /** 规格选项列表。 */
    specs: Array<{ name: string; extraPrice: number }>;
  }>;
  /** 状态流转历史。 */
  histories: Array<{
    fromStatus: string;
    toStatus: string;
    reason: string;
    createdAt: string;
  }>;
}

/** 商家扫码点餐首页看板。 */
export interface ScanOrderingDashboardResponse {
  /** 营业日期。 */
  businessDate: string;
  /** 上海今日支付且未完成退款的净营业额。 */
  paidRevenue: number;
  /** 上海今日创建的订单数量。字段名为兼容既有接口保留。 */
  paidOrderCount: number;
  /** 待接单数量。 */
  pendingOrderCount: number;
  /** 制作中订单数量。 */
  preparingOrderCount: number;
  /** 退款处理中订单数量。 */
  refundingOrderCount: number;
  /** 桌台状态数量汇总。 */
  tableStatusSummary: Record<
    'empty' | 'dining' | 'clearing' | 'disabled',
    number
  >;
}

/**
 * 订单商品摘要（订单列表卡片展示用）。
 * 多规格场景下:每条 ScanOrderItem 代表「同一个商品 + 同一组规格」的快照,
 * 多条同名商品会因为规格不同而被拆成多项呈现,运营端卡片可据此渲染
 * 多张缩略图、规格清单与各项金额。
 */
export interface ScanOrderingOrderItemSummary {
  /** 商品名称快照 */
  productName: string;
  /** 商品图片地址快照 */
  productImageUrl: string | null;
  /** 购买数量 */
  quantity: number;
  /** 规格选项名称列表(已按 id 升序拼接) */
  specs: string[];
  /** 单价(元,含规格加价) */
  unitPrice: number;
  /** 单项小计金额(元,未扣优惠) */
  lineTotalAmount: number;
  /** 单项应付金额(元,已扣单品级优惠) */
  payableLineAmount: number;
}

/** 商家订单列表项。 */
export interface ScanOrderingOrderListItem {
  /** 订单主键。 */
  id: number;
  /** 门店订单号。 */
  orderNo: string;
  /** 乐观锁版本。 */
  version: number;
  /**
   * 订单商品简洁摘要(纯文本,兼容旧前端使用)。
   * 形式: 「商品A×2、商品B×1」,不再嵌入括号规格列表以避免阅读困难。
   */
  itemSummary: string;
  /**
   * 订单商品完整列表(多规格场景下逐项展开)。
   * 卡片层应优先基于本字段渲染图片/规格/金额布局。
   */
  items: ScanOrderingOrderItemSummary[];
  /** 顾客下单备注。 */
  remark: string | null;
  /** 桌台名称。 */
  tableName: string;
  /** 订单状态。 */
  status: ScanOrderStatus;
  /** 创建时间。 */
  createdAt: string;
  /** 后端金额汇总。 */
  amountSummary: ScanOrderingOrderAmountSummary;
  /**
   * 顾客昵称（未关联账号或查询失败时为“顾客”）。
   */
  guestName: string;
  /**
   * 首个商品图片 URL(用于订单卡片缩略图)。
   * 若订单存在多张图片,前端应改用 items 数组,此处仅保留兼容别名。
   */
  imageUrl: string | null;
  /**
   * 同一 diningRound 内的累计下单序号（从 1 开始）。
   *
   * 判定维度：同一门店 + 同一桌台 + 同一 clubUser + 同一 diningRoundId。
   * 序号 >1 在前端映射为"加餐"，否则为"首单"。清桌后 diningRoundId 会重新生成，
   * 因此清桌后新首单仍从 1 计数。
   *
   * 字段名沿用 sessionOrderSequence 以兼容既有前端消费。
   */
  sessionOrderSequence: number;
  /** 取餐号数值；未分配为 null。 */
  pickupNumber: number | null;
  /** 取餐号展示文案（如 001 / 1000）；未分配为 null。 */
  pickupNumberLabel: string | null;
  /** 取餐号状态。 */
  pickupNumberStatus: 'assigned' | 'called' | 'completed' | 'cancelled' | null;
  /** 叫号时间 ISO 字符串。 */
  pickupCalledAt: string | null;
}

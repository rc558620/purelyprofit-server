// ESC/POS 小票的结构化内容类型（由业务层组装，builder 只负责编译字节流）

/** 小票商品行（与扫码点餐订单快照结构对应）。 */
export interface EscPosTicketItem {
  name: string;
  quantity: number;
  /** 单价（元，含规格加价），可省略。 */
  unitPrice?: number | null;
  /** 行原价小计（元，未扣商品级优惠），展示用；与浏览器预览口径一致。 */
  lineTotalAmount?: number | null;
  /** 行应付金额（元，已扣商品级优惠），原价缺失时回退。 */
  payableLineAmount?: number | null;
  specs: Array<{ name: string }>;
}

/** 优惠清单行（负数为减免）。 */
export interface EscPosDiscountItem {
  label: string;
  amount: number;
  /** 被覆盖/失效优惠：文本小票无法画删除线，打印时跳过。 */
  isStrikethrough?: boolean;
}

/** 小票类型：顾客票 / 后厨制作单（信息区顺序与展示字段对齐浏览器预览）。 */
export type EscPosTicketVariant = 'receipt' | 'kitchen';

/** 结构化小票内容：由业务层组装，本类只负责编译为 ESC/POS 字节流。 */
export interface EscPosTicket {
  /** 小票类型：receipt=顾客票（含金额/优惠/页脚），kitchen=后厨单（不含金额）。 */
  variant?: EscPosTicketVariant;
  /** 门店名称（居中加粗）。 */
  storeName: string;
  /** 小票标题，如「后厨制作单」「扫码点餐订单」。 */
  title: string;
  orderNo: string;
  /** 下单时间（格式 YYYY-MM-DD HH:mm，可省略）。 */
  createdAtLabel?: string | null;
  pickupNumberLabel?: string | null;
  tableName?: string | null;
  items: EscPosTicketItem[];
  /** 应付金额（收银台顾客票传入，后厨制作单可省略）。 */
  payableAmount?: string | null;
  /** 已优惠总额（元，后厨制作单可省略）。 */
  discountAmount?: number | null;
  /** 优惠清单（后厨制作单可省略）。 */
  discountItems?: EscPosDiscountItem[] | null;
  /** 积分抵扣金额（元，后厨制作单可省略）。 */
  pointsDeductAmount?: number | null;
  /** 操作员（接单/操作人，可选）。 */
  operatorName?: string | null;
  remark?: string | null;
  /** 结尾问候语，如「谢谢惠顾，欢迎再次光临」。 */
  footer?: string | null;
}

/** 空间消费小票结构化内容：由空间打印业务层组装，本类只负责编译为 ESC/POS 字节流。 */
export interface SpaceEscPosTicket {
  /** 门店名称（居中加粗）。 */
  storeName: string;
  /** 小票标题，如「消费小票」。 */
  title: string;
  /** 空间名称（如 A02（小包））。 */
  spaceName: string;
  guestName?: string | null;
  guestCount?: number | null;
  /** 开台时间（YYYY-MM-DD HH:mm）。 */
  startTimeLabel: string;
  /** 结账时间（YYYY-MM-DD HH:mm）。 */
  endTimeLabel: string;
  /** 时长描述（如 2 小时 30 分钟）。 */
  durationLabel: string;
  /** 计费模式中文标签（纯计时/纯消费/混合/倒计时）。 */
  billingModeLabel: string;
  /** 台位费单价（元/小时）。 */
  hourlyRate?: number | null;
  /** 台位费金额（元）。 */
  timeCost: number;
  /** 台位费标签（固定 / 按单价 / 2小时30分钟），用于「商品合计」下方汇总行。 */
  timeFeeLabel: string;
  /** 消费商品明细（含系统内置行）。 */
  items: Array<{
    name: string;
    quantity: number;
    subtotal: number;
    /** 行来源：member_self_order=会员自助下单（已在线支付）。 */
    sourceType?: string | null;
    /** 行来源支付渠道：balance=储值余额 / wechat=微信支付。 */
    sourceChannel?: string | null;
    /** 规格名（如 ["大杯","热"]），无规格时不下发；打印时另起一行展示。 */
    specNames?: string[] | null;
  }>;
  /** 商品费用合计（元）。 */
  itemsCost: number;
  /** 续费抵扣金额（元）。 */
  renewDeduction: number;
  /** 预付抵扣金额（元）。 */
  prepaidDeduction: number;
  /** 自助下单已支付商品抵扣合计（元）。 */
  selfOrderDeduction?: number;
  /** 应付总额（元，可能为负数表示应退）。 */
  totalAmount: number;
  /** 支付方式中文标签。 */
  paymentMethodLabel?: string | null;
  note?: string | null;
  operatorName?: string | null;
  /** 结尾问候语，如「谢谢惠顾，欢迎再次光临」。 */
  footer?: string | null;
}

/** ESC/POS 文本编码：gbk 为国产热敏打印机经典兼容编码。 */
export type EscPosEncoding = 'utf8' | 'gbk';

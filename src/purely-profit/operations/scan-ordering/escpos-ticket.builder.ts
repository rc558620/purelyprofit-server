import * as iconv from 'iconv-lite';

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

/** ESC/POS 文本编码：gbk 为国产热敏打印机经典兼容编码。 */
export type EscPosEncoding = 'utf8' | 'gbk';

/** ESC/POS 控制字节。 */
const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

/** 分隔线宽度（80mm 小票纸约 32 个半角字符）。 */
const DIVIDER = '--------------------------------';

/** 切纸前送纸行数：让最后一行完全越过切刀位置，避免结尾内容被切掉。
 *  按本机打印头到切刀约 20mm（顶部物理留白≈2cm）估算，4 行≈17mm 为最优值；
 *  若实测结尾被切到则加回 5-6 行。 */
const FEED_LINES_BEFORE_CUT = 4;

/**
 * ESC/POS 小票指令编译器（品牌无关）。
 * 热敏小票打印机（佳博、芯烨、商米、爱普生、飞鹅 USB 型号等）均兼容 ESC/POS，
 * 因此无需按品牌适配，仅需在个别机型上调整文本编码（utf8 / gbk）。
 */
export class EscPosTicketBuilder {
  constructor(private readonly encoding: EscPosEncoding = 'utf8') {}

  /** 编译订单小票为 ESC/POS 字节流（内容与顺序对齐浏览器预览：
   *  顾客票=门店/标题/订单号/取餐号/桌台/下单时间/商品表头/商品+规格/备注/优惠清单/已优惠/实付/操作员/页脚；
   *  后厨单=门店/标题/桌台/取餐号/订单号/下单时间/商品表头/商品+规格/操作员/备注）。 */
  buildTicket(ticket: EscPosTicket): Buffer {
    const out: number[] = [];
    const kitchen = ticket.variant === 'kitchen';
    this.raw(out, ESC, 0x40); // 初始化打印机（顶部不再追加空行，减少票头留白）

    if (ticket.storeName) {
      this.line(out, ticket.storeName, {
        align: 'center',
        bold: true,
        double: true,
      });
      out.push(LF); // 门店名底部间距
    }
    // 标题：不加粗、常规字号
    this.line(out, ticket.title, { align: 'center' });
    out.push(LF);

    // 信息区顺序：订单号 → 取餐号 → 桌台 → 下单时间（顾客票与后厨单统一）
    this.line(out, `订单号：${ticket.orderNo}`);
    if (ticket.pickupNumberLabel) {
      this.line(out, `取餐号：${ticket.pickupNumberLabel}`);
    }
    if (ticket.tableName) {
      this.line(out, `桌台：${ticket.tableName}`);
    }
    if (ticket.createdAtLabel) {
      this.line(out, `下单时间：${ticket.createdAtLabel}`);
    }
    this.line(out, DIVIDER);

    // 商品明细：不加粗，商品行展示数量与金额
    this.line(out, '商品明细');
    for (const item of ticket.items) {
      const displayAmount = item.lineTotalAmount ?? item.payableLineAmount;
      const priceText =
        !kitchen && displayAmount != null
          ? `  ￥${displayAmount.toFixed(2)}`
          : '';
      this.line(out, `${item.name} x${item.quantity}${priceText}`);
      if (item.specs.length > 0) {
        // 同一商品的多个规格用顿号合并展示
        this.line(out, `  ${item.specs.map((spec) => spec.name).join('、')}`);
      }
    }

    if (kitchen) {
      // 后厨单：备注 → 操作员（备注上下带边框线）
      if (ticket.remark) {
        this.line(out, DIVIDER);
        this.line(out, `备注：${ticket.remark}`);
        this.line(out, DIVIDER);
      }
      if (ticket.operatorName) {
        this.line(out, `操作员：${ticket.operatorName}`);
      }
      this.feedAndCut(out);
      return Buffer.from(out);
    }

    // 顾客票：备注保持原位（商品明细后），顶部加边框线
    if (ticket.remark) {
      this.line(out, DIVIDER);
      this.line(out, `备注：${ticket.remark}`);
    }
    this.line(out, DIVIDER);

    if (
      (ticket.discountItems && ticket.discountItems.length > 0) ||
      (ticket.pointsDeductAmount != null && ticket.pointsDeductAmount > 0)
    ) {
      this.line(out, '优惠清单');
      for (const discount of ticket.discountItems ?? []) {
        // 被覆盖/失效优惠（预览划线项）不打印
        if (discount.isStrikethrough) continue;
        this.line(
          out,
          `${discount.label}  -￥${Math.abs(discount.amount).toFixed(2)}`,
        );
      }
      if (ticket.pointsDeductAmount != null && ticket.pointsDeductAmount > 0) {
        this.line(out, `积分抵扣  -￥${ticket.pointsDeductAmount.toFixed(2)}`);
      }
      this.line(out, DIVIDER);
    }

    // 实付区块：已优惠（带 ¥ 符号与冒号） + 实付金额
    if (ticket.discountAmount != null && ticket.discountAmount > 0) {
      this.line(out, `已优惠：¥${ticket.discountAmount.toFixed(2)} 元`);
    }
    if (ticket.payableAmount) {
      this.line(out, `实付：￥${ticket.payableAmount}`);
    }
    if (ticket.operatorName) {
      this.line(out, `操作员：${ticket.operatorName}`);
    }
    out.push(LF);

    if (ticket.footer) {
      this.line(out, ticket.footer, { align: 'center' });
    }

    this.feedAndCut(out);
    return Buffer.from(out);
  }

  /** 编译测试小票。 */
  buildTest(title: string, extra?: string): Buffer {
    const out: number[] = [];
    this.raw(out, ESC, 0x40);
    out.push(LF);
    this.line(out, title, { align: 'center', bold: true, double: true });
    out.push(LF);
    if (extra) {
      this.line(out, extra);
    }
    this.line(out, '--- 测试打印，验证 USB 链路正常 ---');
    this.line(out, `时间：${new Date().toLocaleString('zh-CN')}`);
    this.feedAndCut(out);
    return Buffer.from(out);
  }

  /** 输出一行文本并换行（支持居中/加粗/双倍字宽/高倍字高）。 */
  private line(
    out: number[],
    text: string,
    opts: {
      align?: 'left' | 'center';
      bold?: boolean;
      double?: boolean;
      tall?: boolean;
    } = {},
  ): void {
    const { align = 'left', bold = false, double = false, tall = false } = opts;
    this.raw(out, ESC, 0x61, align === 'center' ? 0x01 : 0x00); // 对齐
    if (bold) this.raw(out, ESC, 0x45, 0x01); // 加粗开
    if (double) {
      this.raw(out, GS, 0x21, 0x11); // 宽高双倍
    } else if (tall) {
      this.raw(out, GS, 0x21, 0x10); // 高度加倍、宽度不变（介于常规与双倍之间）
    }
    for (const byte of this.encode(text)) out.push(byte);
    if (double || tall) this.raw(out, GS, 0x21, 0x00); // 恢复正常字号
    if (bold) this.raw(out, ESC, 0x45, 0x00); // 加粗关
    out.push(LF);
  }

  /** 切纸前送纸：先走纸让最后一行完全越过切刀位置，再半切，避免结尾内容被切掉。 */
  private feedAndCut(out: number[]): void {
    for (let i = 0; i < FEED_LINES_BEFORE_CUT; i += 1) {
      out.push(LF);
    }
    this.cut(out);
  }

  /** 切纸（半切）。 */
  private cut(out: number[]): void {
    this.raw(out, GS, 0x56, 0x42, 0x00);
  }

  private raw(out: number[], ...bytes: number[]): void {
    out.push(...bytes);
  }

  private encode(text: string): Buffer {
    return this.encoding === 'gbk'
      ? // GBK 字库无半角 ¥（U+00A5）映射，iconv 会降级为问号 0x3F；
        // 统一替换为全角 ￥（GBK 0xA3A4），避免票面金额符号变问号
        iconv.encode(text.replaceAll('¥', '￥'), 'gbk')
      : Buffer.from(text, 'utf8');
  }
}

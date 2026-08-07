import * as iconv from 'iconv-lite';

/** 小票商品行（与扫码点餐订单快照结构对应）。 */
export interface EscPosTicketItem {
  name: string;
  quantity: number;
  specs: Array<{ name: string }>;
}

/** 结构化小票内容：由业务层组装，本类只负责编译为 ESC/POS 字节流。 */
export interface EscPosTicket {
  /** 门店名称（居中加粗）。 */
  storeName: string;
  /** 小票标题，如「后厨制作单」「扫码点餐订单」。 */
  title: string;
  orderNo: string;
  pickupNumberLabel?: string | null;
  tableName?: string | null;
  items: EscPosTicketItem[];
  /** 应付金额（收银台顾客票传入，后厨制作单可省略）。 */
  payableAmount?: string | null;
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

/**
 * ESC/POS 小票指令编译器（品牌无关）。
 * 热敏小票打印机（佳博、芯烨、商米、爱普生、飞鹅 USB 型号等）均兼容 ESC/POS，
 * 因此无需按品牌适配，仅需在个别机型上调整文本编码（utf8 / gbk）。
 */
export class EscPosTicketBuilder {
  constructor(private readonly encoding: EscPosEncoding = 'utf8') {}

  /** 编译订单小票为 ESC/POS 字节流（初始化 → 内容 → 切纸）。 */
  buildTicket(ticket: EscPosTicket): Buffer {
    const out: number[] = [];
    this.raw(out, ESC, 0x40); // 初始化打印机
    out.push(LF);

    if (ticket.storeName) {
      this.line(out, ticket.storeName, {
        align: 'center',
        bold: true,
        double: true,
      });
    }
    this.line(out, ticket.title, { align: 'center', bold: true, double: true });
    out.push(LF);

    this.line(out, `订单号：${ticket.orderNo}`);
    if (ticket.pickupNumberLabel) {
      this.line(out, `取餐号：${ticket.pickupNumberLabel}`);
    }
    if (ticket.tableName) {
      this.line(out, `桌台：${ticket.tableName}`);
    }
    this.line(out, DIVIDER);

    this.line(out, '商品明细', { bold: true });
    for (const item of ticket.items) {
      this.line(out, `${item.name} ×${item.quantity}`);
      for (const spec of item.specs) {
        this.line(out, `    ${spec.name}`);
      }
    }
    this.line(out, DIVIDER);

    if (ticket.payableAmount) {
      this.line(out, `应付：¥${ticket.payableAmount}`, { bold: true });
    }
    if (ticket.remark) {
      this.line(out, `备注：${ticket.remark}`);
    }
    out.push(LF);

    if (ticket.footer) {
      this.line(out, ticket.footer, { align: 'center' });
      out.push(LF);
    }

    this.cut(out);
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
    out.push(LF);
    this.cut(out);
    return Buffer.from(out);
  }

  /** 输出一行文本并换行（支持居中/加粗/双倍字宽）。 */
  private line(
    out: number[],
    text: string,
    opts: { align?: 'left' | 'center'; bold?: boolean; double?: boolean } = {},
  ): void {
    const { align = 'left', bold = false, double = false } = opts;
    this.raw(out, ESC, 0x61, align === 'center' ? 0x01 : 0x00); // 对齐
    if (bold) this.raw(out, ESC, 0x45, 0x01); // 加粗开
    if (double) this.raw(out, GS, 0x21, 0x11); // 双倍宽高
    for (const byte of this.encode(text)) out.push(byte);
    if (double) this.raw(out, GS, 0x21, 0x00); // 恢复正常字号
    if (bold) this.raw(out, ESC, 0x45, 0x00); // 加粗关
    out.push(LF);
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
      ? iconv.encode(text, 'gbk')
      : Buffer.from(text, 'utf8');
  }
}

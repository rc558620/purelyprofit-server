import * as iconv from 'iconv-lite';
import type {
  EscPosEncoding,
  EscPosTicket,
  SpaceEscPosTicket,
} from './escpos-ticket.types';

// 小票内容结构已抽离到 escpos-ticket.types.ts，此处 re-export 保持向后兼容
export * from './escpos-ticket.types';

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

  /** 编译空间消费小票为 ESC/POS 字节流（内容对齐商家端 ReceiptPrintView：
   *  门店/标题/空间/顾客/人数/开台/结账/时长/计费/台位费单价/台位费/商品明细/商品合计/抵扣/合计/支付方式/备注/操作员/页脚）。
   *  金额由业务层分转元后传入，可能为负数（应退场景）。 */
  buildSpaceTicket(ticket: SpaceEscPosTicket): Buffer {
    const out: number[] = [];
    this.raw(out, ESC, 0x40); // 初始化打印机

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

    // 信息区：空间 → 顾客 → 人数 → 开台 → 结账 → 时长 → 计费 → 台位费单价
    this.line(out, `空间：${ticket.spaceName}`);
    if (ticket.guestName) {
      this.line(out, `顾客：${ticket.guestName}`);
    }
    if (ticket.guestCount != null) {
      // 数字与汉字之间不留半角空格：热敏机中文模式下空格按全角宽度出纸，会拉出一个字的缝
      this.line(out, `人数：${ticket.guestCount}人`);
    }
    this.line(out, `开台：${ticket.startTimeLabel}`);
    this.line(out, `结账：${ticket.endTimeLabel}`);
    this.line(out, `时长：${ticket.durationLabel}`);
    this.line(out, `计费：${ticket.billingModeLabel}`);
    if (ticket.hourlyRate != null) {
      this.line(out, `台位费单价：￥${ticket.hourlyRate.toFixed(2)}/小时`);
    }
    this.line(out, DIVIDER);

    // 商品明细：全部会话明细（含系统内置行），商品合计单独行
    if (ticket.items.length > 0) {
      this.line(out, '商品明细');
      for (const item of ticket.items) {
        // 自助下单商品：商品名后拼「 (自助)」，与云打印格式一致
        const name =
          item.sourceType === 'member_self_order'
            ? `${item.name} (自助)`
            : item.name;
        this.line(
          out,
          `${name} x${item.quantity}  ￥${item.subtotal.toFixed(2)}`,
        );
        // 规格另起一行（对齐餐饮扫码点餐小票口径）
        if (item.specNames && item.specNames.length > 0) {
          this.line(out, `  ${item.specNames.join('、')}`);
        }
      }
      this.line(out, `商品合计：￥${ticket.itemsCost.toFixed(2)}`);
    }

    // 台位费：不占商品明细行，作为「商品合计」下方的单列汇总行
    if (ticket.timeCost > 0) {
      this.line(
        out,
        `台位费 (${ticket.timeFeeLabel})：￥${ticket.timeCost.toFixed(2)}`,
      );
    }

    // 券面消费行：券已在 purelyClub 付过，与「预付抵扣」等额成对出现，
    // 缺任一侧都会让票面明细加总与合计对不上。
    if ((ticket.voucherConsumption ?? 0) > 0) {
      this.line(
        out,
        `券面消费 (团购券)：￥${ticket.voucherConsumption!.toFixed(2)}`,
      );
    }

    // 抵扣区：续费抵扣 + 预付抵扣 + 自助下单 (已支付) + 会员卡抵扣
    if (ticket.renewDeduction > 0) {
      this.line(out, `续费抵扣：-￥${ticket.renewDeduction.toFixed(2)}`);
    }
    if (ticket.prepaidDeduction > 0) {
      this.line(out, `预付抵扣：-￥${ticket.prepaidDeduction.toFixed(2)}`);
    }
    if ((ticket.selfOrderDeduction ?? 0) > 0) {
      this.line(
        out,
        `自助下单 (已支付)：-￥${ticket.selfOrderDeduction!.toFixed(2)}`,
      );
    }
    if ((ticket.cardDeduction ?? 0) > 0) {
      this.line(out, `会员卡抵扣：-￥${ticket.cardDeduction!.toFixed(2)}`);
    }
    this.line(out, DIVIDER);

    // 合计：常规字重展示（可能为负数表示应退）
    this.line(out, `合计：￥${ticket.totalAmount.toFixed(2)}`);
    if (ticket.paymentMethodLabel) {
      this.line(out, `支付方式：${ticket.paymentMethodLabel}`);
    }
    if (ticket.note) {
      this.line(out, `备注：${ticket.note}`);
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

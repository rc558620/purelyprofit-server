import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

/** 空间小票系统商品 ID（与前端 spaceManagement 常量对齐）。 */
const SYS_RENEW_DEDUCTION_ID = 'SYS_RENEW_DEDUCTION';
const SYS_PREPAID_DEDUCTION_ID = 'SYS_PREPAID_DEDUCTION';

/** 计费模式中文标签（与前端 BILLING_MODE_CONFIG 对齐）。 */
const BILLING_MODE_LABEL: Record<string, string> = {
  timed: '纯计时',
  items: '纯消费',
  mixed: '混合',
  countdown: '倒计时',
};

/** 支付方式中文标签（与前端空间小票 PAYMENT_METHOD_LABEL 对齐）。 */
const PAYMENT_METHOD_LABEL: Record<string, string> = {
  cash: '现金',
  wechat: '微信',
  alipay: '支付宝',
  card: '刷卡',
  groupon_voucher: '团购券',
  platform: '平台',
  other: '其他',
};

/** 空间消费小票的商品明细行。 */
export interface SpacePrintItem {
  name: string;
  quantity: number;
  /** 销售单价（元）。 */
  unitPrice: number;
  /** 行小计金额（元）。 */
  subtotal: number;
}

/** 空间消费小票打印数据（金额均由后端分转元计算，前端只读展示）。 */
export interface SpacePrintOrder {
  orderNo: string;
  /** 空间名称（如 A02（小包））。 */
  spaceName: string;
  /** 空间类型名称（如 包间）。 */
  spaceType: string;
  guestName: string | null;
  guestCount: number | null;
  /** 开台时间（YYYY-MM-DD HH:mm，Asia/Shanghai）。 */
  startTimeLabel: string;
  /** 结账时间（YYYY-MM-DD HH:mm，Asia/Shanghai）。 */
  endTimeLabel: string;
  /** 时长描述（如 2 小时 30 分钟）。 */
  durationLabel: string;
  /** 计费模式中文标签（纯计时/纯消费/混合/倒计时）。 */
  billingModeLabel: string;
  /** 台位费单价（元/小时，countdown 模式为固定台位费）。 */
  hourlyRate: number | null;
  /** 台位费金额（元）。 */
  timeCost: number;
  /** 消费商品明细（含系统内置行：台位费/续费抵扣/预付抵扣）。 */
  items: SpacePrintItem[];
  /** 商品费用合计（元）。 */
  itemsCost: number;
  /** 续费抵扣金额（元）。 */
  renewDeduction: number;
  /** 预付抵扣金额（元）。 */
  prepaidDeduction: number;
  /** 应付总额（元，消费 - 抵扣，可能为负数表示应退）。 */
  totalAmount: number;
  /** 支付方式中文标签。 */
  paymentMethodLabel: string;
  note: string | null;
  operatorName: string | null;
}

/**
 * 空间消费小票打印数据服务：按结账生成的销售订单查询并归一为打印所需结构，
 * 供飞鹅云打印通道与 USB 打印通道共用（金额一律以后端落库为准）。
 */
@Injectable()
export class SpacePrintDataService {
  constructor(private readonly prisma: PrismaService) {}

  /** 查询销售订单并归一为空间小票打印结构（含空间信息与抵扣明细）。 */
  async loadOrder(storeId: number, saleOrderId: number): Promise<SpacePrintOrder> {
    const saleOrder = await this.prisma.saleOrder.findFirst({
      where: { id: saleOrderId, storeId },
      include: {
        spaceSession: {
          include: {
            space: { include: { type: true } },
            sessionItems: { orderBy: { sortOrder: 'asc' } },
          },
        },
      },
    });
    if (!saleOrder) throw new NotFoundException('销售订单不存在');
    const session = saleOrder.spaceSession;
    if (!session) {
      throw new NotFoundException('该销售订单不是空间结账订单，无法打印空间小票');
    }

    const toYuan = (fen: number): number => fen / 100;
    const deductionOf = (productId: string): number =>
      session.sessionItems
        .filter((item) => item.productId === productId)
        .reduce((sum, item) => sum + item.salePrice * item.quantity, 0);

    const endTime = session.endTime ?? saleOrder.createdAt;
    return {
      orderNo: saleOrder.orderNo,
      spaceName: session.space.name,
      spaceType: session.space.type.name,
      guestName: session.guestName,
      guestCount: session.guestCount,
      startTimeLabel: this.formatDateTime(session.startTime),
      endTimeLabel: this.formatDateTime(endTime),
      durationLabel: this.formatDuration(session.startTime, endTime),
      billingModeLabel:
        BILLING_MODE_LABEL[session.billingMode] ?? session.billingMode,
      hourlyRate:
        session.hourlyRate == null ? null : toYuan(session.hourlyRate),
      timeCost: toYuan(session.timeCost ?? 0),
      items: session.sessionItems.map((item) => ({
        name: item.productName,
        quantity: item.quantity,
        unitPrice: toYuan(item.salePrice),
        subtotal: toYuan(item.salePrice * item.quantity),
      })),
      itemsCost: toYuan(session.itemsCost),
      renewDeduction: toYuan(deductionOf(SYS_RENEW_DEDUCTION_ID)),
      prepaidDeduction: toYuan(deductionOf(SYS_PREPAID_DEDUCTION_ID)),
      totalAmount: toYuan(saleOrder.totalRevenue),
      paymentMethodLabel:
        PAYMENT_METHOD_LABEL[saleOrder.paymentMethod] ?? saleOrder.paymentMethod,
      note: saleOrder.note,
      operatorName: saleOrder.operatorNameSnapshot,
    };
  }

  /** 格式化时间戳为 YYYY-MM-DD HH:mm（Asia/Shanghai，与扫码点餐打印一致）。 */
  private formatDateTime(date: Date): string {
    const parts = new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .reduce<Record<string, string>>((result, part) => {
        result[part.type] = part.value;
        return result;
      }, {});
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
  }

  /** 格式化时长为「x 小时 y 分钟 / y 分钟 / 不足 1 分钟」（与前端 formatDurationLabel 对齐）。 */
  private formatDuration(start: Date, end: Date): string {
    const sec = Math.floor((end.getTime() - start.getTime()) / 1000);
    if (sec < 60) return '不足 1 分钟';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return h > 0 ? `${h} 小时 ${m > 0 ? `${m} 分钟` : ''}`.trim() : `${m} 分钟`;
  }
}

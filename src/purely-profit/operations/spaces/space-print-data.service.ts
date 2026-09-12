import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

/** 空间小票系统商品 ID（与前端 spaceManagement 常量对齐）。 */
const SYS_RENEW_DEDUCTION_ID = 'SYS_RENEW_DEDUCTION';
const SYS_PREPAID_DEDUCTION_ID = 'SYS_PREPAID_DEDUCTION';
const SYS_SELF_ORDER_DEDUCTION_ID = 'SYS_SELF_ORDER_DEDUCTION';
/** 台位费行：不占商品明细，改由「商品合计」下方单列汇总行呈现。 */
const SYS_TIME_BILLING_ID = 'SYS_TIME_BILLING';

/**
 * 抵扣类系统行：结账时以正数落库到会话明细表，
 * 小票商品明细区不展示（避免与汇总区「续费/预付/自助下单抵扣」重复）。
 */
const DEDUCTION_PRODUCT_IDS = new Set<string>([
  SYS_RENEW_DEDUCTION_ID,
  SYS_PREPAID_DEDUCTION_ID,
  SYS_SELF_ORDER_DEDUCTION_ID,
]);

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
  /** 行来源：member_self_order=会员自助下单（已在线支付）。 */
  sourceType?: string | null;
  /** 行来源支付渠道：balance=储值余额 / wechat=微信支付（仅自助下单行有值）。 */
  sourceChannel?: string | null;
  /** 规格名（如 ["大杯","热"]），无规格时不下发；打印时另起一行展示。 */
  specNames?: string[] | null;
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
  /** 台位费标签（固定 / 按单价 / 2小时30分钟），用于「商品合计」下方汇总行。 */
  timeFeeLabel: string;
  /** 消费商品明细（已剔除台位费与抵扣类系统行）。 */
  items: SpacePrintItem[];
  /** 商品费用合计（元）。 */
  itemsCost: number;
  /** 续费抵扣金额（元）。 */
  renewDeduction: number;
  /** 预付抵扣金额（元）。 */
  prepaidDeduction: number;
  /** 自助下单已支付商品抵扣合计（元）。 */
  selfOrderDeduction: number;
  /** 应付总额（元，消费 - 抵扣，可能为负数表示应退）。 */
  totalAmount: number;
  /** 支付方式中文标签。 */
  paymentMethodLabel: string;
  note: string | null;
  operatorName: string | null;
}

/** 规格名快照 JSON → string[]；非数组或空数组视为无规格。 */
const parseSpecNames = (value: unknown): string[] | null => {
  if (!Array.isArray(value)) return null;
  const names = value.filter(
    (item): item is string => typeof item === 'string',
  );
  return names.length > 0 ? names : null;
};

/** 剥离商品名尾部的规格后缀「（规格1/规格2）」。 */
const stripSpecSuffix = (name: string): string =>
  (name ?? '').replace(/（[^）]*）\s*$/, '');

/** 从台位费行商品名中提取标签：台位费（固定）→ 固定；台位费 2小时30分钟 → 2小时30分钟。 */
const resolveTimeFeeLabel = (productName: string): string =>
  (productName ?? '')
    .replace(/^台位费\s*/, '')
    .replace(/^[（(]/, '')
    .replace(/[）)]$/, '')
    .trim();

/**
 * 空间消费小票打印数据服务：按结账生成的销售订单查询并归一为打印所需结构，
 * 供飞鹅云打印通道与 USB 打印通道共用（金额一律以后端落库为准）。
 */
@Injectable()
export class SpacePrintDataService {
  constructor(private readonly prisma: PrismaService) {}

  /** 查询销售订单并归一为空间小票打印结构（含空间信息与抵扣明细）。 */
  async loadOrder(
    storeId: number,
    saleOrderId: number,
  ): Promise<SpacePrintOrder> {
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
      throw new NotFoundException(
        '该销售订单不是空间结账订单，无法打印空间小票',
      );
    }

    const toYuan = (fen: number): number => fen / 100;
    const deductionOf = (productId: string): number =>
      session.sessionItems
        .filter((item) => item.productId === productId)
        .reduce((sum, item) => sum + item.salePrice * item.quantity, 0);

    const endTime = session.endTime ?? saleOrder.createdAt;
    // 台位费标签：从台位费行商品名提取（固定 / 按单价 / 2小时30分钟）
    const timeFeeItem = session.sessionItems.find(
      (item) => item.productId === SYS_TIME_BILLING_ID,
    );
    const timeFeeLabel = timeFeeItem
      ? resolveTimeFeeLabel(timeFeeItem.productName)
      : '';
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
      timeFeeLabel,
      items: session.sessionItems
        .filter(
          (item) =>
            !DEDUCTION_PRODUCT_IDS.has(item.productId) &&
            item.productId !== SYS_TIME_BILLING_ID,
        )
        .map((item) => {
          const specNames = parseSpecNames(item.specNames);
          return {
            // 规格另起一行展示（对齐餐饮扫码点餐小票口径），故从商品名剥离后缀避免重复
            name: specNames ? stripSpecSuffix(item.productName) : item.productName,
            quantity: item.quantity,
            unitPrice: toYuan(item.salePrice),
            subtotal: toYuan(item.salePrice * item.quantity),
            sourceType: item.sourceType,
            sourceChannel: item.sourceChannel,
            ...(specNames ? { specNames } : {}),
          };
        }),
      itemsCost: toYuan(session.itemsCost),
      renewDeduction: toYuan(deductionOf(SYS_RENEW_DEDUCTION_ID)),
      prepaidDeduction: toYuan(deductionOf(SYS_PREPAID_DEDUCTION_ID)),
      selfOrderDeduction: toYuan(deductionOf(SYS_SELF_ORDER_DEDUCTION_ID)),
      totalAmount: toYuan(saleOrder.totalRevenue),
      paymentMethodLabel:
        PAYMENT_METHOD_LABEL[saleOrder.paymentMethod] ??
        saleOrder.paymentMethod,
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

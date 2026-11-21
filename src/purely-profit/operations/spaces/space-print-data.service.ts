import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  isDeductionProductName,
  PREPAID_DEDUCTION_PRODUCT_NAME,
  RENEW_DEDUCTION_PRODUCT_NAME,
  SELF_ORDER_DEDUCTION_PRODUCT_NAME,
} from '../../commerce/commerce.utils';

/** 空间小票系统商品 ID（与前端 spaceManagement 常量对齐）。 */
const SYS_RENEW_DEDUCTION_ID = 'SYS_RENEW_DEDUCTION';
const SYS_PREPAID_DEDUCTION_ID = 'SYS_PREPAID_DEDUCTION';
const SYS_SELF_ORDER_DEDUCTION_ID = 'SYS_SELF_ORDER_DEDUCTION';
/**
 * 会员卡抵扣行：结账时同样以正数落库（buildSettlementSessionItemRows 对抵扣项取绝对值），
 * 但净额函数只按 productName 白名单识别预付/续费/自助下单，不认识「会员卡抵扣」，
 * 必须在这里单独扣除，否则小票合计会把卡抵扣当成商品金额加回去。
 */
const SYS_CARD_DEDUCTION_ID = 'SYS_CARD_DEDUCTION';
/** 台位费行：不占商品明细，改由「商品合计」下方单列汇总行呈现。 */
const SYS_TIME_BILLING_ID = 'SYS_TIME_BILLING';
/**
 * 纯消费模式开台团购券的券面消费行：券面已在 purelyClub 支付完成，
 * 小票商品明细区不展示（itemsCost 只统计本次点单，若展示会导致
 * 明细小计与「商品合计」对不上），券面与已付金额在汇总区单列。
 */
const SYS_GROUPON_VOUCHER_ID = 'SYS_GROUPON_VOUCHER';

/** 票面抵扣分栏：汇总区按这四类分别展示。 */
type DeductionBucket = 'renew' | 'prepaid' | 'selfOrder' | 'card';

/** 会话明细行在票面上的角色（唯一判定源）。 */
type ReceiptItemBucket = 'item' | 'timeBilling' | 'voucher' | DeductionBucket;

/**
 * 真实商品的 productId 一定是数字（会话明细的 String 列存真实商品主键），
 * 系统行统一是 SYS_*；只有「非数字 ID」才允许按名称兜底历史数据。
 */
const isRealProductId = (productId: string): boolean => /^\d+$/.test(productId);

/**
 * 历史抵扣行的分栏归属：早期系统行没有 SYS_* ID，只能按名称还原。
 * 识别不出具体类型时归入预付（历史数据里最常见的是「预付抵扣」）。
 */
const resolveHistoricalDeductionBucket = (
  productName: string,
): DeductionBucket => {
  if (productName === RENEW_DEDUCTION_PRODUCT_NAME) return 'renew';
  if (productName === SELF_ORDER_DEDUCTION_PRODUCT_NAME) return 'selfOrder';
  if (productName === PREPAID_DEDUCTION_PRODUCT_NAME) return 'prepaid';
  return 'prepaid';
};

/**
 * 会话明细行在票面上的角色（唯一判定源）。
 *
 * 商品明细、抵扣分栏与合计净额必须共用这一份结果：任何一处单独判重、
 * 单独剔除，都会打出「明细加总 ≠ 合计 / 抵扣显示 ¥0」的自相矛盾票面
 * （历史行只冲减净额却不进分栏时，¥50 商品 + ¥20 抵扣会打成明细 ¥70、合计 ¥30）。
 */
const resolveReceiptItemBucket = (item: {
  productId: string;
  productName: string;
}): ReceiptItemBucket => {
  switch (item.productId) {
    case SYS_RENEW_DEDUCTION_ID:
      return 'renew';
    case SYS_PREPAID_DEDUCTION_ID:
      return 'prepaid';
    case SYS_SELF_ORDER_DEDUCTION_ID:
      return 'selfOrder';
    case SYS_CARD_DEDUCTION_ID:
      return 'card';
    case SYS_TIME_BILLING_ID:
      return 'timeBilling';
    case SYS_GROUPON_VOUCHER_ID:
      return 'voucher';
    default:
      // 非数字 ID 且名称命中抵扣：早期系统行，同样要进分栏而不是只冲净额
      return !isRealProductId(item.productId) &&
        isDeductionProductName(item.productName)
        ? resolveHistoricalDeductionBucket(item.productName)
        : 'item';
  }
};

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
  /** 门店名称（浏览器小票抬头直接使用，避免前端另拉一次门店信息）。 */
  storeName: string;
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
  /** 开台时间戳（毫秒）：浏览器小票复用的时间入参，禁止用补打时间替代。 */
  startedAt: number;
  /** 结账时间戳（毫秒）：浏览器小票复用的时间入参，禁止用补打时间替代。 */
  settledAt: number;
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
  /** 会员卡权益抵扣金额（元）：属于付款方式变更，不是折价，单独成行展示。 */
  cardDeduction: number;
  /**
   * 开台团购券券面金额（元）：纯消费模式下券面记为本次消费（计入营业额），
   * 同时等额冲抵应付，故不进商品明细区，只在汇总区单列。非券单为 0。
   */
  voucherConsumption: number;
  /** 应付总额（元，消费 - 抵扣，可能为负数表示应退）。 */
  totalAmount: number;
  /** 支付方式原始枚举值（浏览器小票样式入参，展示仍用中文标签）。 */
  paymentMethod: string;
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
/**
 * 最近结账的空间订单（补打入口数据源）。
 * 必须由后端查询而不是只靠浏览器本地留存：自动结账（后端定时任务）
 * 与其他收银终端结的账，单个浏览器的 localStorage 永远看不到。
 */
export interface SpaceRecentSettledOrder {
  saleOrderId: number;
  /** 空间名称（如 A02（小包）），仅作展示。 */
  spaceName: string;
  /** 结账时间（ISO 8601），前端负责转展示时区与排序。 */
  settledAt: string;
}

/** 最近结账列表默认返回条数：补打入口只展示最近几条，无需翻页。 */
export const RECENT_SETTLED_ORDER_DEFAULT_LIMIT = 10;

/** 打印映射所需的销售单形态（含门店名、退款状态、空间会话与明细）。 */
type SpaceReceiptSaleOrder = Prisma.SaleOrderGetPayload<{
  include: {
    store: { select: { name: true } };
    refund: { select: { refundedAt: true } };
    spaceSession: {
      include: {
        space: { select: { name: true; type: { select: { name: true } } } };
        sessionItems: {
          select: {
            productId: true;
            productName: true;
            salePrice: true;
            quantity: true;
            specNames: true;
            sourceType: true;
            sourceChannel: true;
          };
        };
      };
    };
  };
}>;

@Injectable()
export class SpacePrintDataService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 查询门店最近结账的空间订单（按会话结账时间倒序）。
   *
   * 走 space_sessions 的 [storeId, status, endTime desc, id desc] 索引，
   * 只回表取展示所需的三列；已结账会话必然带 saleOrderId，
   * 但历史数据可能存在缺失，这里仍然过滤掉空值避免前端拿到脏 ID。
   */
  async listRecentSettledOrders(
    storeId: number,
    limit: number = RECENT_SETTLED_ORDER_DEFAULT_LIMIT,
  ): Promise<SpaceRecentSettledOrder[]> {
    const sessions = await this.prisma.spaceSession.findMany({
      where: { storeId, status: 'settled', saleOrderId: { not: null } },
      orderBy: [{ endTime: 'desc' }, { id: 'desc' }],
      take: limit,
      select: {
        saleOrderId: true,
        endTime: true,
        space: { select: { name: true } },
      },
    });
    return sessions.flatMap((session) => {
      const { saleOrderId, endTime } = session;
      if (!saleOrderId || !endTime) return [];
      return [
        {
          saleOrderId,
          spaceName: session.space.name,
          settledAt: endTime.toISOString(),
        },
      ];
    });
  }

  /**
   * 查询销售订单并归一为空间小票打印结构（含空间信息与抵扣明细）。
   * 结账打印、销售记录补打与 cloud/usb/browser 三个通道共用这一份数据。
   */
  async loadOrder(
    storeId: number,
    saleOrderId: number,
  ): Promise<SpacePrintOrder> {
    const saleOrder = await this.findSaleOrder(storeId, saleOrderId);
    if (!saleOrder) throw new NotFoundException('销售订单不存在');
    if (!saleOrder.spaceSession) {
      throw new NotFoundException(
        '该销售订单不是空间结账订单，无法打印空间小票',
      );
    }
    return this.mapOrder(saleOrder);
  }

  /**
   * 销售记录补打专用读取：在 loadOrder 之上再校验来源，绝不信任列表标记。
   *
   * - 必须真实关联同门店的空间会话：跨店 / 不存在 / 手工单 / 扫码点餐单一律 404，
   *   不泄露订单是否存在，也不会进入任何设备下发。
   * - 会话必须已结账、订单必须未退款，否则 400。
   */
  async loadSalesReceiptOrder(
    storeId: number,
    saleOrderId: number,
  ): Promise<SpacePrintOrder> {
    const saleOrder = await this.findSaleOrder(storeId, saleOrderId);
    if (!saleOrder) throw new NotFoundException('销售订单不存在');
    const session = saleOrder.spaceSession;
    if (!session) {
      throw new NotFoundException(
        '该销售订单不是空间结账订单，无法打印空间小票',
      );
    }
    if (session.storeId !== saleOrder.storeId) {
      // 会话挂在别家门店：按不存在处理，避免泄露订单归属
      throw new NotFoundException('销售订单不存在');
    }
    if (session.status !== 'settled') {
      throw new BadRequestException('该订单所在空间尚未结账，无法打印小票');
    }
    if (saleOrder.refund) {
      throw new BadRequestException('该订单已退款，无法打印小票');
    }
    return this.mapOrder(saleOrder);
  }

  /** 按当前门店查单，连带门店名、退款状态与空间会话明细（单次查询）。 */
  private findSaleOrder(
    storeId: number,
    saleOrderId: number,
  ): Promise<SpaceReceiptSaleOrder | null> {
    return this.prisma.saleOrder.findFirst({
      where: { id: saleOrderId, storeId },
      include: {
        store: { select: { name: true } },
        refund: { select: { refundedAt: true } },
        spaceSession: {
          include: {
            space: {
              select: {
                name: true,
                type: { select: { name: true } },
              },
            },
            sessionItems: {
              select: {
                productId: true,
                productName: true,
                salePrice: true,
                quantity: true,
                specNames: true,
                sourceType: true,
                sourceChannel: true,
              },
              orderBy: { sortOrder: 'asc' },
            },
          },
        },
      },
    });
  }

  /** 归一为打印结构（金额一律取落库数据，不按当前价/当前优惠重算）。 */
  private mapOrder(saleOrder: SpaceReceiptSaleOrder): SpacePrintOrder {
    const session = saleOrder.spaceSession;
    if (!session) {
      // 仅由 loadOrder / loadSalesReceiptOrder 在调用前保证，这里保留类型窄化
      throw new NotFoundException(
        '该销售订单不是空间结账订单，无法打印空间小票',
      );
    }

    const toYuan = (fen: number): number => fen / 100;
    const deductionTotals = {
      renew: 0,
      prepaid: 0,
      selfOrder: 0,
      card: 0,
      voucher: 0,
      net: 0,
    };
    for (const item of session.sessionItems) {
      const cents = item.salePrice * item.quantity;
      // 归一后只按「角色」累加：分栏与净额同源，不会出现只冲净额不进分栏的行。
      // 抵扣行（续费/预付/自助/卡）的落库符号由结账逻辑决定（正数），历史手工单可能
      // 是负数：分栏与净额一律按绝对额统计。否则负数行会被净额扣掉，却因模板只渲染
      // 大于零的抵扣而在票面消失——客人看不出这笔钱从哪扣的。
      const bucket = resolveReceiptItemBucket(item);
      const deductionCents = Math.abs(cents);
      if (
        bucket === 'renew' ||
        bucket === 'prepaid' ||
        bucket === 'selfOrder'
      ) {
        deductionTotals[bucket] += deductionCents;
        deductionTotals.net -= deductionCents;
      } else if (bucket === 'card') {
        deductionTotals.card += deductionCents;
        deductionTotals.net -= deductionCents;
      } else if (bucket === 'voucher') {
        // 券面消费行计营业额（客人已在 purelyClub 付过券钱），属于本次实付的一部分
        deductionTotals.voucher += cents;
        deductionTotals.net += cents;
      } else {
        // item / timeBilling：台位费是真实营收，与商品一样计入合计
        deductionTotals.net += cents;
      }
    }

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
      storeName: saleOrder.store.name,
      spaceName: session.space.name,
      spaceType: session.space.type.name,
      guestName: session.guestName,
      guestCount: session.guestCount,
      startTimeLabel: this.formatDateTime(session.startTime),
      endTimeLabel: this.formatDateTime(endTime),
      // 浏览器小票直接用落库时间戳；补打时间绝不参与票面
      startedAt: session.startTime.getTime(),
      settledAt: endTime.getTime(),
      durationLabel: this.formatDuration(session.startTime, endTime),
      billingModeLabel:
        BILLING_MODE_LABEL[session.billingMode] ?? session.billingMode,
      hourlyRate:
        session.hourlyRate == null ? null : toYuan(session.hourlyRate),
      timeCost: toYuan(session.timeCost ?? 0),
      timeFeeLabel,
      items: session.sessionItems
        // 与分栏/合计共用同一归类：系统行与历史抵扣行都不进商品明细
        .filter((item) => resolveReceiptItemBucket(item) === 'item')
        .map((item) => {
          const specNames = parseSpecNames(item.specNames);
          return {
            // 规格另起一行展示（对齐餐饮扫码点餐小票口径），故从商品名剥离后缀避免重复
            name: specNames
              ? stripSpecSuffix(item.productName)
              : item.productName,
            quantity: item.quantity,
            unitPrice: toYuan(item.salePrice),
            subtotal: toYuan(item.salePrice * item.quantity),
            sourceType: item.sourceType,
            sourceChannel: item.sourceChannel,
            ...(specNames ? { specNames } : {}),
          };
        }),
      itemsCost: toYuan(session.itemsCost),
      renewDeduction: toYuan(deductionTotals.renew),
      prepaidDeduction: toYuan(deductionTotals.prepaid),
      selfOrderDeduction: toYuan(deductionTotals.selfOrder),
      cardDeduction: toYuan(deductionTotals.card),
      voucherConsumption: toYuan(deductionTotals.voucher),
      // 客人本次实付 = 消费 − 已付抵扣（净额），与上方抵扣金额共用同一判定源：
      // 明细打印哪些行、抵扣汇总扣哪些行、合计怎么算，必须完全一致。
      // ⚠️ 不能直接用 saleOrder.totalRevenue：该列是营业额口径，纯消费券单已
      // 把券面计入（券面是门店营收但客人已在 purelyClub 付过），用它当合计会让
      // 小票明细加总（88）与合计（276.70）对不上。
      totalAmount: toYuan(deductionTotals.net),
      paymentMethod: saleOrder.paymentMethod,
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

  /** 格式化时长为「x小时y分钟 / y分钟 / 不足1分钟」（与前端 formatDurationLabel 对齐）。
   *  数字与汉字之间不留半角空格：热敏机中文模式下空格按全角宽度出纸，会拉出一个字的缝。 */
  private formatDuration(start: Date, end: Date): string {
    const sec = Math.floor((end.getTime() - start.getTime()) / 1000);
    if (sec < 60) return '不足1分钟';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return h > 0 ? `${h}小时${m > 0 ? `${m}分钟` : ''}`.trim() : `${m}分钟`;
  }
}

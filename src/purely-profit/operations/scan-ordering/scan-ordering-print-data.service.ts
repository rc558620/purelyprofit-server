import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  computeOrderDiscountAmountFen,
  fenToYuan,
  pointsDeductAmountFen,
  toDiscountItems,
} from '../../../purely-club/scan-ordering/club-scan-ordering-order.mapper';
import type { OrderDiscountItem } from '../../../purely-club/scan-ordering/club-scan-ordering-order.mapper';

/** 扫码点餐订单的打印归一结构（云打印与 USB 打印共用）。 */
export interface ScanOrderingPrintOrder {
  orderNo: string;
  /** 下单时间（Asia/Shanghai，格式 YYYY-MM-DD HH:mm，与前端预览一致）。 */
  createdAtLabel: string;
  pickupNumberLabel: string | null;
  tableName: string;
  remark: string | null;
  /** 商品原价合计（元，未扣任何优惠）。 */
  itemOriginalAmount: number;
  /** 规格加价合计（元）。 */
  specificationExtraAmount: number;
  /** 应付金额（元，两位小数文本）。 */
  payableAmount: string;
  /** 已优惠总额（元，后端按减法口径计算）。 */
  discountAmount: number;
  /** 积分抵扣金额（元，独立于优惠清单展示）。 */
  pointsDeductAmount: number;
  /** 优惠清单明细（后端从营销快照组装，负数为减免）。 */
  discountItems: OrderDiscountItem[];
  items: Array<{
    name: string;
    quantity: number;
    /** 单价（元，含规格加价）。 */
    unitPrice: number;
    /** 行小计（元，未扣商品级优惠）。 */
    lineTotalAmount: number;
    /** 行应付（元，已扣商品级优惠）。 */
    payableLineAmount: number;
    specs: Array<{ name: string }>;
  }>;
}

/**
 * 扫码点餐打印数据服务：查询订单并归一为打印所需结构，
 * 供飞鹅云打印通道与 USB 打印通道共用，避免重复查询逻辑。
 */
@Injectable()
export class ScanOrderingPrintDataService {
  constructor(private readonly prisma: PrismaService) {}

  /** 查询订单并归一为打印所需结构（含商品价格与优惠清单，金额均由后端计算）。 */
  async loadOrder(
    storeId: number,
    orderId: number,
  ): Promise<ScanOrderingPrintOrder> {
    const order = await this.prisma.scanOrders.findFirst({
      where: { id: orderId, storeId, deletedAt: null },
      include: {
        table: { select: { name: true } },
        items: { include: { specs: true }, orderBy: { id: 'asc' } },
      },
    });
    if (!order) throw new NotFoundException('扫码点餐订单不存在');
    const cents = (value: number): string => (value / 100).toFixed(2);
    return {
      orderNo: order.orderNo,
      createdAtLabel: this.formatOrderTime(order.createdAt),
      pickupNumberLabel: order.pickupNumber
        ? String(order.pickupNumber).padStart(3, '0')
        : null,
      tableName: order.table?.name ?? '-',
      remark: order.remark,
      itemOriginalAmount: fenToYuan(order.itemOriginalAmount),
      specificationExtraAmount: fenToYuan(order.specificationExtraAmount),
      payableAmount: cents(order.payableAmount),
      discountAmount: fenToYuan(computeOrderDiscountAmountFen(order)),
      pointsDeductAmount: fenToYuan(
        pointsDeductAmountFen(order.marketingSnapshot),
      ),
      discountItems: toDiscountItems(order.marketingSnapshot),
      items: order.items.map((item) => ({
        name: item.productNameSnapshot,
        quantity: item.quantity,
        unitPrice: fenToYuan(item.unitPriceAmount),
        lineTotalAmount: fenToYuan(item.lineTotalAmount),
        payableLineAmount: fenToYuan(item.payableLineAmount),
        specs: item.specs.map((spec) => ({
          name: spec.specOptionNameSnapshot,
        })),
      })),
    };
  }

  /** 格式化下单时间：Asia/Shanghai，YYYY-MM-DD HH:mm（与前端预览 formatScanOrderingDateTime 一致）。 */
  private formatOrderTime(createdAt: Date): string {
    const parts = new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(createdAt)
      .reduce<Record<string, string>>((result, part) => {
        result[part.type] = part.value;
        return result;
      }, {});
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
  }
}

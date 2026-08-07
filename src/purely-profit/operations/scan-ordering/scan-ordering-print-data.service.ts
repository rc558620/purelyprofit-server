import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

/** 扫码点餐订单的打印归一结构（云打印与 USB 打印共用）。 */
export interface ScanOrderingPrintOrder {
  orderNo: string;
  pickupNumberLabel: string | null;
  tableName: string;
  remark: string | null;
  payableAmount: string;
  items: Array<{
    name: string;
    quantity: number;
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

  /** 查询订单并归一为打印所需结构。 */
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
      pickupNumberLabel: order.pickupNumber
        ? String(order.pickupNumber).padStart(3, '0')
        : null,
      tableName: order.table?.name ?? '-',
      remark: order.remark,
      payableAmount: cents(order.payableAmount),
      items: order.items.map((item) => ({
        name: item.productNameSnapshot,
        quantity: item.quantity,
        specs: item.specs.map((spec) => ({
          name: spec.specOptionNameSnapshot,
        })),
      })),
    };
  }
}

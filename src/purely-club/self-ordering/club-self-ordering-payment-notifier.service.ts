import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ScanOrderingRealtimeService } from '../scan-ordering/scan-ordering-realtime.service';

/**
 * 支付成功广播的字段白名单。
 *
 * 广播体只消费订单级 11 列与明细的 (productName, quantity)，改前用
 * `include: { items: true }` 会把订单整行（含幂等键、删除标记、乐观锁审计列）
 * 与商品行整行（含成本价、规格签名等）全部拉回再丢弃——一次支付广播的
 * 无效 IO 与明细行数成正比，且落在支付链路的关键路径上。
 */
const SELF_ORDER_PAID_NOTIFY_SELECT = {
  id: true,
  storeId: true,
  orderNo: true,
  sessionId: true,
  spaceId: true,
  payableAmount: true,
  remark: true,
  paidAt: true,
  status: true,
  paymentStatus: true,
  version: true,
  items: {
    select: {
      productName: true,
      quantity: true,
    },
  },
} as const satisfies Prisma.SelfOrderSelect;

/**
 * 自助下单支付成功通知
 *
 * 负责事务提交后的商家端广播，与扫码点餐的时延约定一致：
 * 广播一律在事务外发起，避免出现「通知到了、事务却回滚」的幽灵订单。
 */
@Injectable()
export class ClubSelfOrderingPaymentNotifierService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtimeService: ScanOrderingRealtimeService,
  ) {}

  /**
   * 支付成功广播（必须在事务提交后调用）
   * 以订单当前状态为准：只有 paid 才广播，天然规避幂等重放时的重复通知
   *
   * 同时发 created 与 status_changed 两条事件，二者消费方不同：
   * - created → 商家端右下角新订单弹窗 + 语音；
   * - status_changed → 商家端列表 / 角标刷新，以及 C 端订单状态同步。
   * 只发 created 时，商家端列表里那笔订单会一直停在「待支付」直到手动刷新。
   */
  async broadcastOrderPaid(orderId: number): Promise<void> {
    const order = await this.prisma.selfOrder.findFirst({
      where: { id: orderId, status: 'paid', paymentStatus: 'paid' },
      select: SELF_ORDER_PAID_NOTIFY_SELECT,
    });
    if (!order) return;

    const space = await this.prisma.space.findUnique({
      where: { id: order.spaceId },
      select: {
        name: true,
        zone: { select: { name: true } },
        type: { select: { name: true } },
      },
    });
    // 位置标签与商家端「新的服务呼叫」通知一致：区域 · 类型 · 名称
    const spaceName = [space?.zone?.name, space?.type?.name, space?.name]
      .filter((part): part is string => Boolean(part))
      .join(' · ');

    this.realtimeService.publishSelfOrderCreated({
      storeId: order.storeId,
      orderId: order.id,
      orderNo: order.orderNo,
      sessionId: order.sessionId,
      spaceId: order.spaceId,
      spaceName,
      items: order.items.map((item) => ({
        productName: item.productName,
        quantity: item.quantity,
      })),
      amountFen: order.payableAmount,
      remark: order.remark,
      paidAt: (order.paidAt ?? new Date()).toISOString(),
    });

    this.realtimeService.publishSelfOrderStatusChanged({
      storeId: order.storeId,
      orderId: order.id,
      orderNo: order.orderNo,
      sessionId: order.sessionId,
      spaceId: order.spaceId,
      status: order.status,
      paymentStatus: order.paymentStatus,
      version: order.version,
    });
  }
}

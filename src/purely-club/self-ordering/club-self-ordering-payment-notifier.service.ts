import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ScanOrderingRealtimeService } from '../scan-ordering/scan-ordering-realtime.service';

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
   */
  async broadcastOrderPaid(orderId: number): Promise<void> {
    const order = await this.prisma.selfOrder.findFirst({
      where: { id: orderId, status: 'paid', paymentStatus: 'paid' },
      include: { items: true },
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
  }
}

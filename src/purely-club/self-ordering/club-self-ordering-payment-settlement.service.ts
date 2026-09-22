import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  PayableOrder,
  SettlePaidOrderParams,
} from './club-self-ordering-payment.types';
import { ClubSelfOrderingSessionBridgeService } from './club-self-ordering-session-bridge.service';
import { BALANCE_PAYMENT_CHANNEL } from './club-self-ordering.utils';

/**
 * 自助下单订单落账服务
 *
 * 三条支付路径（余额 / 微信回调 / 开发态确认）在事务内调用同一个 settlePaidOrder，
 * 保证「收钱」与「商品进空间账单」永远同一结局。
 */
@Injectable()
export class ClubSelfOrderingPaymentSettlementService {
  constructor(
    private readonly sessionBridge: ClubSelfOrderingSessionBridgeService,
  ) {}

  /**
   * 订单落账（必须在事务内调用）
   *
   * 1. 乐观锁把订单置为已支付（version CAS + 状态双重条件）
   * 2. 写入支付尝试记录
   * 3. 余额渠道额外写余额流水
   * 4. 商品行写入空间会话账单（幂等）
   */
  async settlePaidOrder(
    tx: Prisma.TransactionClient,
    order: PayableOrder,
    params: SettlePaidOrderParams,
  ): Promise<void> {
    const updated = await tx.selfOrder.updateMany({
      where: {
        id: order.id,
        version: order.version,
        status: 'pending_payment',
        paymentStatus: 'unpaid',
      },
      data: {
        status: 'paid',
        paymentStatus: 'paid',
        paidAmount: order.payableAmount,
        paidAt: new Date(),
        version: { increment: 1 },
      },
    });
    if (updated.count === 0) {
      throw new ConflictException('订单状态已变化，请刷新后重试');
    }

    await tx.selfOrderPaymentAttempt.upsert({
      where: { merchantPaymentNo: params.merchantPaymentNo },
      create: {
        orderId: order.id,
        paymentChannel: params.channel,
        merchantPaymentNo: params.merchantPaymentNo,
        amountFen: order.payableAmount,
        status: 'succeeded',
        transactionId: params.transactionId ?? null,
      },
      update: {
        status: 'succeeded',
        ...(params.transactionId
          ? { transactionId: params.transactionId }
          : {}),
      },
    });

    if (params.balanceTransaction) {
      await tx.selfOrderBalanceTransaction.upsert({
        where: { orderId_type: { orderId: order.id, type: 'payment' } },
        create: {
          orderId: order.id,
          customerId: params.balanceTransaction.customerId,
          amount: params.balanceTransaction.amount,
          type: 'payment',
        },
        update: {},
      });
    }

    await this.sessionBridge.appendPaidItemsToSession(tx, {
      sessionId: order.sessionId,
      orderNo: order.orderNo,
      sourceChannel:
        params.channel === BALANCE_PAYMENT_CHANNEL ? 'balance' : 'wechat',
      items: order.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        productName: item.productName,
        categoryName: item.categoryName,
        salePrice: item.salePrice,
        costPrice: item.costPrice,
        quantity: item.quantity,
        specSignature: item.specSignature ?? null,
        specNames: (item.specs ?? []).map(
          (spec) => spec.specOptionNameSnapshot,
        ),
      })),
    });

    // TODO(实时通知)：落账后广播 self_order.status_changed，驱动 purelyProfit 右下角弹窗。
    // 需先在 scan-ordering-realtime.service 增加 self_order 事件与房间，
    // 广播必须放在事务提交之后（与扫码点餐 publishOrderStatusChanged 的位置一致）。
  }
}

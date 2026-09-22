import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { SELF_ORDER_PAYMENT_TIMEOUT_MS } from './club-self-ordering-order.service';
import {
  IN_FLIGHT_ATTEMPT_STATUSES,
  SELF_ORDER_ATTEMPT_TTL_MS,
  type PayableOrder,
} from './club-self-ordering-payment.types';
import { WECHAT_PAYMENT_CHANNEL } from './club-self-ordering.utils';

/** 支付尝试定位信息（回调按商户单号路由时用于找订单） */
export interface SelfOrderPaymentAttemptRef {
  id: number;
  orderId: number;
  amountFen: number;
  status: string;
}

/**
 * 自助下单支付仓储
 *
 * 收拢「待支付订单查询」与「支付尝试读写」两类持久化细节，
 * 让支付编排只关注流程与状态机，不再直接拼 Prisma 条件。
 */
@Injectable()
export class ClubSelfOrderingPaymentRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** 加载待支付订单：归属 + 状态 + 超时三重校验 */
  async loadPayableOrder(
    user: AuthenticatedUser,
    orderId: number,
  ): Promise<PayableOrder> {
    const order = await this.prisma.selfOrder.findFirst({
      where: { id: orderId, clubUserId: user.id, deletedAt: null },
      include: { items: { include: { specs: true } } },
    });
    if (!order) throw new NotFoundException('订单不存在');
    if (
      order.status !== 'pending_payment' ||
      order.paymentStatus !== 'unpaid'
    ) {
      throw new ConflictException('订单状态已变化，请刷新后重试');
    }
    if (
      Date.now() - order.createdAt.getTime() >
      SELF_ORDER_PAYMENT_TIMEOUT_MS
    ) {
      throw new ConflictException('订单已超时，请重新下单');
    }
    return order;
  }

  /** 回读订单摘要（支付完成后的对外返回形态） */
  async findOrderSummary(
    user: AuthenticatedUser,
    orderId: number,
  ): Promise<Record<string, unknown>> {
    const order = await this.prisma.selfOrder.findFirst({
      where: { id: orderId, clubUserId: user.id, deletedAt: null },
      include: { items: true },
    });
    if (!order) throw new NotFoundException('订单不存在');
    return {
      id: order.id,
      orderNo: order.orderNo,
      sessionId: order.sessionId,
      spaceId: order.spaceId,
      status: order.status,
      paymentStatus: order.paymentStatus,
      payableAmount: order.payableAmount,
      paidAt: order.paidAt?.toISOString() ?? null,
      version: order.version,
    };
  }

  /** 按商户单号查支付尝试：支付回调以此定位订单与流水金额 */
  async findAttemptByMerchantPaymentNo(
    merchantPaymentNo: string,
  ): Promise<SelfOrderPaymentAttemptRef | null> {
    return this.prisma.selfOrderPaymentAttempt.findUnique({
      where: { merchantPaymentNo },
      select: { id: true, orderId: true, amountFen: true, status: true },
    });
  }

  /**
   * 事务内读取支付尝试与订单原文
   * 回调落账的金额二次校验、幂等短路、状态前置校验都基于这份快照
   */
  async loadSettlementContext(
    tx: Prisma.TransactionClient,
    attemptId: number,
    orderId: number,
  ): Promise<{
    paymentAttempt: { id: number; amountFen: number; status: string } | null;
    order: PayableOrder | null;
  }> {
    const paymentAttempt = await tx.selfOrderPaymentAttempt.findUnique({
      where: { id: attemptId },
    });
    const order = await tx.selfOrder.findFirst({
      where: { id: orderId },
      include: { items: { include: { specs: true } } },
    });
    return { paymentAttempt, order };
  }

  /** 回收超时的在途尝试：避免用户放弃收银台后同订单无法重试 */
  async expireStaleInFlightAttempts(orderId: number): Promise<void> {
    await this.prisma.selfOrderPaymentAttempt.updateMany({
      where: {
        orderId,
        status: { in: IN_FLIGHT_ATTEMPT_STATUSES },
        createdAt: { lt: new Date(Date.now() - SELF_ORDER_ATTEMPT_TTL_MS) },
      },
      data: {
        status: 'failed',
        failureReason: '支付尝试超时，已允许重新发起',
      },
    });
  }

  /** 是否存在在途尝试：存在则拒绝重复发起支付 */
  async hasInFlightAttempt(orderId: number): Promise<boolean> {
    const attempt = await this.prisma.selfOrderPaymentAttempt.findFirst({
      where: { orderId, status: { in: IN_FLIGHT_ATTEMPT_STATUSES } },
      select: { id: true },
    });
    return Boolean(attempt);
  }

  /**
   * 创建支付尝试
   * openid 缺失时登记 pending（等待开发态兜底），否则登记 paying 后去微信下单
   */
  async createAttempt(params: {
    orderId: number;
    merchantPaymentNo: string;
    amountFen: number;
    status: 'pending' | 'paying';
  }): Promise<void> {
    await this.prisma.selfOrderPaymentAttempt.create({
      data: {
        orderId: params.orderId,
        paymentChannel: WECHAT_PAYMENT_CHANNEL,
        merchantPaymentNo: params.merchantPaymentNo,
        amountFen: params.amountFen,
        status: params.status,
      },
    });
  }

  /** 微信下单成功：paying → created */
  async markAttemptCreated(merchantPaymentNo: string): Promise<void> {
    await this.prisma.selfOrderPaymentAttempt.updateMany({
      where: { merchantPaymentNo, status: 'paying' },
      data: { status: 'created' },
    });
  }

  /** 微信下单失败：paying → failed，并记录截断后的失败原因 */
  async markAttemptFailed(
    merchantPaymentNo: string,
    failureReason: string,
  ): Promise<void> {
    await this.prisma.selfOrderPaymentAttempt.updateMany({
      where: { merchantPaymentNo, status: 'paying' },
      data: { status: 'failed', failureReason },
    });
  }

  /** 开发态确认支付：把在途尝试一并置为成功，避免残留 pending 记录 */
  async markInFlightAttemptsSucceeded(
    tx: Prisma.TransactionClient,
    orderId: number,
    transactionId: string,
  ): Promise<void> {
    await tx.selfOrderPaymentAttempt.updateMany({
      where: { orderId, status: { in: IN_FLIGHT_ATTEMPT_STATUSES } },
      data: { status: 'succeeded', transactionId },
    });
  }

  /**
   * 订单已取消却收到支付成功回调：流水标记成功（事务正常提交，让微信停止重试），
   * 并写明待人工退款 —— 自助下单暂无自动退款服务（P2）
   */
  async markAttemptSucceededAwaitingRefund(
    tx: Prisma.TransactionClient,
    attemptId: number,
    transactionId: string,
  ): Promise<void> {
    await tx.selfOrderPaymentAttempt.update({
      where: { id: attemptId },
      data: {
        status: 'succeeded',
        transactionId,
        failureReason: '订单已取消，待人工退款',
      },
    });
  }

  /** 读取订单号：支付回调返回值需要它 */
  async findOrderNo(orderId: number): Promise<string> {
    const order = await this.prisma.selfOrder.findUnique({
      where: { id: orderId },
      select: { orderNo: true },
    });
    return order?.orderNo ?? '';
  }
}

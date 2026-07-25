import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { ScanOrderPaymentAttemptStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { ClubWechatJsapiService } from '../payments/club-wechat-jsapi.service';
import { ScanOrderingRealtimeService } from './scan-ordering-realtime.service';

/** C 端扫码点餐订单支付发起服务。 */
@Injectable()
export class ClubScanOrderingCheckoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wechatJsapiService: ClubWechatJsapiService,
    private readonly realtimeService: ScanOrderingRealtimeService,
    private readonly configService: ConfigService,
  ) {}

  async createWechatPayment(
    user: AuthenticatedUser,
    orderId: number,
    openid: string,
  ): Promise<unknown> {
    const order = await this.prisma.scanOrders.findFirst({
      where: {
        id: orderId,
        clubUserId: user.id,
        status: 'pending_payment',
        paymentStatus: 'unpaid',
        deletedAt: null,
        OR: [
          { paymentExpiresAt: null },
          { paymentExpiresAt: { gt: new Date() } },
        ],
      },
      select: {
        id: true,
        storeId: true,
        orderNo: true,
        payableAmount: true,
        paymentExpiresAt: true,
      },
    });
    if (!order) throw new ConflictException('订单不可支付或已过期');
    const activeAttempt = await this.prisma.scanOrderPaymentAttempt.findFirst({
      where: {
        orderId,
        status: {
          in: [
            ScanOrderPaymentAttemptStatus.created,
            ScanOrderPaymentAttemptStatus.paying,
          ],
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (activeAttempt)
      throw new ConflictException('支付请求正在处理中，请勿重复发起');

    const merchantPaymentNo = `${order.orderNo}-${randomBytes(4).toString('hex').toUpperCase()}`;
    const attempt = await this.prisma.scanOrderPaymentAttempt.create({
      data: {
        orderId: order.id,
        storeId: order.storeId,
        paymentChannel: 'wechat_jsapi',
        merchantPaymentNo,
        amount: order.payableAmount,
        status: ScanOrderPaymentAttemptStatus.paying,
        expiredAt: order.paymentExpiresAt,
      },
    });
    try {
      const paymentParams =
        await this.wechatJsapiService.createJsapiPaymentParams({
          storeId: order.storeId,
          orderNo: merchantPaymentNo,
          description: `扫码点餐订单 ${order.orderNo}`,
          amountFen: order.payableAmount,
          openid,
        });
      await this.prisma.scanOrderPaymentAttempt.update({
        where: { id: attempt.id },
        data: { status: ScanOrderPaymentAttemptStatus.created },
      });
      return { paymentAttemptId: attempt.id, merchantPaymentNo, paymentParams };
    } catch (error) {
      await this.prisma.scanOrderPaymentAttempt.updateMany({
        where: { id: attempt.id, status: ScanOrderPaymentAttemptStatus.paying },
        data: { status: ScanOrderPaymentAttemptStatus.failed },
      });
      throw error;
    }
  }

  async confirmPaidForDevelopment(
    user: AuthenticatedUser,
    orderId: number,
  ): Promise<unknown> {
    if (this.configService.get<string>('nodeEnv') === 'production') {
      throw new ForbiddenException('开发态支付确认接口在生产环境不可用');
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const order = await tx.scanOrders.findFirst({
        where: {
          id: orderId,
          clubUserId: user.id,
          status: 'pending_payment',
          paymentStatus: 'unpaid',
          deletedAt: null,
        },
      });
      if (!order) throw new ConflictException('订单不可确认支付');
      const paymentAttempt = await tx.scanOrderPaymentAttempt.findFirst({
        where: { orderId, status: { in: ['created', 'paying'] } },
        orderBy: { createdAt: 'desc' },
      });
      if (paymentAttempt) {
        await tx.scanOrderPaymentAttempt.update({
          where: { id: paymentAttempt.id },
          data: {
            status: ScanOrderPaymentAttemptStatus.succeeded,
            providerTransactionId: `dev-${order.orderNo}`,
            paidAt: new Date(),
          },
        });
      }
      const paidAt = new Date();
      const paidOrder = await tx.scanOrders.update({
        where: { id: order.id },
        data: {
          status: 'pending_acceptance',
          paymentStatus: 'paid',
          paidAmount: order.payableAmount,
          paidAt,
          version: { increment: 1 },
        },
      });
      await tx.scanOrderStatusHistory.create({
        data: {
          orderId: order.id,
          storeId: order.storeId,
          fromStatus: 'pending_payment',
          toStatus: 'pending_acceptance',
          operatorType: 'development_payment',
          operatorId: user.id,
          reason: '开发环境 H5 支付确认',
        },
      });
      return paidOrder;
    });
    this.realtimeService.publishOrderStatusChanged({
      storeId: updated.storeId,
      orderId: updated.id,
      sessionId: updated.sessionId,
      status: updated.status,
      paymentStatus: updated.paymentStatus,
      fulfillmentStatus: updated.fulfillmentStatus,
    });
    return this.getOrder(user, updated.id);
  }

  private async getOrder(
    user: AuthenticatedUser,
    orderId: number,
  ): Promise<unknown> {
    const order = await this.prisma.scanOrders.findFirst({
      where: { id: orderId, clubUserId: user.id, deletedAt: null },
      include: {
        items: { include: { specs: true }, orderBy: { sortOrder: 'asc' } },
        paymentAttempts: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    if (!order) throw new NotFoundException('订单不存在');
    return order;
  }
}

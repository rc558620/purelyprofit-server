// C 端扫码点餐订单支付发起服务。
//
// 职责边界：本文件只负责**微信 JSAPI 发起**与在途支付尝试的管理；
// 「当场扣款落账」（储值余额支付 / 开发态手动确认）在
// ClubScanOrderingBalanceCheckoutService —— 两者对失败的处理完全不同，
// 微信发起失败只是没拉起收银台，落账失败则涉及资金与状态机。
import { ConflictException, Injectable } from '@nestjs/common';
import {
  CLUB_SCAN_ORDERING_ERROR_CODE,
  clubScanOrderingError,
} from './club-scan-ordering.errors';
import { randomBytes } from 'node:crypto';
import { ScanOrderPaymentAttemptStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { ClubWechatJsapiService } from '../payments/club-wechat-jsapi.service';
import { CLUB_CHANNEL_WECHAT_JSAPI } from '../payments/club-payment-channels.constants';
import { ClubWechatOpenidService } from '../payments/club-wechat-openid.service';
import { ClubScanOrderingBalanceCheckoutService } from './club-scan-ordering-balance-checkout.service';
import { ClubScanOrderingDevelopmentCheckoutService } from './club-scan-ordering-development-checkout.service';

/** 在途支付尝试回收阈值：超过该时长仍处 created/paying 的尝试视为已放弃 */
const SCAN_PAYMENT_ATTEMPT_TTL_MS = 5 * 60 * 1000;

/** 可发起微信支付的订单字段 */
interface PayableScanOrder {
  id: number;
  storeId: number;
  orderNo: string;
  payableAmount: number;
  paymentExpiresAt: Date | null;
}

@Injectable()
export class ClubScanOrderingCheckoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wechatJsapiService: ClubWechatJsapiService,
    private readonly clubWechatOpenidService: ClubWechatOpenidService,
    private readonly balanceCheckoutService: ClubScanOrderingBalanceCheckoutService,
    private readonly developmentCheckoutService: ClubScanOrderingDevelopmentCheckoutService,
  ) {}

  /** 发起微信 JSAPI 支付：占用一笔在途支付尝试并换取收银台参数 */
  async createWechatPayment(
    user: AuthenticatedUser,
    orderId: number,
    openid?: string,
  ): Promise<unknown> {
    const order = await this.loadPayableOrder(user.id, orderId);
    await this.closeStaleAttempts(orderId);
    await this.assertNoActiveAttempt(orderId);

    const merchantPaymentNo = `${order.orderNo}-${randomBytes(4).toString('hex').toUpperCase()}`;
    const attempt = await this.prisma.scanOrderPaymentAttempt.create({
      data: {
        orderId: order.id,
        storeId: order.storeId,
        paymentChannel: CLUB_CHANNEL_WECHAT_JSAPI,
        merchantPaymentNo,
        amount: order.payableAmount,
        status: ScanOrderPaymentAttemptStatus.paying,
        expiredAt: order.paymentExpiresAt,
      },
    });

    // openid 显式传入优先，未传则按 userId 回查 users.wechat_openid。
    // 仍解析不到时不调起真实微信支付，仅保留一笔本地尝试并返回空 paymentParams；
    // 注意 confirm-paid 兜底在生产已被禁用，此分支在生产等同于支付不可用。
    const resolvedOpenid = await this.clubWechatOpenidService.resolveOpenid(
      user.id,
      openid,
    );
    if (!resolvedOpenid) {
      await this.markAttempt(attempt.id, ScanOrderPaymentAttemptStatus.created);
      return { paymentAttemptId: attempt.id, merchantPaymentNo };
    }

    return this.requestJsapiParams(
      order,
      attempt.id,
      merchantPaymentNo,
      resolvedOpenid,
    );
  }

  /** 储值余额支付：落账链路在独立 service（当场扣款 + 状态推进同一事务） */
  createBalancePayment(
    user: AuthenticatedUser,
    orderId: number,
    version: number,
  ): Promise<unknown> {
    return this.balanceCheckoutService.createBalancePayment(
      user,
      orderId,
      version,
    );
  }

  /** 开发态手动确认支付：闸门与落账由独立 service 裁决 */
  confirmPaidForDevelopment(
    user: AuthenticatedUser,
    orderId: number,
  ): Promise<unknown> {
    return this.developmentCheckoutService.confirmPaidForDevelopment(
      user,
      orderId,
    );
  }

  // ─── 微信发起步骤 ─────────────────────────────────────────────────────────

  private async loadPayableOrder(
    userId: number,
    orderId: number,
  ): Promise<PayableScanOrder> {
    const order = await this.prisma.scanOrders.findFirst({
      where: {
        id: orderId,
        clubUserId: userId,
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
    if (!order)
      throw new ConflictException(
        clubScanOrderingError(
          CLUB_SCAN_ORDERING_ERROR_CODE.STATUS_ORDER_NOT_PAYABLE,
          '订单不可支付或已过期',
        ),
      );
    return order;
  }

  /**
   * 回收超时仍在途的尝试，避免用户放弃收银台后同订单长期无法重试。
   * 真实微信支付回调会按 merchantPaymentNo 幂等落账，回收不会造成重复结算。
   */
  private async closeStaleAttempts(orderId: number): Promise<void> {
    await this.prisma.scanOrderPaymentAttempt.updateMany({
      where: {
        orderId,
        status: {
          in: [
            ScanOrderPaymentAttemptStatus.created,
            ScanOrderPaymentAttemptStatus.paying,
          ],
        },
        createdAt: { lt: new Date(Date.now() - SCAN_PAYMENT_ATTEMPT_TTL_MS) },
      },
      data: { status: ScanOrderPaymentAttemptStatus.failed },
    });
  }

  /** 同一订单同时只允许一笔在途支付尝试，避免重复拉起收银台 */
  private async assertNoActiveAttempt(orderId: number): Promise<void> {
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
    if (activeAttempt) {
      throw new ConflictException(
        clubScanOrderingError(
          CLUB_SCAN_ORDERING_ERROR_CODE.STATUS_PAYMENT_IN_FLIGHT,
          '支付请求正在处理中，请勿重复发起',
        ),
      );
    }
  }

  /**
   * 换取 JSAPI 收银台参数。
   *
   * 下单失败时把本次尝试标记 failed：否则这笔 paying 记录会把订单锁在
   * 「支付请求正在处理中」直到 TTL 过期，用户连重试都做不到。
   */
  private async requestJsapiParams(
    order: PayableScanOrder,
    attemptId: number,
    merchantPaymentNo: string,
    openid: string,
  ): Promise<unknown> {
    try {
      const paymentParams =
        await this.wechatJsapiService.createJsapiPaymentParams({
          storeId: order.storeId,
          orderNo: merchantPaymentNo,
          description: `扫码点餐订单 ${order.orderNo}`,
          amountFen: order.payableAmount,
          openid,
        });
      await this.markAttempt(attemptId, ScanOrderPaymentAttemptStatus.created);
      return { paymentAttemptId: attemptId, merchantPaymentNo, paymentParams };
    } catch (error) {
      await this.prisma.scanOrderPaymentAttempt.updateMany({
        where: { id: attemptId, status: ScanOrderPaymentAttemptStatus.paying },
        data: { status: ScanOrderPaymentAttemptStatus.failed },
      });
      throw error;
    }
  }

  private async markAttempt(
    attemptId: number,
    status: ScanOrderPaymentAttemptStatus,
  ): Promise<void> {
    await this.prisma.scanOrderPaymentAttempt.update({
      where: { id: attemptId },
      data: { status },
    });
  }
}

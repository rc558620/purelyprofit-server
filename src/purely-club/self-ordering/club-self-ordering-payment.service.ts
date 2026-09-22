import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService, TX_TIMEOUT_MEDIUM } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import type { ClubWechatPaymentParamsDto } from '../orders/dto/club-order.dto';
import type {
  ClubPaymentCallbackResult,
  ClubPaymentCallbackSettlementParams,
} from '../payments/club-payments.types';
import { ClubPaymentLockService } from '../payments/club-payment-lock.service';
import { ClubWechatJsapiService } from '../payments/club-wechat-jsapi.service';
import { ClubScanOrderingMarketingCustomerService } from '../scan-ordering/club-scan-ordering-marketing-customer.service';
import { ClubSelfOrderingPaymentNotifierService } from './club-self-ordering-payment-notifier.service';
import { ClubSelfOrderingPaymentRepository } from './club-self-ordering-payment.repository';
import { ClubSelfOrderingPaymentSettlementService } from './club-self-ordering-payment-settlement.service';
import {
  BALANCE_PAYMENT_CHANNEL,
  WECHAT_PAYMENT_CHANNEL,
  createMerchantPaymentNo,
} from './club-self-ordering.utils';

/** 分布式锁键：与订单维度保持一致，落账与回调共用同一把锁 */
const buildOrderLockKey = (orderId: number): string => `self-order:${orderId}`;

/**
 * 自助下单支付服务
 *
 * 三条支付路径共用同一套落账逻辑（ClubSelfOrderingPaymentSettlementService）：
 * - 余额支付：同步扣减储值余额后落账
 * - 微信支付：仅创建支付尝试，真实落账由支付回调驱动
 * - 开发态确认：不扣余额，直接落账（营业执照/商户号未就绪时用于打通流程，生产禁用）
 *
 * 落账的关键动作是「订单置为已支付」+「商品行写入空间会话账单」，两者在同一事务内。
 * 持久化细节交给 ClubSelfOrderingPaymentRepository，事务提交后的通知交给
 * ClubSelfOrderingPaymentNotifierService，本类只编排流程与状态机。
 */
@Injectable()
export class ClubSelfOrderingPaymentService {
  private readonly logger = new Logger(ClubSelfOrderingPaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly paymentLockService: ClubPaymentLockService,
    private readonly wechatJsapiService: ClubWechatJsapiService,
    private readonly marketingCustomerService: ClubScanOrderingMarketingCustomerService,
    private readonly paymentRepository: ClubSelfOrderingPaymentRepository,
    private readonly settlementService: ClubSelfOrderingPaymentSettlementService,
    private readonly notifier: ClubSelfOrderingPaymentNotifierService,
  ) {}

  /** 余额支付：扣减储值余额并落账 */
  async createBalancePayment(
    user: AuthenticatedUser,
    orderId: number,
  ): Promise<Record<string, unknown>> {
    const order = await this.paymentRepository.loadPayableOrder(user, orderId);
    const customer = await this.marketingCustomerService.resolveActiveCustomer(
      order.storeId,
      user.id,
    );

    let settled = false;
    await this.paymentLockService.withOrderLock(
      buildOrderLockKey(orderId),
      () =>
        this.prisma.$transaction(
          async (tx) => {
            // 条件扣减：靠 balance >= 应付额 的原子条件避免「先查后判」的并发超扣
            const debited = await tx.marketingCustomer.updateMany({
              where: {
                id: customer.id,
                storeId: order.storeId,
                balance: { gte: order.payableAmount },
                status: 'active',
                deletedAt: null,
              },
              data: { balance: { decrement: order.payableAmount } },
            });
            if (debited.count === 0) {
              throw new ConflictException('储值余额不足');
            }

            await this.settlementService.settlePaidOrder(tx, order, {
              channel: BALANCE_PAYMENT_CHANNEL,
              merchantPaymentNo: `BAL-${order.orderNo}`,
              balanceTransaction: {
                customerId: customer.id,
                amount: order.payableAmount,
              },
            });
            settled = true;
          },
          { timeout: TX_TIMEOUT_MEDIUM },
        ),
    );
    if (settled) await this.notifier.broadcastOrderPaid(orderId);

    return this.paymentRepository.findOrderSummary(user, orderId);
  }

  /**
   * 微信支付：创建支付尝试并返回拉起支付的参数
   *
   * openid 缺省时不下单（商户号/营业执照未就绪），paymentParams 返回 undefined，
   * 前端据此走开发态 confirm-paid 兜底，保证端到端流程仍可跑通。
   */
  async createWechatPayment(
    user: AuthenticatedUser,
    orderId: number,
    openid?: string,
  ): Promise<{
    merchantPaymentNo: string;
    paymentParams?: ClubWechatPaymentParamsDto;
  }> {
    const order = await this.paymentRepository.loadPayableOrder(user, orderId);

    // 回收过期在途尝试：避免用户放弃收银台后同订单无法重试
    await this.paymentRepository.expireStaleInFlightAttempts(orderId);
    if (await this.paymentRepository.hasInFlightAttempt(orderId)) {
      throw new ConflictException('支付请求正在处理中，请勿重复发起');
    }

    const merchantPaymentNo = createMerchantPaymentNo(order.orderNo);
    await this.paymentRepository.createAttempt({
      orderId: order.id,
      merchantPaymentNo,
      amountFen: order.payableAmount,
      status: openid ? 'paying' : 'pending',
    });

    if (!openid) {
      return { merchantPaymentNo, paymentParams: undefined };
    }

    try {
      const paymentParams =
        await this.wechatJsapiService.createJsapiPaymentParams({
          storeId: order.storeId,
          orderNo: merchantPaymentNo,
          description: `自助下单 ${order.orderNo}`,
          amountFen: order.payableAmount,
          openid,
        });
      await this.paymentRepository.markAttemptCreated(merchantPaymentNo);
      return { merchantPaymentNo, paymentParams };
    } catch (error) {
      await this.paymentRepository.markAttemptFailed(
        merchantPaymentNo,
        error instanceof Error ? error.message.slice(0, 200) : '微信下单失败',
      );
      throw error;
    }
  }

  /** 开发态确认支付：不扣余额，直接落账；生产环境禁用 */
  async confirmPaidForDevelopment(
    user: AuthenticatedUser,
    orderId: number,
  ): Promise<Record<string, unknown>> {
    if (this.configService.get<string>('nodeEnv') === 'production') {
      throw new ForbiddenException('开发态支付确认接口在生产环境不可用');
    }

    const order = await this.paymentRepository.loadPayableOrder(user, orderId);

    let settled = false;
    await this.paymentLockService.withOrderLock(
      buildOrderLockKey(orderId),
      () =>
        this.prisma.$transaction(
          async (tx) => {
            // 把在途的支付尝试一并置为成功，避免残留 pending 记录
            await this.paymentRepository.markInFlightAttemptsSucceeded(
              tx,
              orderId,
              `dev-${order.orderNo}`,
            );

            await this.settlementService.settlePaidOrder(tx, order, {
              channel: WECHAT_PAYMENT_CHANNEL,
              merchantPaymentNo: `DEV-${order.orderNo}`,
            });
            settled = true;
          },
          { timeout: TX_TIMEOUT_MEDIUM },
        ),
    );
    if (settled) await this.notifier.broadcastOrderPaid(orderId);

    return this.paymentRepository.findOrderSummary(user, orderId);
  }

  /**
   * 微信支付回调落账（由 ClubPaymentCallbackDispatchService 按 SF 前缀路由进来）
   *
   * 与扫码点餐同一套防护：金额预校验 → 分布式锁 → 事务内二次校验 → 幂等短路 → 落账。
   * 落账复用 settlePaidOrder，与余额支付 / 开发态确认完全一致：
   * 订单置为已支付 + 商品写入空间账单，两者在同一事务内。
   */
  async confirmOrderPaidByCallback(
    merchantPaymentNo: string,
    params: ClubPaymentCallbackSettlementParams,
  ): Promise<ClubPaymentCallbackResult> {
    const attempt =
      await this.paymentRepository.findAttemptByMerchantPaymentNo(
        merchantPaymentNo,
      );
    if (!attempt) throw new NotFoundException('自助下单支付流水不存在');
    // 锁前金额预校验：金额不符直接拒绝，避免无谓占用分布式锁
    if (attempt.amountFen !== params.amountFen) {
      throw new ConflictException('微信支付金额与自助下单订单不一致');
    }
    const { id: attemptId, orderId } = attempt;

    let settledNow = false;
    await this.paymentLockService.withOrderLock(
      buildOrderLockKey(orderId),
      () =>
        this.prisma.$transaction(
          async (tx) => {
            const { paymentAttempt, order } =
              await this.paymentRepository.loadSettlementContext(
                tx,
                attemptId,
                orderId,
              );
            if (!paymentAttempt || !order) {
              throw new NotFoundException('自助下单订单或支付流水不存在');
            }
            // 事务内二次校验：流水金额与订单应付金额都必须与回调一致
            if (
              paymentAttempt.amountFen !== params.amountFen ||
              order.payableAmount !== params.amountFen
            ) {
              throw new ConflictException('微信支付金额与自助下单订单不一致');
            }

            // 幂等：回调重复触发时直接返回，不重复落账、不重复写入空间账单
            if (
              paymentAttempt.status === 'succeeded' &&
              order.paymentStatus === 'paid'
            ) {
              return;
            }

            // 订单已取消却收到支付成功回调：
            // 事务正常提交（让微信停止重试），记录告警等待人工退款 —— 自助下单暂无自动退款服务（P2）
            if (order.status === 'cancelled') {
              this.logger.error(
                `[自助下单] ${order.orderNo} 已取消却收到支付成功回调，需人工退款 ` +
                  `transactionId=${params.transactionId}`,
              );
              await this.paymentRepository.markAttemptSucceededAwaitingRefund(
                tx,
                attemptId,
                params.transactionId,
              );
              return;
            }

            if (
              order.status !== 'pending_payment' ||
              order.paymentStatus !== 'unpaid'
            ) {
              throw new ConflictException('自助下单订单状态不允许确认支付');
            }

            await this.settlementService.settlePaidOrder(tx, order, {
              channel: WECHAT_PAYMENT_CHANNEL,
              merchantPaymentNo,
              transactionId: params.transactionId,
            });
            settledNow = true;
          },
          { timeout: TX_TIMEOUT_MEDIUM },
        ),
    );

    if (settledNow) await this.notifier.broadcastOrderPaid(orderId);

    return {
      orderNo: await this.paymentRepository.findOrderNo(orderId),
      orderType: 'self_ordering',
      status: 'paid',
    };
  }
}

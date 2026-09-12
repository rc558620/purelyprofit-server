import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
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
import { ScanOrderingRealtimeService } from '../scan-ordering/scan-ordering-realtime.service';
import { ClubSelfOrderingSessionBridgeService } from './club-self-ordering-session-bridge.service';
import { SELF_ORDER_PAYMENT_TIMEOUT_MS } from './club-self-ordering-order.service';
import {
  BALANCE_PAYMENT_CHANNEL,
  WECHAT_PAYMENT_CHANNEL,
  createMerchantPaymentNo,
} from './club-self-ordering.utils';

/**
 * 待支付订单（含商品行快照）
 *
 * 显式声明结构而非引用 Prisma.SelfOrderGetPayload：该工具类型来自生成期 client，
 * Prisma 重新生成 / pnpm 路径变化时 IDE 的 TS Server 常因缓存滞后误报「不存在」
 * （命令行 tsc 实际通过）。TS 结构化类型下，查询返回的超集对象可直接赋值，
 * 显式声明对这类生成时序问题免疫，同时保留关键字段的显式契约。
 */
interface PayableOrder {
  id: number;
  orderNo: string;
  storeId: number;
  sessionId: number;
  spaceId: number;
  clubUserId: number;
  remark: string | null;
  /** 商品合计（分）；无优惠场景恒等于应付金额 */
  itemTotalAmount: number;
  /** 应付金额（分） */
  payableAmount: number;
  paidAmount: number;
  status: string;
  paymentStatus: string;
  /** 乐观锁版本：落账时做 CAS 条件更新 */
  version: number;
  paidAt: Date | null;
  createdAt: Date;
  items: Array<{
    id: number;
    productId: string;
    productName: string;
    categoryName: string | null;
    /** 销售单价快照（分） */
    salePrice: number;
    /** 成本单价快照（分） */
    costPrice: number;
    quantity: number;
    /** 规格签名（选项 ID 升序 sha256）；无规格时为 null */
    specSignature: string | null;
    /** 规格明细（落库快照，用于取规格名写入空间账单） */
    specs: Array<{ specOptionNameSnapshot: string }>;
  }>;
}

/** 微信支付在途状态：存在其中任一即拒绝重复发起 */
const IN_FLIGHT_ATTEMPT_STATUSES = ['pending', 'paying', 'created'];

/**
 * 在途支付尝试的存活时限：超过后允许重新发起支付。
 * 用户拉起微信收银台后放弃/切后台时，旧尝试会一直停留 created/paying，
 * 若不过期将阻塞同订单重试（409 直到订单超时）。微信侧即使迟到支付成功，
 * 回调仍能凭 merchantPaymentNo 幂等落账，不会被该清理误伤。
 */
const SELF_ORDER_ATTEMPT_TTL_MS = 5 * 60 * 1000;

/**
 * 自助下单支付服务
 *
 * 三条支付路径共用同一套落账逻辑 settlePaidOrder：
 * - 余额支付：同步扣减储值余额后落账
 * - 微信支付：仅创建支付尝试，真实落账由支付回调驱动（回调路由尚在下一步实现）
 * - 开发态确认：不扣余额，直接落账（营业执照/商户号未就绪时用于打通流程，生产禁用）
 *
 * 落账的关键动作是「订单置为已支付」+「商品行写入空间会话账单」，两者在同一事务内。
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
    private readonly sessionBridge: ClubSelfOrderingSessionBridgeService,
    private readonly realtimeService: ScanOrderingRealtimeService,
  ) {}

  /** 余额支付：扣减储值余额并落账 */
  async createBalancePayment(
    user: AuthenticatedUser,
    orderId: number,
  ): Promise<Record<string, unknown>> {
    const order = await this.loadPayableOrder(user, orderId);
    const customer = await this.marketingCustomerService.resolveActiveCustomer(
      order.storeId,
      user.id,
    );

    let settled = false;
    await this.paymentLockService.withOrderLock(`self-order:${orderId}`, () =>
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

          await this.settlePaidOrder(tx, order, {
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
    if (settled) await this.broadcastOrderPaid(orderId);

    return this.findOrder(user, orderId);
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
    const order = await this.loadPayableOrder(user, orderId);

    // 回收过期在途尝试：避免用户放弃收银台后同订单无法重试
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

    const inFlight = await this.prisma.selfOrderPaymentAttempt.findFirst({
      where: { orderId, status: { in: IN_FLIGHT_ATTEMPT_STATUSES } },
      select: { id: true },
    });
    if (inFlight) {
      throw new ConflictException('支付请求正在处理中，请勿重复发起');
    }

    const merchantPaymentNo = createMerchantPaymentNo(order.orderNo);

    if (!openid) {
      await this.prisma.selfOrderPaymentAttempt.create({
        data: {
          orderId: order.id,
          paymentChannel: WECHAT_PAYMENT_CHANNEL,
          merchantPaymentNo,
          amountFen: order.payableAmount,
          status: 'pending',
        },
      });
      return { merchantPaymentNo, paymentParams: undefined };
    }

    await this.prisma.selfOrderPaymentAttempt.create({
      data: {
        orderId: order.id,
        paymentChannel: WECHAT_PAYMENT_CHANNEL,
        merchantPaymentNo,
        amountFen: order.payableAmount,
        status: 'paying',
      },
    });

    try {
      const paymentParams =
        await this.wechatJsapiService.createJsapiPaymentParams({
          storeId: order.storeId,
          orderNo: merchantPaymentNo,
          description: `自助下单 ${order.orderNo}`,
          amountFen: order.payableAmount,
          openid,
        });
      await this.prisma.selfOrderPaymentAttempt.updateMany({
        where: { merchantPaymentNo, status: 'paying' },
        data: { status: 'created' },
      });
      return { merchantPaymentNo, paymentParams };
    } catch (error) {
      await this.prisma.selfOrderPaymentAttempt.updateMany({
        where: { merchantPaymentNo, status: 'paying' },
        data: {
          status: 'failed',
          failureReason:
            error instanceof Error
              ? error.message.slice(0, 200)
              : '微信下单失败',
        },
      });
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

    const order = await this.loadPayableOrder(user, orderId);

    let settled = false;
    await this.paymentLockService.withOrderLock(`self-order:${orderId}`, () =>
      this.prisma.$transaction(
        async (tx) => {
          // 把在途的支付尝试一并置为成功，避免残留 pending 记录
          await tx.selfOrderPaymentAttempt.updateMany({
            where: { orderId, status: { in: IN_FLIGHT_ATTEMPT_STATUSES } },
            data: {
              status: 'succeeded',
              transactionId: `dev-${order.orderNo}`,
            },
          });

          await this.settlePaidOrder(tx, order, {
            channel: WECHAT_PAYMENT_CHANNEL,
            merchantPaymentNo: `DEV-${order.orderNo}`,
          });
          settled = true;
        },
        { timeout: TX_TIMEOUT_MEDIUM },
      ),
    );
    if (settled) await this.broadcastOrderPaid(orderId);

    return this.findOrder(user, orderId);
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
    const attempt = await this.prisma.selfOrderPaymentAttempt.findUnique({
      where: { merchantPaymentNo },
      select: { id: true, orderId: true, amountFen: true, status: true },
    });
    if (!attempt) throw new NotFoundException('自助下单支付流水不存在');
    // 锁前金额预校验：金额不符直接拒绝，避免无谓占用分布式锁
    if (attempt.amountFen !== params.amountFen) {
      throw new ConflictException('微信支付金额与自助下单订单不一致');
    }

    let settledNow = false;
    await this.paymentLockService.withOrderLock(
      `self-order:${attempt.orderId}`,
      () =>
        this.prisma.$transaction(
          async (tx) => {
            const paymentAttempt = await tx.selfOrderPaymentAttempt.findUnique({
              where: { id: attempt.id },
            });
            const order = await tx.selfOrder.findFirst({
              where: { id: attempt.orderId },
              include: { items: { include: { specs: true } } },
            });
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
              await tx.selfOrderPaymentAttempt.update({
                where: { id: paymentAttempt.id },
                data: {
                  status: 'succeeded',
                  transactionId: params.transactionId,
                  failureReason: '订单已取消，待人工退款',
                },
              });
              return;
            }

            if (
              order.status !== 'pending_payment' ||
              order.paymentStatus !== 'unpaid'
            ) {
              throw new ConflictException('自助下单订单状态不允许确认支付');
            }

            await this.settlePaidOrder(tx, order, {
              channel: WECHAT_PAYMENT_CHANNEL,
              merchantPaymentNo,
              transactionId: params.transactionId,
            });
            settledNow = true;
          },
          { timeout: TX_TIMEOUT_MEDIUM },
        ),
    );

    if (settledNow) await this.broadcastOrderPaid(attempt.orderId);

    const paidOrder = await this.prisma.selfOrder.findUnique({
      where: { id: attempt.orderId },
      select: { orderNo: true },
    });
    return {
      orderNo: paidOrder?.orderNo ?? '',
      orderType: 'self_ordering',
      status: 'paid',
    };
  }

  /**
   * 支付成功广播（必须在事务提交后调用）
   * 以订单当前状态为准：只有 paid 才广播，天然规避幂等重放时的重复通知
   */
  private async broadcastOrderPaid(orderId: number): Promise<void> {
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

  /**
   * 订单落账（必须在事务内调用）
   *
   * 1. 乐观锁把订单置为已支付（version CAS + 状态双重条件）
   * 2. 写入支付尝试记录
   * 3. 余额渠道额外写余额流水
   * 4. 商品行写入空间会话账单（幂等）
   */
  private async settlePaidOrder(
    tx: Prisma.TransactionClient,
    order: PayableOrder,
    params: {
      channel: string;
      merchantPaymentNo: string;
      /** 微信支付流水号（回调落账时传入，余额/开发态确认为空） */
      transactionId?: string;
      balanceTransaction?: { customerId: number; amount: number };
    },
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

  /** 加载待支付订单：归属 + 状态 + 超时三重校验 */
  private async loadPayableOrder(
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

  private async findOrder(
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
}

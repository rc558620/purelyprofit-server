import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService, TX_TIMEOUT_MEDIUM } from '../../prisma/prisma.service';
import type { PrismaExecutor } from '../member/platform-membership/platform-membership.types';

/** 支付单有效期（秒）：与短信充值订单同口径，超时后由轮询惰性置 closed */
const PLATFORM_PAYMENT_ORDER_TTL_SECONDS = 15 * 60;

/** 各业务的支付单号前缀（与既有 SM / QUOTA 等本地单号区分开，便于对账识别） */
const PLATFORM_PAYMENT_NO_PREFIX = {
  membership: 'PM',
  new_customer_quota: 'PQ',
  sms_recharge: 'PS',
} as const;

export interface CreatePlatformPaymentOrderParams {
  bizType: keyof typeof PLATFORM_PAYMENT_NO_PREFIX;
  storeId: number;
  operatorUserId: number;
  /** 应付金额（分），由后端业务计算，前端不得提供 */
  amountFen: number;
  /** 下单时的支付模式：测试单必须与真实单可区分 */
  payMode: 'test' | 'live';
  /** 关联的业务单据（会员订单 ID / 额度流水单号等） */
  bizOrderId?: string;
  /** 复用的事务客户端 */
  executor?: PrismaExecutor;
}

export interface PlatformPaymentOrderView {
  orderNo: string;
  bizType: string;
  bizOrderId: string | null;
  storeId: number;
  amountFen: number;
  payMode: string;
  status: string;
  codeUrl: string | null;
  expiresAt: Date;
}

/** 生成支付单号：业务前缀 + 时间戳 + 随机串，保证同商户号下唯一 */
function buildPlatformPaymentOrderNo(
  bizType: keyof typeof PLATFORM_PAYMENT_NO_PREFIX,
  now: Date,
): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  const stamp =
    `${now.getFullYear()}` +
    `${pad(now.getMonth() + 1)}` +
    `${pad(now.getDate())}` +
    `${pad(now.getHours())}` +
    `${pad(now.getMinutes())}` +
    `${pad(now.getSeconds())}`;

  return `${PLATFORM_PAYMENT_NO_PREFIX[bizType]}${stamp}${randomBytes(2).toString('hex').toUpperCase()}`;
}

/**
 * 平台收款支付单服务。
 *
 * 只负责「钱」这一侧的状态机：创建 → 挂 codeUrl → 回调置 paid → 超时置 closed。
 * 业务结果（开通会员、加额度）由各业务模块在自己的事务里完成，
 * 两边靠 orderNo 关联，避免把支付状态与业务状态揉在一张表里。
 */
@Injectable()
export class PlatformPaymentOrderService {
  private readonly logger = new Logger(PlatformPaymentOrderService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** 创建支付单（pending）。真实模式下随后由调用方拿单号去换 codeUrl */
  async createOrder(
    params: CreatePlatformPaymentOrderParams,
  ): Promise<PlatformPaymentOrderView> {
    const executor = params.executor ?? this.prisma;
    const now = new Date();

    const created = await executor.platformPaymentOrder.create({
      data: {
        orderNo: buildPlatformPaymentOrderNo(params.bizType, now),
        bizType: params.bizType,
        bizOrderId: params.bizOrderId ?? null,
        storeId: params.storeId,
        operatorUserId: params.operatorUserId,
        amountFen: params.amountFen,
        payMode: params.payMode,
        expiresAt: new Date(
          now.getTime() + PLATFORM_PAYMENT_ORDER_TTL_SECONDS * 1000,
        ),
      },
      select: {
        orderNo: true,
        bizType: true,
        bizOrderId: true,
        storeId: true,
        amountFen: true,
        payMode: true,
        status: true,
        codeUrl: true,
        expiresAt: true,
      },
    });

    return created;
  }

  /** 写入微信返回的二维码链接 */
  async attachCodeUrl(
    orderNo: string,
    codeUrl: string,
    executor?: PrismaExecutor,
  ): Promise<void> {
    await (executor ?? this.prisma).platformPaymentOrder.update({
      where: { orderNo },
      data: { codeUrl },
    });
  }

  /**
   * 置为已支付。
   *
   * 幂等靠「带状态条件的 updateMany」：微信会重复投递同一笔回调，
   * 影响行数为 0 说明这单已经被处理过（或状态非法），直接返回 false 让上层跳过入账。
   */
  async markPaid(params: {
    orderNo: string;
    transactionId: string;
    executor?: PrismaExecutor;
  }): Promise<boolean> {
    const executor = params.executor ?? this.prisma;

    const updated = await executor.platformPaymentOrder.updateMany({
      where: { orderNo: params.orderNo, status: { not: 'paid' } },
      data: {
        status: 'paid',
        transactionId: params.transactionId,
        paidAt: new Date(),
      },
    });

    const handled = updated.count > 0;
    if (!handled) {
      this.logger.warn(
        `[平台支付单] ${params.orderNo} 置 paid 未命中（重复回调或状态非法），已跳过入账`,
      );
    }
    return handled;
  }

  /** 置为失败（下单异常时用，保留单号便于排查） */
  async markFailed(orderNo: string): Promise<void> {
    await this.prisma.platformPaymentOrder.updateMany({
      where: { orderNo, status: { not: 'paid' } },
      data: { status: 'failed' },
    });
  }

  /**
   * 查询支付单状态，超时惰性置 closed。
   *
   * 与短信充值同口径：不做定时扫描，轮询请求到达时才顺手关单，
   * 省掉一个后台任务，也不影响前端轮询语义。
   */
  async getStatus(
    orderNo: string,
  ): Promise<{ status: string; paidAt: Date | null }> {
    const order = await this.prisma.platformPaymentOrder.findUnique({
      where: { orderNo },
      select: { status: true, paidAt: true, expiresAt: true },
    });

    if (!order) {
      throw new NotFoundException('支付单不存在');
    }

    if (order.status === 'pending' && order.expiresAt.getTime() <= Date.now()) {
      const closed = await this.prisma.platformPaymentOrder.updateMany({
        where: { orderNo, status: 'pending' },
        data: { status: 'closed' },
      });

      // 关单瞬间回调可能已经把支付单置为 paid：此时必须回真实状态，
      // 否则前端拿到 closed 会提示「超时未支付」，而用户其实已经付过钱
      if (closed.count === 0) {
        const latest = await this.prisma.platformPaymentOrder.findUnique({
          where: { orderNo },
          select: { status: true, paidAt: true },
        });
        return {
          status: latest?.status ?? 'closed',
          paidAt: latest?.paidAt ?? null,
        };
      }

      return { status: 'closed', paidAt: null };
    }

    return { status: order.status, paidAt: order.paidAt };
  }

  /** 按单号读取支付单（回调分发时使用） */
  findByOrderNo(
    orderNo: string,
    executor?: PrismaExecutor,
  ): Promise<{
    orderNo: string;
    bizType: string;
    bizOrderId: string | null;
    storeId: number;
    operatorUserId: number;
    amountFen: number;
    payMode: string;
    status: string;
  } | null> {
    return (executor ?? this.prisma).platformPaymentOrder.findUnique({
      where: { orderNo },
      select: {
        orderNo: true,
        bizType: true,
        bizOrderId: true,
        storeId: true,
        operatorUserId: true,
        amountFen: true,
        payMode: true,
        status: true,
      },
    });
  }

  /** 在独立事务里完成「置 paid + 业务入账」，两者必须同时成功 */
  async settleWithBusinessWrite<T>(
    orderNo: string,
    transactionId: string,
    write: (tx: PrismaExecutor) => Promise<T>,
  ): Promise<T | null> {
    return this.prisma.$transaction(
      async (tx) => {
        const paid = await this.markPaid({
          orderNo,
          transactionId,
          executor: tx,
        });
        if (!paid) {
          return null;
        }
        return write(tx);
      },
      { timeout: TX_TIMEOUT_MEDIUM },
    );
  }
}

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService, TX_TIMEOUT_MEDIUM } from '../../prisma/prisma.service';
import type { PrismaExecutor } from '../member/platform-membership/platform-membership.types';
import {
  PlatformWechatNativeService,
  type WechatCloseOrderResult,
} from './platform-wechat-native.service';
import { PlatformPaymentRealtimeService } from './platform-payment-realtime.service';

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

  // 随机段 6 字节（12 位 hex）：2 字节只有 65536 种可能，单号会被逐秒枚举出来，
  // 而轮询接口正是靠「猜不到单号」兜底的，太短等于把别人的支付单暴露出去
  return `${PLATFORM_PAYMENT_NO_PREFIX[bizType]}${stamp}${randomBytes(6).toString('hex').toUpperCase()}`;
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly wechatNativeService: PlatformWechatNativeService,
    private readonly realtimeService: PlatformPaymentRealtimeService,
  ) {}

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
      // 微信重投、轮询补偿都会走到这里，属正常路径，只记 debug 避免日志刷屏；
      // 「是否真的漏入账」由上层 settleWithBusinessWrite 的补入账重试负责
      this.logger.debug(
        `[平台支付单] ${params.orderNo} 置 paid 未命中（重复回调或状态非法）`,
      );
    }
    return handled;
  }

  /**
   * 置为已关闭（幂等）。
   *
   * 只在当前仍为 `pending` 时翻转，靠「带状态条件的 updateMany」避免并发抢占：
   * 回调可能在关单的同几毫秒内把支付单置为 paid，此时必须让关单失败，
   * 否则会出现「本地显示超时未付、钱已扣」。
   *
   * @returns 是否由本次调用完成关单；false 表示已被回调抢占（不可再推关闭事件）
   */
  async markClosed(orderNo: string): Promise<boolean> {
    const closed = await this.prisma.platformPaymentOrder.updateMany({
      where: { orderNo, status: 'pending' },
      data: { status: 'closed' },
    });

    if (closed.count === 0) {
      return false;
    }

    // 已确认关单：推给订阅该单的页面，避免前端在没有轮询的情况下一直干等
    this.realtimeService.publishClosed(orderNo);
    return true;
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
    storeId: number,
  ): Promise<{ status: string; paidAt: Date | null }> {
    const order = await this.prisma.platformPaymentOrder.findUnique({
      where: { orderNo },
      select: {
        storeId: true,
        status: true,
        paidAt: true,
        expiresAt: true,
        // codeUrl / payMode 只用于内部判断「微信侧是否已支付」，不对外返回
        codeUrl: true,
        payMode: true,
        // bizType 仅用于关单日志定位链路，不对外返回
        bizType: true,
      },
    });

    // 归属校验收进服务内部：新增调用方忘了校验时，不能把别人的支付单状态开放出去，
    // 更不能顺手替别人关单。统一按「不存在」答复，避免通过错误文案反查单号。
    if (!order || order.storeId !== storeId) {
      throw new NotFoundException('支付单不存在');
    }

    if (order.status !== 'pending' || order.expiresAt.getTime() > Date.now()) {
      return { status: order.status, paidAt: order.paidAt };
    }

    return this.closeExpiredOrder(orderNo, order);
  }

  /**
   * 用户主动关单（关闭支付弹窗 / 放弃支付时调用）。
   *
   * 必须与超时惰性关单同一套判定：先关微信侧，微信已支付则不关本地单。
   * 否则二维码在微信侧最长 2 小时有效，用户关掉页面后仍可能扫码付款，
   * 出现「以为已经取消、实际被扣款」的误扣。
   */
  async closeOrder(
    orderNo: string,
    storeId: number,
  ): Promise<{ status: string; paidAt: Date | null }> {
    const order = await this.prisma.platformPaymentOrder.findUnique({
      where: { orderNo },
      select: {
        storeId: true,
        status: true,
        paidAt: true,
        codeUrl: true,
        payMode: true,
        bizType: true,
      },
    });

    // 归属校验收进服务内部，与 getStatus 同口径：不存在与越权统一按「不存在」答复
    if (!order || order.storeId !== storeId) {
      throw new NotFoundException('支付单不存在');
    }

    // 已到终态（paid / closed / failed）：无可关，回真实状态让调用方决定提示
    if (order.status !== 'pending') {
      return { status: order.status, paidAt: order.paidAt };
    }

    return this.closeExpiredOrder(orderNo, order);
  }

  /**
   * 超时惰性关单。
   *
   * 关本地单之前必须先问微信侧：二维码真实有效期是 2 小时，本地 15 分钟到期那会儿
   * 用户仍可能扫码付成功。直接关本地就会出现「前端早放弃轮询、钱照扣、额度靠事后回调补」。
   */
  private async closeExpiredOrder(
    orderNo: string,
    order: { codeUrl: string | null; payMode: string; bizType: string },
  ): Promise<{ status: string; paidAt: Date | null }> {
    const wechatState = await this.resolveWechatCloseState(orderNo, order);

    // paid：钱已扣、回调还在路上；unknown：微信关单超时或系统错误，结果未知。
    // 两种情况都不能关本地单，但必须回查一次本地状态 ——
    // 回调可能在这几毫秒内已把单置 paid，此时要回 paid 而不是 pending。
    if (wechatState !== 'closed') {
      return this.readCurrentStatus(orderNo, 'pending');
    }

    const closed = await this.markClosed(orderNo);

    // 关单瞬间回调可能已经把支付单置为 paid：此时必须回真实状态，
    // 否则前端拿到 closed 会提示「超时未支付」，而用户其实已经付过钱
    if (!closed) {
      return this.readCurrentStatus(orderNo, 'closed');
    }

    return { status: 'closed', paidAt: null };
  }

  /** 回查支付单当前状态；查不到时回落到调用方给的默认状态 */
  private async readCurrentStatus(
    orderNo: string,
    fallbackStatus: string,
  ): Promise<{ status: string; paidAt: Date | null }> {
    const latest = await this.prisma.platformPaymentOrder.findUnique({
      where: { orderNo },
      select: { status: true, paidAt: true },
    });

    return {
      status: latest?.status ?? fallbackStatus,
      paidAt: latest?.paidAt ?? null,
    };
  }

  /**
   * 询问微信侧这笔单的最终状态，用于决定本地能否关单。
   *
   * 测试单、以及没拿到 code_url 就失败的单，微信侧根本没有这笔记录，直接视为不可支付。
   * 关单调用本身失败时返回 `unknown`：结果未知就不能当「未支付」处理，
   * 否则会把可能已付款的单关掉，前端提示超时而钱已扣。
   */
  private async resolveWechatCloseState(
    orderNo: string,
    order: { codeUrl: string | null; payMode: string; bizType: string },
  ): Promise<WechatCloseOrderResult | 'unknown'> {
    if (order.payMode !== 'live' || !order.codeUrl) {
      return 'closed';
    }

    try {
      return await this.wechatNativeService.closeNativeOrder(
        orderNo,
        order.bizType,
      );
    } catch (error: unknown) {
      // 关单失败不能把轮询接口打成 500：真付了钱的话，回调最终会把单改回 paid
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[平台支付单] ${orderNo} 微信关单失败（${reason}），保持 pending 待下次轮询重试`,
      );
      return 'unknown';
    }
  }

  /**
   * 尽力关闭微信侧订单，失败只记日志。
   *
   * 供「微信订单已创建、但本地后续步骤失败（如二维码出图失败）」的调用方使用：
   * 本地单要置 failed 时若不关微信单，会留下「本地失败、微信侧仍可支付 2 小时」的悬空单。
   * 关单失败不能向外抛，否则会覆盖调用方真正的失败原因。
   */
  async closeWechatOrderQuietly(
    orderNo: string,
    bizType?: string,
  ): Promise<void> {
    try {
      const result = await this.wechatNativeService.closeNativeOrder(
        orderNo,
        bizType,
      );
      if (result === 'paid') {
        this.logger.warn(
          `[平台支付单] ${orderNo} 本地置失败时发现用户已付款，等待回调补入账`,
        );
      }
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[平台支付单] ${orderNo} 微信关单失败（${reason}），微信侧订单可能仍可支付`,
      );
    }
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
    transactionId: string | null;
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
        // 补偿重试要复用原流水号回填，避免把微信流水号覆盖成空
        transactionId: true,
      },
    });
  }

  /**
   * 先独立提交「钱已收」，再尝试业务入账。
   *
   * 两段必须分开提交：
   * - 原先 markPaid 与业务写入放在同一事务里，业务入账一失败（典型原因：纯利豆 /
   *   积分在支付窗口内被别处消耗）就会把 markPaid 一起回滚，支付单退回 pending；
   *   微信重投耗尽后再没有任何路径能把它推回 paid —— 形成「用户已付款、权益没发放、
   *   补偿任务也扫不到（它只认 paid）」的永久丢单。
   * - 现在 markPaid 先独立提交（钱收了就是既成事实，不允许被业务失败回滚），
   *   业务入账失败只回滚自己那段，支付单留在 paid，由轮询 / 启动补偿按
   *   「paid 但未生效」重试。
   *
   * 重投与补偿会重复进入本方法，因此**业务写入必须自带幂等**：
   * 会员链路看订单状态（已 paid 直接返回 null），额度链路看充值流水单号。
   *
   * @returns 业务落库结果；业务已生效（无需再做动作）时返回 null
   */
  async settleWithBusinessWrite<T>(
    orderNo: string,
    transactionId: string,
    write: (tx: PrismaExecutor) => Promise<T>,
  ): Promise<T | null> {
    const handled = await this.markPaid({ orderNo, transactionId });
    if (!handled) {
      // 重复回调 / 补偿重试：钱早就收到了，这里只补业务入账，
      // 由 write 内部的幂等判定保证不会重复发放
      this.logger.log(`[平台支付单] ${orderNo} 已是已支付状态，转入补入账重试`);
    }

    return this.prisma.$transaction(
      async (tx) => {
        // 锁住支付单行再入账：微信重投 / 轮询补偿与本次入账可能同时到达，
        // 而业务幂等判定（会员订单状态、充值流水单号）在 READ COMMITTED 下
        // 读到的是尚未提交的旧快照，不加锁就会两条链路都判定「还没处理过」，
        // 结果重复扣豆或重复加额度。
        await tx.$queryRaw<Array<{ id: number }>>`
          SELECT id FROM platform_payment_orders WHERE order_no = ${orderNo} FOR UPDATE
        `;
        return write(tx);
      },
      { timeout: TX_TIMEOUT_MEDIUM },
    );
  }
}

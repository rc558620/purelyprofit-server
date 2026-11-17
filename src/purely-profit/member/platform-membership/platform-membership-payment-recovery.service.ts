// 平台会员支付的补偿自愈：轮询补生效 + 启动扫描补偿
//
// 从 platform-membership-payment.service.ts 拆出。真实支付存在一类静默丢单：
// 钱已收到（支付单 paid）但权益没落地（回调入账失败 / 回调未及时到达），
// 微信重试耗尽后订单会永久停在 pending。这里负责把它捞回来补生效。
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { PlatformPaymentOrderService } from '../../payments/platform-payment-order.service';
import { PlatformMembershipPaymentActivationService } from './platform-membership-payment-activation.service';
import { DAY_MS } from './platform-membership.constants';

/** 启动补偿只回捞最近这一段时间内的订单，避免全表扫描 */
const BACKFILL_WINDOW_DAYS = 7;
/** 单次启动补偿最多处理的订单数 */
const BACKFILL_BATCH_SIZE = 100;

@Injectable()
export class PlatformMembershipPaymentRecoveryService {
  private readonly logger = new Logger(
    PlatformMembershipPaymentRecoveryService.name,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentOrderService: PlatformPaymentOrderService,
    private readonly activationService: PlatformMembershipPaymentActivationService,
  ) {}

  /**
   * 补偿：支付单已 paid 但会员权益尚未落地时补生效。
   *
   * 触发点：前端轮询、服务启动扫描。覆盖「回调入账失败（豆 / 积分在支付窗口内
   * 被别处消耗）→ 微信重试耗尽 → 已付款未开通」这一类静默丢单。
   */
  async retryActivateIfPaid(paymentOrderNo: string): Promise<boolean> {
    const paymentOrder =
      await this.paymentOrderService.findByOrderNo(paymentOrderNo);
    if (
      !paymentOrder ||
      paymentOrder.bizType !== 'membership' ||
      paymentOrder.status !== 'paid'
    ) {
      return false;
    }

    const awaiting = await this.prisma.storeMembershipOrder.findFirst({
      where: {
        paymentOrderId: paymentOrderNo,
        status: { in: ['pending', 'failed'] },
      },
      select: { id: true },
    });
    if (!awaiting) {
      return false;
    }

    // 走与回调相同的入账入口：内部会先锁支付单行，避免补偿重试与微信回调并发时
    // 两条链路同时判定「订单还没生效」而重复扣积分 / 纯利豆
    const activated = await this.paymentOrderService.settleWithBusinessWrite(
      paymentOrderNo,
      paymentOrder.transactionId ?? '',
      async (tx) =>
        this.activationService.applyActivationInTx(tx, {
          paymentOrderNo,
          amountFen: paymentOrder.amountFen,
        }),
    );

    if (!activated) {
      return false;
    }

    await this.activationService.afterMembershipActivated(activated);
    return true;
  }

  /** 启动补偿：扫描近期「已付款但权益未落地」的会员订单并补生效 */
  async backfillPendingPaidOrders(): Promise<void> {
    const since = new Date(Date.now() - BACKFILL_WINDOW_DAYS * DAY_MS);
    const candidates = await this.prisma.storeMembershipOrder.findMany({
      where: {
        status: { in: ['pending', 'failed'] },
        paymentOrderId: { not: null },
        createdAt: { gte: since },
      },
      select: { paymentOrderId: true },
      orderBy: { createdAt: 'desc' },
      take: BACKFILL_BATCH_SIZE,
    });

    if (candidates.length === 0) {
      return;
    }

    let repaired = 0;
    for (const candidate of candidates) {
      if (!candidate.paymentOrderId) {
        continue;
      }
      try {
        const done = await this.retryActivateIfPaid(candidate.paymentOrderId);
        if (done) {
          repaired += 1;
        }
      } catch (err: unknown) {
        this.logger.error(
          `[会员支付] 启动补偿失败 ${candidate.paymentOrderId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    this.logger.log(
      `[会员支付] 启动补偿扫描 ${candidates.length} 笔待确认订单，补生效 ${repaired} 笔`,
    );
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

/** 单次扫描最多处理的明细数（控制任务时长与事务数） */
const MAX_REFUND_PER_RUN = 200;

export interface SmsRefundScanResult {
  /** 本次退费的明细条数 */
  recipients: number;
  /** 本次退费总金额（分） */
  amountFen: number;
}

/**
 * 群发短信退费服务（**唯一**的退费实现）。
 *
 * ## 计费口径：**按提交计费**
 *
 * 计费节点是「提交到运营商成功」，不是「用户收到」。因此：
 *
 * - **提交失败**（`status = failed`）：压根没发出去，腾讯云不计费，
 *   **必须退**——客户钱扣了一条没发，这种不退没有任何立场。
 * - **送达失败**（`status = success` 但 `deliveryStatus = failed`）：
 *   已经提交成功、成本已经发生，属客户名单质量问题（空号/停机/黑名单），
 *   **不退**。这条规则必须在前端发送前明示，客户知情同意后才成立。
 * - **派发判死**（重试耗尽）：确定没提交出去，**必须退**。
 *
 * 送达结果仍然会记录（`deliveryStatus` / `deliveryCode`），
 * 商户可以看到哪些人没收到、自己去清洗名单，只是不退钱。
 *
 * 三条硬约束：
 * 1. **幂等**：`refundedAt` 是闸门，事务内二次确认，一条明细永远只退一次；
 * 2. **不超退**：累计退费（含人工）以 `refundedAmountFen` 为准，
 *    任何一次退费都被 `chargedAmountFen - refundedAmountFen` 卡住；
 * 3. **不确定就不退**：通道没给明确结果的（NO_PROVIDER_STATUS）保持 pending
 *    走重发，重发耗尽判死后才确定没发出去、才退。
 */
@Injectable()
export class SmsRefundService {
  private readonly logger = new Logger(SmsRefundService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 扫描并退掉「已确定未送达、且还没退过」的明细。
   *
   * @param taskId 指定任务；不传则扫全库（用于兜底任务，可覆盖历史存量）
   */
  async refundUndeliveredFailures(
    taskId?: number,
  ): Promise<SmsRefundScanResult> {
    /*
     * 只扫「提交失败」（status = failed），**不扫**送达失败。
     *
     * 计费口径是「按提交计费」：提交成功的成本已经发生，送达不了是客户名单
     * 质量问题，不退（前端发送前已明示该规则）。
     * 由此 `deliveryStatus = failed` 的明细仍会被记录与统计，只是不涉及钱。
     */
    const recipients = await this.prisma.smsBroadcastRecipient.findMany({
      where: {
        refundedAt: null,
        ...(taskId === undefined ? {} : { taskId }),
        status: 'failed',
      },
      select: { id: true, status: true, deliveryStatus: true },
      orderBy: { id: 'asc' },
      take: MAX_REFUND_PER_RUN,
    });

    let amountFen = 0;
    for (const recipient of recipients) {
      const refunded = await this.refundRecipient(recipient.id);
      amountFen += refunded;
    }

    if (amountFen > 0) {
      this.logger.warn(
        `[sms-refund] 自动退费 ${recipients.length} 条 / ${amountFen} 分${
          taskId === undefined ? '（全库扫描）' : `（taskId=${taskId}）`
        }`,
      );
    }

    return { recipients: recipients.length, amountFen };
  }

  /**
   * 退单条明细的钱。
   *
   * @returns 实际退费金额（分）；0 表示不满足退费条件（已退过 / 任务异常 / 无可退金额）
   */
  async refundRecipient(recipientId: number): Promise<number> {
    return this.prisma.$transaction(
      async (tx) => {
        const recipient = await tx.smsBroadcastRecipient.findUnique({
          where: { id: recipientId },
          select: { id: true, refundedAt: true, taskId: true },
        });
        // 事务内二次确认：并发重入也只退一次
        if (!recipient || recipient.refundedAt) {
          return 0;
        }

        const task = await tx.smsBroadcastTask.findUnique({
          where: { id: recipient.taskId },
          select: {
            id: true,
            storeId: true,
            broadcastId: true,
            unitPriceFen: true,
            smsSegments: true,
            validMobileCount: true,
            chargedAmountFen: true,
            refundedAmountFen: true,
            autoRefundedFen: true,
          },
        });
        if (!task) {
          return 0;
        }

        const perRecipientSegments =
          task.validMobileCount > 0
            ? Math.ceil(task.smsSegments / task.validMobileCount)
            : 0;
        // refundedAmountFen 含人工退费：两套退费共用这一个上限，绝不会退超
        const amount = Math.min(
          perRecipientSegments * task.unitPriceFen,
          task.chargedAmountFen - task.refundedAmountFen,
        );
        if (amount <= 0) {
          return 0;
        }

        await tx.storeSmsAccount.updateMany({
          where: { storeId: task.storeId },
          data: {
            balanceFen: { increment: amount },
            totalConsumedFen: { decrement: amount },
          },
        });
        const account = await tx.storeSmsAccount.findUniqueOrThrow({
          where: { storeId: task.storeId },
          select: { balanceFen: true },
        });

        await tx.smsWalletLog.create({
          data: {
            storeId: task.storeId,
            type: 'refund',
            changeFen: amount,
            balanceAfterFen: account.balanceFen,
            description: `群发短信未送达自动退费（任务 ${task.broadcastId}）`,
            broadcastId: task.broadcastId,
          },
        });

        await tx.smsBroadcastRecipient.update({
          where: { id: recipientId },
          data: { refundedAt: new Date() },
        });

        await tx.smsBroadcastTask.update({
          where: { id: task.id },
          data: {
            refundedAmountFen: { increment: amount },
            autoRefundedFen: { increment: amount },
          },
        });

        return amount;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { SmsDeliveryCallbackService } from './sms-delivery-callback.service';
import { SmsRefundService } from './sms-refund.service';
import { SmsTencentProvider } from './sms-tencent.provider';
import {
  SMS_DELIVERY_RECONCILE_MAX_AGE_DAYS,
  SMS_DELIVERY_RECONCILE_WAIT_HOURS,
} from './sms.constants';

/** 单次扫描处理的最大明细数（控制腾讯云拉取配额与任务时长） */
const MAX_PENDING_PER_RUN = 500;

/**
 * 送达回执兜底服务。
 *
 * 补的是这条洞：**推送是可能丢的**。
 * 腾讯云回执推送一旦丢失（网络抖动、我们当时在重启、回调 5xx），
 * 那条短信就永远停留在「不知道送达没有」——
 * 腾讯云那边已经确定不计费了，我们这边却还扣着商户的钱，而且无人知晓。
 *
 * 所以每天扫一次「超过等待窗口仍无回执」的明细，主动向通道问一次
 * （`PullSmsSendStatus`），拿回来后**复用回调那条已经跑通的处理逻辑**——
 * 包括幂等的退费事务，不新写一遍钱相关的代码。
 *
 * 为什么单独一个 services 而不是塞进 recovery：二者职责与周期都不同，
 * 一个是分钟级的派发补偿、一个是天级的资金对账，拆开后可以单独关停。
 */
@Injectable()
export class SmsDeliveryReconcileService {
  private readonly logger = new Logger(SmsDeliveryReconcileService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: SmsTencentProvider,
    private readonly deliveryCallbackService: SmsDeliveryCallbackService,
    private readonly refundService: SmsRefundService,
  ) {}

  /**
   * 主动补拉缺失的送达回执。
   *
   * @returns 本轮补到的回执条数
   */
  /** 回执兜底 + 退费兜底：本轮补到的回执条数 */
  async reconcile(): Promise<{ reconciled: number; refundedFen: number }> {
    const reconciled = await this.reconcileMissingDelivery();
    // 退费兜底：主链路（派发结束 / 判死 / 回执回调）都会即时退，
    // 这里再扫一次是为了兜住历史存量与任何遗漏——商户的钱不能因为一次异常就留在平台账上。
    const refund = await this.refundService.refundUndeliveredFailures();
    return { reconciled, refundedFen: refund.amountFen };
  }

  async reconcileMissingDelivery(): Promise<number> {
    const now = Date.now();
    const windowEnd = new Date(
      now - SMS_DELIVERY_RECONCILE_WAIT_HOURS * 60 * 60_000,
    );
    const windowStart = new Date(
      now - SMS_DELIVERY_RECONCILE_MAX_AGE_DAYS * 24 * 60 * 60_000,
    );

    // 超过等待窗口仍无回执的明细。serialNo 为空的说明压根没发成功，不参与。
    const pending = await this.prisma.smsBroadcastRecipient.findMany({
      where: {
        deliveryStatus: null,
        serialNo: { not: null },
        createdAt: { gte: windowStart, lte: windowEnd },
      },
      select: { serialNo: true, status: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
      take: MAX_PENDING_PER_RUN,
    });

    if (pending.length === 0) {
      return 0;
    }

    const wanted = new Set(
      pending
        .map((row) => row.serialNo)
        .filter((serialNo): serialNo is string => Boolean(serialNo)),
    );
    if (wanted.size === 0) {
      return 0;
    }

    this.logger.log(
      `[sms-delivery-reconcile] 待核销 ${wanted.size} 条，开始向通道主动拉取`,
    );

    // 拉取窗口覆盖这批明细的时间范围，各放宽 10 分钟防边界遗漏
    const pulled = await this.provider.pullSmsSendStatus({
      beginTime: new Date(pending[0].createdAt.getTime() - 10 * 60_000),
      endTime: new Date(
        pending[pending.length - 1].createdAt.getTime() + 10 * 60_000,
      ),
      limit: Math.min(wanted.size, MAX_PENDING_PER_RUN),
    });

    if (pulled.length === 0) {
      return 0;
    }

    // 只保留我们缺失的那些：拉取是按时间范围拉全量的，里面混着别人的群发
    const relevant = pulled.filter((row) => {
      const serialNo =
        typeof row.SerialNo === 'string'
          ? row.SerialNo
          : typeof row.serialNo === 'string'
            ? row.serialNo
            : null;
      return serialNo !== null && wanted.has(serialNo);
    });

    if (relevant.length === 0) {
      return 0;
    }

    // 复用回调的处理链路（解析 → 定位 → 送达判定 → 按条退费），不重复实现
    const result = await this.deliveryCallbackService.handleCallback(relevant);

    if (result.matched > 0) {
      this.logger.warn(
        `[sms-delivery-reconcile] 补到回执 ${result.matched} 条` +
          `（其中送达失败 ${result.failed} 条，按提交计费不退费）`,
      );
    }

    return result.matched;
  }
}

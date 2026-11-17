import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { SmsRefundService } from './sms-refund.service';
import { SmsTencentProvider } from './sms-tencent.provider';
import {
  SMS_DISPATCH_MAX_ATTEMPTS,
  SMS_NO_PROVIDER_STATUS_CODE,
} from './sms.constants';
import type { SmsBroadcastStatusValue } from './sms.constants';
import type { SmsSendResultItem } from './sms.types';

/**
 * 发送结果写回的批大小。
 *
 * 逐条 updateMany 是业务约束（见 persistResults），但把整批号码一次性并发出去，
 * 万人群发就是上万个并发 UPDATE，会瞬间打满 Prisma 连接池、把同进程其它模块的
 * 查询一起拖慢。改为批内并行、批间串行后，峰值并发恒定为本常量。
 */
const SMS_PERSIST_BATCH_SIZE = 50;

/**
 * 派发入参。
 *
 * 刻意**不传**「之前轮次的成功/失败累计」：任务计数一律以数据库为准重新统计，
 * 传累计值反而会在重发时把旧值叠加上去、产生虚高（成功/失败/未决三态互斥，
 * 重发只会让明细在三者之间迁移，不会凭空多出一条）。
 */
export interface SmsDispatchParams {
  taskId: number;
  storeId: number;
  content: string;
  /** 本轮要发的号码（已去重由 runDispatch 负责） */
  targets: { phone: string }[];
}

/** 收件人三态统计（互斥：success / failed / pending） */
interface SmsRecipientCounts {
  success: number;
  failed: number;
  pending: number;
}

/** 一轮派发结束后要落库的结果快照 */
interface SmsDispatchOutcome {
  taskId: number;
  storeId: number;
  status: SmsBroadcastStatusValue;
  counts: SmsRecipientCounts;
  results: SmsSendResultItem[];
}

/**
 * 群发派发服务：调通道、写回明细、按数据库统计收敛任务状态。
 *
 * 首次发送与补偿重发走**同一套逻辑**，不区分「第几轮」：
 * 结束后统一按数据库重新统计三态，因此重发不会把计数叠加虚高。
 *
 * 资金约束：失败不退费在这里自动完成（`refundUndeliveredFailures`），
 * 但「不确定是否发出」的明细必须保持 pending，不能提前退费，
 * 否则会出现「通道其实发了 → 已退费 → 白送」的漏洞。
 */
@Injectable()
export class SmsBroadcastDispatchService {
  private readonly logger = new Logger(SmsBroadcastDispatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: SmsTencentProvider,
    private readonly refundService: SmsRefundService,
  ) {}

  /**
   * 补发一个「钱已扣、未送达」的任务：只重发仍处于 pending 的收件人。
   *
   * 三个入口共用：
   * - 幂等命中但任务未送达（用户重试）
   * - 补偿扫描发现卡在 sending 的任务（进程崩溃 / 写库失败）
   * - 收件人已全部落终态、但任务状态没回写的残留（只收敛状态，不再发）
   */
  async resumeDispatch(taskId: number): Promise<void> {
    const task = await this.prisma.smsBroadcastTask.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        storeId: true,
        content: true,
        successCount: true,
        failedCount: true,
        dispatchAttempts: true,
      },
    });
    if (!task) {
      return;
    }

    const pending = await this.prisma.smsBroadcastRecipient.findMany({
      where: { taskId, status: 'pending' },
      select: { phone: true },
    });

    // 人都发完了、只是任务状态没回写：收敛成终态即可，绝不能重发
    if (pending.length === 0) {
      await this.convergeTaskStatus(taskId);
      return;
    }

    if (task.dispatchAttempts >= SMS_DISPATCH_MAX_ATTEMPTS) {
      await this.markDispatchExhausted(taskId, pending.length);
      return;
    }

    this.logger.warn(
      `群发补发：taskId=${taskId}，待发 ${pending.length} 条，第 ${task.dispatchAttempts + 1} 次派发`,
    );

    await this.runDispatch({
      taskId,
      storeId: task.storeId,
      content: task.content,
      targets: pending,
    });
  }

  /**
   * 执行一轮派发并写回结果。
   *
   * 首次发送与补偿重发共用同一套逻辑，不区分「第几轮」：
   * 结束后统一按数据库重新统计三种状态，因此重发不会把计数叠加虚高。
   */
  async runDispatch(params: SmsDispatchParams): Promise<void> {
    const { taskId, storeId, content, targets } = params;

    // 去重：两个顾客共用同一手机号时，重复号码会被通道整批拒绝
    const phones = Array.from(new Set(targets.map((item) => item.phone)));
    if (phones.length === 0) {
      await this.convergeTaskStatus(taskId);
      return;
    }

    const results = await this.provider.sendMarketingBatch(phones, content);
    await this.persistResults(taskId, results);

    /*
     * 计数以**数据库**为准，不信任内存里的 results：
     * 通道没给明确结果的那批（NO_PROVIDER_STATUS）保持 pending，
     * 它们既不进成功也不进失败——发没发出去还不知道，等补偿任务重发再定。
     */
    const counts = await this.countRecipients(taskId);
    const status = this.resolveTaskStatus(counts);

    await this.saveOutcome({ taskId, storeId, status, counts, results });
  }

  /** 三态统计 → 任务状态：有未决就保持 sending，等补偿任务继续重发 */
  private resolveTaskStatus(
    counts: SmsRecipientCounts,
  ): SmsBroadcastStatusValue {
    if (counts.pending > 0) {
      return 'sending';
    }
    if (counts.failed === 0) {
      return 'sent';
    }
    return counts.success === 0 ? 'failed' : 'partial_failed';
  }

  /** 写回任务状态与计数、累加真实送达条数、必要时自动退费 */
  private async saveOutcome(outcome: SmsDispatchOutcome): Promise<void> {
    const { taskId, storeId, status, counts, results } = outcome;

    const firstError = results.find(
      (item) => !item.ok && item.code !== SMS_NO_PROVIDER_STATUS_CODE,
    );

    await this.prisma.smsBroadcastTask.update({
      where: { id: taskId },
      data: {
        status,
        successCount: counts.success,
        failedCount: counts.failed,
        dispatchAttempts: { increment: 1 },
        lastError: firstError
          ? `${firstError.code ?? 'UNKNOWN'}${firstError.message ? `：${firstError.message}` : ''}`.slice(
              0,
              500,
            )
          : null,
      },
    });

    // 只累计**真实送达**的条数（按每人分段数折算），报表不虚高
    const deliveredThisRound = results.filter((item) => item.ok).length;
    if (deliveredThisRound > 0) {
      await this.incrementSentSmsCount(storeId, taskId, deliveredThisRound);
    }

    /*
     * 已确定失败的立即自动退费：商户付了钱就该拿到短信，拿不到就把钱还回去。
     * 不确定（pending）的那些不退——它们还会被重发，等判死后由 markDispatchExhausted 触发退费。
     */
    if (status === 'failed' || status === 'partial_failed') {
      await this.refundService.refundUndeliveredFailures(taskId);
    }

    if (counts.failed > 0) {
      this.logger.warn(
        `群发短信部分失败：taskId=${taskId}，累计失败 ${counts.failed} 条（已自动退费，无需人工处理）`,
      );
    }
  }

  /** 按明细统计成功 / 失败 / 未决数量 */
  private async countRecipients(taskId: number): Promise<SmsRecipientCounts> {
    const grouped = await this.prisma.smsBroadcastRecipient.groupBy({
      by: ['status'],
      where: { taskId },
      _count: { _all: true },
    });

    const countOf = (status: string): number =>
      grouped.find((row) => row.status === status)?._count._all ?? 0;

    return {
      success: countOf('success'),
      failed: countOf('failed'),
      pending: countOf('pending'),
    };
  }

  /**
   * 把通道逐条结果写回收件人明细。
   *
   * 逐条（逐组）独立提交而非包成一个事务：某一条写失败不应该拖累其它条，
   * 已送达却没写回状态的号码会在补偿重发时被再发一次（重复骚扰），
   * 因此这里要尽量把每一条都写进去。
   */
  private async persistResults(
    taskId: number,
    results: SmsSendResultItem[],
  ): Promise<void> {
    /*
     * 逐条写回——不能按 RequestId 分组批量：SerialNo 是**一个号码一条**，
     * 分组会串行覆盖掉别条的流水号，而流水号一旦丢了就永远等不到送达回执。
     */
    const pendingItems = results.filter((item) => {
      /*
       * 通道没给明确结果的（NO_PROVIDER_STATUS）：保持 pending，跳过不写。
       *
       * 这类号码发没发出去是未知的——直接判失败会立刻退钱（若其实发了就是白送），
       * 判成功又可能吞钱。留成 pending 交给补偿任务重发，重发耗尽后才判死退费，
       * 是唯一既不吃亏也不白送的处理方式。
       */
      return !(item.ok === false && item.code === SMS_NO_PROVIDER_STATUS_CODE);
    });

    if (pendingItems.length === 0) {
      return;
    }

    // 逐条写回的条数不变，只把「一次性全并发」改成批内并行、批间串行，
    // 避免万人群发起上万个并发 UPDATE 打满连接池。
    for (
      let offset = 0;
      offset < pendingItems.length;
      offset += SMS_PERSIST_BATCH_SIZE
    ) {
      await Promise.all(
        pendingItems
          .slice(offset, offset + SMS_PERSIST_BATCH_SIZE)
          .map((item) =>
            this.prisma.smsBroadcastRecipient.updateMany({
              where: { taskId, phone: item.phone },
              data: {
                status: item.ok ? 'success' : 'failed',
                providerCode: item.ok ? 'Ok' : item.code,
                providerMessage: item.message,
                providerRequestId: item.requestId,
                serialNo: item.serialNo,
              },
            }),
          ),
      );
    }
  }

  /**
   * 收件人都已落终态、但任务状态没回写时，按明细重新收敛任务状态。
   *
   * 典型残留：派发成功、写 recipient 完成，进程在写 task.status 前挂了。
   */
  private async convergeTaskStatus(taskId: number): Promise<void> {
    const counts = await this.countRecipients(taskId);

    const status: SmsBroadcastStatusValue =
      counts.failed === 0
        ? 'sent'
        : counts.success === 0
          ? 'failed'
          : 'partial_failed';

    await this.prisma.smsBroadcastTask.update({
      where: { id: taskId },
      data: {
        status,
        successCount: counts.success,
        failedCount: counts.failed,
      },
    });

    this.logger.warn(
      `群发任务状态收敛：taskId=${taskId} → ${status}（成功 ${counts.success} / 失败 ${counts.failed}）`,
    );
  }

  /**
   * 派发次数用尽：剩余收件人标记为失败，任务转 failed 等人工退费。
   *
   * 不停重试的原因：继续重试只会反复消耗通道额度并把问题藏起来，
   * 这类任务必须由人工核实后退费（见 PulseSmsBroadcastService.refundAdminSmsBroadcast）。
   */
  private async markDispatchExhausted(
    taskId: number,
    pendingCount: number,
  ): Promise<void> {
    await this.prisma.smsBroadcastRecipient.updateMany({
      where: { taskId, status: 'pending' },
      data: {
        status: 'failed',
        providerCode: 'DISPATCH_EXHAUSTED',
        providerMessage: '派发重试次数用尽，未发出',
      },
    });
    await this.convergeTaskStatus(taskId);

    // 判死即退费：重试到这个地步已能确定这些号码没发出去，钱不该留在平台账上
    await this.refundService.refundUndeliveredFailures(taskId);

    this.logger.error(
      `群发任务派发次数用尽，已转失败并自动退费：taskId=${taskId}，未发出 ${pendingCount} 条`,
    );
  }

  /** 累加真实送达条数：成功人数 × 每人分段数 */
  private async incrementSentSmsCount(
    storeId: number,
    taskId: number,
    successRecipients: number,
  ): Promise<void> {
    const task = await this.prisma.smsBroadcastTask.findUnique({
      where: { id: taskId },
      select: { smsSegments: true, validMobileCount: true },
    });
    if (!task || task.validMobileCount <= 0) {
      return;
    }

    const perRecipientSegments = Math.ceil(
      task.smsSegments / task.validMobileCount,
    );
    if (perRecipientSegments <= 0) {
      return;
    }

    await this.prisma.storeSmsAccount.updateMany({
      where: { storeId },
      data: {
        sentSmsCount: { increment: perRecipientSegments * successRecipients },
      },
    });
  }
}

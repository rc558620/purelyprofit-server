import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { SmsBroadcastService } from './sms-broadcast.service';
import {
  SMS_BROADCAST_RECOVERY_SCAN_LIMIT,
  SMS_DISPATCH_STUCK_TIMEOUT_MS,
} from './sms.constants';

/**
 * 群发派发补偿服务。
 *
 * 为什么必须有它：`dispatch()` 在扣费事务**之外**执行（事务只保证钱扣对），
 * 因此进程崩溃、发布重启或写库失败都会让任务永久停在 `sending`——
 * 钱扣了、短信没发、也没有任何终态，商户只能看到一条「发送中」。
 *
 * 补偿逻辑：扫描 `status='sending'` 且 `updatedAt` 超过阈值的任务，交给
 * {@link SmsBroadcastService.resumeDispatch} 补发**未送达**的收件人；
 * 派发次数用尽则转 `failed`，由平台人工核实后退费。
 */
@Injectable()
export class SmsBroadcastRecoveryService {
  private readonly logger = new Logger(SmsBroadcastRecoveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly broadcastService: SmsBroadcastService,
  ) {}

  /**
   * 扫描并补发卡死的群发任务。
   *
   * @returns 本轮处理的任务数
   */
  async recoverStuckTasks(): Promise<number> {
    const deadline = new Date(Date.now() - SMS_DISPATCH_STUCK_TIMEOUT_MS);

    /*
     * 两类都要捞：
     * 1. 卡在 sending（进程崩溃 / 写状态失败）；
     * 2. 仍有 pending 明细的任务——通道没给明确结果的那批（NO_PROVIDER_STATUS）
     *    会让任务停在 sending，但历史数据或写状态异常可能留下「终态 + 未决」的残留。
     *    不捞它们，这些号码就永远没人管：钱扣了、短信没发、也退不了。
     *
     * 这里刻意用两步查询而不是关联嵌套：收件人表与任务表之间没有建 Prisma
     * 关系（也不该为了一个扫描去加外键），嵌套查询编译不过。
     */
    const pendingGroups = await this.prisma.smsBroadcastRecipient.findMany({
      where: { status: 'pending', createdAt: { lt: deadline } },
      select: { taskId: true },
      distinct: ['taskId'],
      take: SMS_BROADCAST_RECOVERY_SCAN_LIMIT,
    });
    const pendingTaskIds = pendingGroups.map((row) => row.taskId);

    const tasks = await this.prisma.smsBroadcastTask.findMany({
      where: {
        updatedAt: { lt: deadline },
        OR: [{ status: 'sending' }, { id: { in: pendingTaskIds } }],
      },
      select: { id: true, broadcastId: true, storeId: true },
      orderBy: { updatedAt: 'asc' },
      take: SMS_BROADCAST_RECOVERY_SCAN_LIMIT,
    });

    if (tasks.length === 0) {
      return 0;
    }

    this.logger.warn(
      `[sms-recovery] 发现 ${tasks.length} 个卡死任务，开始补发：${tasks
        .map((task) => task.broadcastId)
        .join(', ')}`,
    );

    let recovered = 0;
    for (const task of tasks) {
      try {
        await this.broadcastService.resumeDispatch(task.id);
        recovered += 1;
      } catch (error) {
        // 单个任务失败不能中断整轮扫描：记录后继续，下一周期会再捞到它
        this.logger.error(
          `[sms-recovery] 补发失败 broadcastId=${task.broadcastId} storeId=${task.storeId} reason=${
            error instanceof Error ? error.message : 'UnknownError'
          }`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }

    return recovered;
  }
}

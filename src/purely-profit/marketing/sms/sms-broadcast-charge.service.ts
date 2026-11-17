import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { SmsAccountService } from './sms-account.service';
import {
  SMS_CHARGE_RETRY_BASE_DELAY_MS,
  SMS_CHARGE_RETRY_MAX_ATTEMPTS,
} from './sms.constants';
import type { SmsBroadcastResponseDto } from './dto/sms-broadcast.dto';
import type { SmsChargeParams } from './sms.types';

/** 事务隔离级别：并发扣费必须串行，避免两个请求同时读到「余额够」 */
const CHARGE_ISOLATION_LEVEL: Prisma.TransactionIsolationLevel =
  Prisma.TransactionIsolationLevel.Serializable;

/** 唯一索引冲突后回读首次任务所需字段 */
const DUPLICATE_TASK_SELECT = {
  id: true,
  storeId: true,
  broadcastId: true,
  recipientCount: true,
  chargedAmountFen: true,
} as const;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * 扣费事务结果。
 * - created：本次新建了任务，由当前请求负责派发
 * - duplicate：并发下唯一索引命中了首次请求的任务，只能复用首次结果，
 *   绝不能再派发一次，否则同一批收件人会收到两条短信
 */
export type SmsChargeResult =
  | { kind: 'created'; taskId: number }
  | { kind: 'duplicate'; result: SmsBroadcastResponseDto };

/**
 * 群发扣费事务服务。
 *
 * 只负责「钱扣对 + 任务/明细落库」这一段，派发与通道调用由
 * {@link SmsBroadcastDispatchService} 承担：扣费在事务内、发送在事务外，
 * 两段失败的处置方式完全不同，混在一个类里最容易把事务边界写错。
 */
@Injectable()
export class SmsBroadcastChargeService {
  private readonly logger = new Logger(SmsBroadcastChargeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accountService: SmsAccountService,
  ) {}

  /**
   * 扣费事务（带 Serializable 写冲突重试）。
   *
   * Serializable 隔离级别能防住并发超扣，代价是并发写会抛 **P2034**
   * （write conflict / deadlock）——数据库直接拒绝其中一个事务。
   * 这不是资金问题（重试后余额条件会重新判定），不重试就会白白失败一次
   * 群发。因此这里对 P2034 做有限次重试，其余错误（含余额不足、幂等冲突）
   * 一律不重试：它们重试一万次结果也一样。
   */
  async chargeAndCreateTask(params: SmsChargeParams): Promise<SmsChargeResult> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.chargeOnce(params);
      } catch (error) {
        if (
          !this.isSerializationFailure(error) ||
          attempt >= SMS_CHARGE_RETRY_MAX_ATTEMPTS
        ) {
          throw error;
        }
        this.logger.warn(
          `群发扣费事务写冲突（P2034），第 ${attempt + 1} 次重试：storeId=${params.storeId}`,
        );
        await sleep(SMS_CHARGE_RETRY_BASE_DELAY_MS * attempt);
      }
    }
  }

  private async chargeOnce(params: SmsChargeParams): Promise<SmsChargeResult> {
    try {
      const taskId = await this.prisma.$transaction(
        (tx) => this.consumeAndCreateTask(tx, params),
        { isolationLevel: CHARGE_ISOLATION_LEVEL },
      );
      return { kind: 'created', taskId };
    } catch (error) {
      // 并发下唯一索引兜底：另一个请求刚用同一个 key 建了任务
      const duplicate = await this.resolveDuplicate(error, params);
      if (duplicate) {
        return duplicate;
      }
      throw error;
    }
  }

  /** 事务体：条件扣款 → 写 consume 流水 → 建任务 → 建收件人明细 */
  private async consumeAndCreateTask(
    tx: Prisma.TransactionClient,
    params: SmsChargeParams,
  ): Promise<number> {
    await this.accountService.ensureAccount(tx, params.storeId);

    /*
     * 条件更新防超扣：`where balanceFen >= amount` 由数据库保证原子性。
     * 若用「先查余额再 update」，并发的两个请求会同时读到够钱并各自扣款，
     * 把余额扣成负数。
     *
     * ⚠️ 这里刻意**不累加 sentSmsCount**：扣费只代表「买了多少条」，
     * 不代表发出去多少条。真实送达条数在派发成功后才累加，
     * 否则报表会把失败的那部分也算成已发送。
     */
    const charged = await tx.storeSmsAccount.updateMany({
      where: {
        storeId: params.storeId,
        balanceFen: { gte: params.chargedAmountFen },
      },
      data: {
        balanceFen: { decrement: params.chargedAmountFen },
        totalConsumedFen: { increment: params.chargedAmountFen },
      },
    });

    if (charged.count === 0) {
      throw new BadRequestException('短信余额不足，请先充值');
    }

    const account = await tx.storeSmsAccount.findUniqueOrThrow({
      where: { storeId: params.storeId },
      select: { balanceFen: true },
    });

    await tx.smsWalletLog.create({
      data: {
        storeId: params.storeId,
        type: 'consume',
        changeFen: -params.chargedAmountFen,
        balanceAfterFen: account.balanceFen,
        description: `群发短信扣费（${params.validMobileCount} 人 / ${params.smsSegments} 条）`,
        broadcastId: params.broadcastId,
      },
    });

    const task = await tx.smsBroadcastTask.create({
      data: {
        storeId: params.storeId,
        broadcastId: params.broadcastId,
        operatorStaffId: params.operatorStaffId,
        content: params.content,
        status: 'sending',
        recipientCount: params.recipientCount,
        validMobileCount: params.validMobileCount,
        smsSegments: params.smsSegments,
        unitPriceFen: params.unitPriceFen,
        chargedAmountFen: params.chargedAmountFen,
        idempotencyKey: params.idempotencyKey,
      },
      select: { id: true },
    });

    await tx.smsBroadcastRecipient.createMany({
      data: params.recipients.map((recipient) => ({
        taskId: task.id,
        customerId: recipient.customerId,
        phone: recipient.phone,
        status: 'pending',
      })),
    });

    return task.id;
  }

  /**
   * 唯一索引冲突（P2002）时回读首次任务并复用其结果。
   *
   * 返回 null 表示不是幂等冲突（或首次任务已不存在），由调用方原样抛出原错误。
   */
  private async resolveDuplicate(
    error: unknown,
    params: SmsChargeParams,
  ): Promise<SmsChargeResult | null> {
    if (!this.isUniqueViolation(error)) {
      return null;
    }

    const duplicate = await this.prisma.smsBroadcastTask.findUnique({
      where: { idempotencyKey: params.idempotencyKey },
      select: DUPLICATE_TASK_SELECT,
    });
    if (!duplicate) {
      return null;
    }

    // 幂等键是全局唯一索引：不能把 A 门店的任务结果返回给 B 门店
    if (duplicate.storeId !== params.storeId) {
      throw new BadRequestException('本次发送请求已失效，请重新发起群发');
    }

    this.logger.warn(
      `群发幂等竞争命中，复用首次任务且不重复派发 idempotencyKey=${params.idempotencyKey}`,
    );

    return {
      kind: 'duplicate',
      result: {
        broadcastId: duplicate.broadcastId,
        recipientCount: duplicate.recipientCount,
        chargedAmountFen: duplicate.chargedAmountFen,
      },
    };
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }

  /** Serializable 下的写冲突 / 死锁（Prisma 错误码 P2034） */
  private isSerializationFailure(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2034'
    );
  }
}

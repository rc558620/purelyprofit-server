import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { Money } from '../../../shared/money.utils';
import { PrismaService } from '../../../prisma/prisma.service';
import { SmsAccountService } from './sms-account.service';
import { SmsQuoteService } from './sms-quote.service';
import { SmsRefundService } from './sms-refund.service';
import { SmsTencentProvider } from './sms-tencent.provider';
import {
  SMS_CHARGE_RETRY_BASE_DELAY_MS,
  SMS_CHARGE_RETRY_MAX_ATTEMPTS,
  SMS_DISPATCH_MAX_ATTEMPTS,
  SMS_DISPATCH_STUCK_TIMEOUT_MS,
  SMS_NO_PROVIDER_STATUS_CODE,
} from './sms.constants';
import type { SmsBroadcastStatusValue } from './sms.constants';
import type {
  CreateSmsBroadcastDto,
  SmsBroadcastResponseDto,
} from './dto/sms.dto';
import { SMS_IDEMPOTENCY_KEY_PATTERN } from './dto/sms.dto';
import type { SmsResolvedRecipient, SmsSendResultItem } from './sms.types';
import {
  buildSmsBroadcastId,
  calcSmsSegments,
  countSmsSegmentDiff,
  resolveSmsCostPriceFen,
  resolveSmsSegmentCountMode,
  resolveSmsSegmentLimits,
} from './sms.utils';

/** 事务隔离级别：并发扣费必须串行，避免两个请求同时读到「余额够」 */
const CHARGE_ISOLATION_LEVEL: Prisma.TransactionIsolationLevel =
  Prisma.TransactionIsolationLevel.Serializable;

/**
 * 发送结果写回的批大小。
 *
 * 逐条 updateMany 是业务约束（见 persistResults），但把整批号码一次性并发出去，
 * 万人群发就是上万个并发 UPDATE，会瞬间打满 Prisma 连接池、把同进程其它模块的
 * 查询一起拖慢。改为批内并行、批间串行后，峰值并发恒定为本常量。
 */
const SMS_PERSIST_BATCH_SIZE = 50;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** 扣费事务入参 */
interface SmsChargeParams {
  storeId: number;
  operatorStaffId: number | null;
  broadcastId: string;
  idempotencyKey: string;
  content: string;
  recipientCount: number;
  validMobileCount: number;
  smsSegments: number;
  unitPriceFen: number;
  chargedAmountFen: number;
  recipients: SmsResolvedRecipient[];
}

/**
 * 派发入参。
 *
 * 刻意**不传**「之前轮次的成功/失败累计」：任务计数一律以数据库为准重新统计，
 * 传累计值反而会在重发时把旧值叠加上去、产生虚高（成功/失败/未决三态互斥，
 * 重发只会让明细在三者之间迁移，不会凭空多出一条）。
 */
interface SmsDispatchParams {
  taskId: number;
  storeId: number;
  content: string;
  /** 本轮要发的号码（已去重由 runDispatch 负责） */
  targets: { phone: string }[];
}

/**
 * 群发短信执行服务。
 *
 * 资金安全四原则：
 * 1. **先扣后发**：扣费成功后才调通道，避免「发出去了但没扣到钱」；
 * 2. **通道不可用不扣费**：凭证 / 模板缺失时在生产环境直接拒绝，
 *    而不是先扣钱再「假装发送成功」（见 {@link SmsTencentProvider}）；
 * 3. **失败不退费**：发送失败只记 recipient 状态，退费必须走单独接口写 refund 流水，
 *    否则会出现「通道侧偶发失败 → 自动退费 → 用户重复白嫖」的资金漏洞；
 * 4. **幂等且可恢复**：idempotencyKey 唯一索引 + 事务保证只扣一次；
 *    但幂等命中**不等于送达**——已送达才复用首次结果，未送达（failed 或
 *    卡在 sending）则补发未完成的收件人，避免「扣了钱、没发短信、还显示成功」。
 */
@Injectable()
export class SmsBroadcastService {
  private readonly logger = new Logger(SmsBroadcastService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly quoteService: SmsQuoteService,
    private readonly accountService: SmsAccountService,
    private readonly provider: SmsTencentProvider,
    private readonly refundService: SmsRefundService,
  ) {}

  async broadcast(
    storeId: number,
    operatorStaffId: number | null,
    dto: CreateSmsBroadcastDto,
  ): Promise<SmsBroadcastResponseDto> {
    this.assertIdempotencyKey(dto.idempotencyKey);

    // ── 幂等：先看这个 key 是否已经建过任务 ──
    const existing = await this.prisma.smsBroadcastTask.findUnique({
      where: { idempotencyKey: dto.idempotencyKey },
      select: {
        id: true,
        storeId: true,
        broadcastId: true,
        recipientCount: true,
        chargedAmountFen: true,
        status: true,
        updatedAt: true,
      },
    });

    if (existing) {
      // 幂等键是**全局唯一**索引：不能让 A 门店的 key 把 B 门店的任务结果返回出去
      if (existing.storeId !== storeId) {
        throw new BadRequestException('本次发送请求已失效，请重新发起群发');
      }

      const firstResult: SmsBroadcastResponseDto = {
        broadcastId: existing.broadcastId,
        recipientCount: existing.recipientCount,
        chargedAmountFen: existing.chargedAmountFen,
      };

      // 已送达（全成功 / 部分失败）：复用首次结果，绝不重复发送
      if (existing.status === 'sent' || existing.status === 'partial_failed') {
        this.logger.log(
          `群发幂等命中（已送达），broadcastId=${existing.broadcastId}`,
        );
        return firstResult;
      }

      // 在途：首次请求还在发，重复派发会让同一批人收到两条短信
      if (existing.status === 'sending' && !this.isStuck(existing)) {
        this.logger.log(
          `群发幂等命中（在途），broadcastId=${existing.broadcastId}`,
        );
        return firstResult;
      }

      /*
       * failed 或卡死的 sending：钱已扣但没发完。
       * 补发**未送达**的收件人（已成功的不再重发），且不重复扣费——
       * 用户付过钱就该拿到短信，而不是拿到一句「已发送」。
       */
      this.logger.warn(
        `群发幂等命中（未送达，触发补发）：broadcastId=${existing.broadcastId} status=${existing.status}`,
      );
      await this.resumeDispatch(existing.id);
      return firstResult;
    }

    // 通道不可用必须在**扣费之前**拦住：扣了钱却发不出去是最难解释的事故
    if (!this.provider.isChannelReady() && this.isProduction()) {
      this.logger.error(
        `拒绝群发：短信通道未配置（storeId=${storeId}），已阻止扣费`,
      );
      throw new BadRequestException('短信通道暂不可用，请稍后再试或联系平台');
    }

    const snapshot = await this.quoteService.loadQuote(dto.quoteId);
    if (!snapshot || snapshot.storeId !== storeId) {
      // 面向商家的文案：不用「询价单」这类内部说法（停留超时会触发，出现频率不低）
      throw new BadRequestException(
        '价格信息已失效，请返回上一步重新确认后再发送',
      );
    }

    // 提交人群必须与询价人群一致，否则询价金额与实际发送对不上
    const submittedIds = this.quoteService.parseCustomerIds(dto.customerIds);
    if (!this.isSameIdSet(submittedIds, snapshot.customerIds)) {
      throw new BadRequestException(
        '收件人已变更，请返回上一步重新确认后再发送',
      );
    }

    const { recipients } = await this.quoteService.resolveRecipients(
      storeId,
      snapshot.customerIds,
    );
    if (recipients.length === 0) {
      throw new BadRequestException('所选收件人均无有效手机号，无法发送');
    }

    const limits = resolveSmsSegmentLimits(this.configService);
    /*
     * 口径**沿用询价快照里固化的值**，而不是重新读配置：
     * 切换 sms.segmentCountMode 的瞬间，飞行中的询价单若按新口径重算，
     * 会出现「询价显示 ¥10、实际扣 ¥12」——那是商户最不能接受的事。
     * 拿不到（极早期的旧快照）才回落到当前配置。
     */
    const segmentMode =
      snapshot.segmentMode ?? resolveSmsSegmentCountMode(this.configService);
    // 单价与正文以询价快照为准：防止「询价时 5 分、发送时涨价」的金额漂移
    const smsSegments = calcSmsSegments(
      snapshot.content,
      recipients.length,
      limits,
      segmentMode,
    );

    this.warnIfSegmentModeDiffers(snapshot.content, limits, segmentMode);
    this.warnIfMarginNegative(snapshot.unitPriceFen, smsSegments);
    const chargedAmountFen = Money.fromDbCents(snapshot.unitPriceFen)
      .multiply(smsSegments)
      .toDbCents();

    const broadcastId = buildSmsBroadcastId();

    const task = await this.chargeAndCreateTask({
      storeId,
      operatorStaffId,
      broadcastId,
      idempotencyKey: dto.idempotencyKey,
      content: snapshot.content,
      recipientCount: snapshot.recipientCount,
      validMobileCount: recipients.length,
      smsSegments,
      unitPriceFen: snapshot.unitPriceFen,
      chargedAmountFen,
      recipients,
    });

    // 发送不在事务内：事务只保证「钱扣对了」，通道结果单独记录
    await this.runDispatch({
      taskId: task.id,
      storeId,
      content: snapshot.content,
      targets: recipients,
    });

    return {
      broadcastId,
      recipientCount: snapshot.recipientCount,
      chargedAmountFen,
    };
  }

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

  // ─── 扣费事务 ──────────────────────────────────────────────────────────────

  /**
   * 扣费事务（带 Serializable 写冲突重试）。
   *
   * Serializable 隔离级别能防住并发超扣，代价是并发写会抛 **P2034**
   * （write conflict / deadlock）——数据库直接拒绝其中一个事务。
   * 这不是资金问题（重试后余额条件会重新判定），不重试就会白白失败一次
   * 群发。因此这里对 P2034 做有限次重试，其余错误（含余额不足、幂等冲突）
   * 一律不重试：它们重试一万次结果也一样。
   */
  private async chargeAndCreateTask(
    params: SmsChargeParams,
  ): Promise<{ id: number }> {
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

  private async chargeOnce(params: SmsChargeParams): Promise<{ id: number }> {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
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

          return task;
        },
        { isolationLevel: CHARGE_ISOLATION_LEVEL },
      );
    } catch (error) {
      // 并发下唯一索引兜底：另一个请求刚用同一个 key 建了任务，返回它的结果
      if (this.isUniqueViolation(error)) {
        const duplicate = await this.prisma.smsBroadcastTask.findUnique({
          where: { idempotencyKey: params.idempotencyKey },
          select: { id: true },
        });
        if (duplicate) {
          this.logger.warn(
            `群发幂等竞争命中，返回已存在任务 idempotencyKey=${params.idempotencyKey}`,
          );
          return duplicate;
        }
      }
      throw error;
    }
  }

  // ─── 派发 ──────────────────────────────────────────────────────────────────

  /**
   * 执行一轮派发并写回结果。
   *
   * 首次发送与补偿重发共用同一套逻辑，不区分「第几轮」：
   * 结束后统一按数据库重新统计三种状态，因此重发不会把计数叠加虚高。
   */
  private async runDispatch(params: SmsDispatchParams): Promise<void> {
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
    const successCount = counts.success;
    const failedCount = counts.failed;
    const pendingCount = counts.pending;

    // 有未决明细就保持 sending：补偿任务会把它们捞出来重发，直到落定或判死
    const status: SmsBroadcastStatusValue =
      pendingCount > 0
        ? 'sending'
        : failedCount === 0
          ? 'sent'
          : successCount === 0
            ? 'failed'
            : 'partial_failed';

    const firstError = results.find(
      (item) => !item.ok && item.code !== SMS_NO_PROVIDER_STATUS_CODE,
    );

    await this.prisma.smsBroadcastTask.update({
      where: { id: taskId },
      data: {
        status,
        successCount,
        failedCount,
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

    if (failedCount > 0) {
      this.logger.warn(
        `群发短信部分失败：taskId=${taskId}，累计失败 ${failedCount} 条（已自动退费，无需人工处理）`,
      );
    }
  }

  /** 按明细统计成功 / 失败 / 未决数量 */
  private async countRecipients(taskId: number): Promise<{
    success: number;
    failed: number;
    pending: number;
  }> {
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
    const grouped = await this.prisma.smsBroadcastRecipient.groupBy({
      by: ['status'],
      where: { taskId },
      _count: { _all: true },
    });

    const countOf = (status: string): number =>
      grouped.find((row) => row.status === status)?._count._all ?? 0;

    const successCount = countOf('success');
    const failedCount = countOf('failed');

    const status: SmsBroadcastStatusValue =
      failedCount === 0
        ? 'sent'
        : successCount === 0
          ? 'failed'
          : 'partial_failed';

    await this.prisma.smsBroadcastTask.update({
      where: { id: taskId },
      data: { status, successCount, failedCount },
    });

    this.logger.warn(
      `群发任务状态收敛：taskId=${taskId} → ${status}（成功 ${successCount} / 失败 ${failedCount}）`,
    );
  }

  /**
   * 派发次数用尽：剩余收件人标记为失败，任务转 failed 等人工退费。
   *
   * 不停重试的原因：继续重试只会反复消耗通道额度并把问题藏起来，
   * 这类任务必须由人工核实后退费（见 PulseSmsService.refundBroadcast）。
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

  // ─── 私有方法 ──────────────────────────────────────────────────────────────

  private assertIdempotencyKey(key: string): void {
    if (!key || key.length > 128 || !SMS_IDEMPOTENCY_KEY_PATTERN.test(key)) {
      // 内部防御：key 由前端生成，正常不会非法。文案不暴露「幂等键」这种术语。
      throw new BadRequestException('请求参数有误，请刷新页面后重试');
    }
  }

  /**
   * 两种计费口径出现差额时**只记日志，不改钱**。
   *
   * 本地按 codepoint 计数、腾讯云按 UCS-2 计费，正文含 emoji / 生僻字时会有偏差。
   * 这里把它记录下来积累证据：**先看清楚差多少、多久出现一次**，
   * 确认后通过 `sms.segmentCountMode=utf16` 切换，而不是先改扣费公式。
   */
  private warnIfSegmentModeDiffers(
    content: string,
    limits: { singleLimit: number; longLimit: number },
    segmentMode: string,
  ): void {
    const diff = countSmsSegmentDiff(content, limits);
    if (diff === 0) {
      return;
    }
    this.logger.warn(
      `[计费口径观测] 当前 ${segmentMode} 与 UCS-2 口径相差 ${diff} 段/每人` +
        `（正文长度 ${content.length} 字符）——确认后可通过 sms.segmentCountMode 切换`,
    );
  }

  /**
   * 毛利倒挂告警。
   *
   * 这是「每发一条都在亏」的**唯一**发现手段：售价 `unitPriceFen` 若不高
   * 于采购成本 `sms.costPriceFen`，那么退费策略做得再完美也没意义——
   * 发出去的每一条都在亏钱，发得越多亏得越多。
   *
   * 成本价默认 0（未配置）时不告警；**填了真实采购价才会生效**。
   */
  private warnIfMarginNegative(
    unitPriceFen: number,
    smsSegments: number,
  ): void {
    const costPriceFen = resolveSmsCostPriceFen(this.configService);
    if (costPriceFen <= 0) {
      return;
    }

    const marginFen = unitPriceFen - costPriceFen;
    if (marginFen >= 0) {
      return;
    }

    // ERROR 级：这是持续失血，不是偶发异常
    this.logger.error(
      `[毛利倒挂] 售价 ${unitPriceFen} 分/条 < 成本 ${costPriceFen} 分/条，` +
        `本次亏损 ${Math.abs(marginFen) * smsSegments} 分（${smsSegments} 条）——` +
        `请调整 sms.unitPriceFen 或重新谈判采购价`,
    );
  }

  /** 任务停在 sending 超过阈值即视为卡死（进程崩溃 / 写库失败） */
  private isStuck(task: {
    status: SmsBroadcastStatusValue;
    updatedAt: Date;
  }): boolean {
    return (
      Date.now() - task.updatedAt.getTime() >= SMS_DISPATCH_STUCK_TIMEOUT_MS
    );
  }

  private isProduction(): boolean {
    return this.configService.get<string>('nodeEnv') === 'production';
  }

  private isSameIdSet(a: number[], b: number[]): boolean {
    if (a.length !== b.length) {
      return false;
    }
    const setA = new Set(a);
    return b.every((id) => setA.has(id));
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

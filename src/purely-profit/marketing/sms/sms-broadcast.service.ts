import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Money } from '../../../shared/money.utils';
import { PrismaService } from '../../../prisma/prisma.service';
import { SmsBroadcastChargeService } from './sms-broadcast-charge.service';
import { SmsBroadcastDispatchService } from './sms-broadcast-dispatch.service';
import { SmsQuoteService } from './sms-quote.service';
import { SmsTencentProvider } from './sms-tencent.provider';
import { SMS_DISPATCH_STUCK_TIMEOUT_MS } from './sms.constants';
import type { SmsBroadcastStatusValue } from './sms.constants';
import type {
  CreateSmsBroadcastDto,
  SmsBroadcastResponseDto,
} from './dto/sms-broadcast.dto';
import { SMS_IDEMPOTENCY_KEY_PATTERN } from './sms.constants';
import type { SmsQuoteSnapshot, SmsResolvedRecipient } from './sms.types';
import {
  buildSmsBroadcastId,
  calcSmsSegments,
  countSmsSegmentDiff,
  resolveSmsCostPriceFen,
  resolveSmsSegmentCountMode,
  resolveSmsSegmentLimits,
} from './sms.utils';

/** 幂等命中时回读的字段（用于复用首次结果 / 判断是否卡死） */
const EXISTING_TASK_SELECT = {
  id: true,
  storeId: true,
  broadcastId: true,
  recipientCount: true,
  chargedAmountFen: true,
  status: true,
  updatedAt: true,
} as const;

/** 扣费前的计费计划：询价快照校验 + 收件人解析 + 金额固化 */
interface SmsChargePlan {
  broadcastId: string;
  content: string;
  recipientCount: number;
  recipients: SmsResolvedRecipient[];
  smsSegments: number;
  unitPriceFen: number;
  chargedAmountFen: number;
}

/**
 * 群发短信执行服务（编排层）。
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
 *
 * 职责拆分：本类只做幂等判定、快照校验与编排；
 * 扣费事务见 {@link SmsBroadcastChargeService}，通道派发与结果写回见
 * {@link SmsBroadcastDispatchService}。
 */
@Injectable()
export class SmsBroadcastService {
  private readonly logger = new Logger(SmsBroadcastService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly quoteService: SmsQuoteService,
    private readonly provider: SmsTencentProvider,
    private readonly chargeService: SmsBroadcastChargeService,
    private readonly dispatchService: SmsBroadcastDispatchService,
  ) {}

  async broadcast(
    storeId: number,
    operatorStaffId: number | null,
    dto: CreateSmsBroadcastDto,
  ): Promise<SmsBroadcastResponseDto> {
    this.assertIdempotencyKey(dto.idempotencyKey);

    // ── 幂等：先看这个 key 是否已经建过任务 ──
    const reused = await this.reuseExistingBroadcast(
      storeId,
      dto.idempotencyKey,
    );
    if (reused) {
      return reused;
    }

    const plan = await this.prepareChargePlan(storeId, dto);

    const chargeResult = await this.chargeService.chargeAndCreateTask({
      storeId,
      operatorStaffId,
      broadcastId: plan.broadcastId,
      idempotencyKey: dto.idempotencyKey,
      content: plan.content,
      recipientCount: plan.recipientCount,
      validMobileCount: plan.recipients.length,
      smsSegments: plan.smsSegments,
      unitPriceFen: plan.unitPriceFen,
      chargedAmountFen: plan.chargedAmountFen,
      recipients: plan.recipients,
    });

    // 并发幂等冲突：首次请求已建任务并负责派发，本次直接复用首次结果
    if (chargeResult.kind === 'duplicate') {
      return chargeResult.result;
    }

    // 发送不在事务内：事务只保证「钱扣对了」，通道结果单独记录
    await this.dispatchService.runDispatch({
      taskId: chargeResult.taskId,
      storeId,
      content: plan.content,
      targets: plan.recipients,
    });

    return {
      broadcastId: plan.broadcastId,
      recipientCount: plan.recipientCount,
      chargedAmountFen: plan.chargedAmountFen,
    };
  }

  /**
   * 补发一个「钱已扣、未送达」的任务：只重发仍处于 pending 的收件人。
   *
   * 入口由补偿扫描（SmsBroadcastRecoveryService）与幂等重试共用，
   * 实现委托给 {@link SmsBroadcastDispatchService.resumeDispatch}。
   */
  async resumeDispatch(taskId: number): Promise<void> {
    await this.dispatchService.resumeDispatch(taskId);
  }

  // ─── 幂等命中 ──────────────────────────────────────────────────────────────

  /**
   * 命中已有任务时的处置。
   *
   * @returns 可复用的首次结果；返回 null 表示没有命中，由调用方走正常扣费
   */
  private async reuseExistingBroadcast(
    storeId: number,
    idempotencyKey: string,
  ): Promise<SmsBroadcastResponseDto | null> {
    const existing = await this.prisma.smsBroadcastTask.findUnique({
      where: { idempotencyKey },
      select: EXISTING_TASK_SELECT,
    });
    if (!existing) {
      return null;
    }

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

  // ─── 扣费前的校验与计费 ────────────────────────────────────────────────────

  private async prepareChargePlan(
    storeId: number,
    dto: CreateSmsBroadcastDto,
  ): Promise<SmsChargePlan> {
    this.assertChannelReady(storeId);

    const snapshot = await this.loadMatchingSnapshot(storeId, dto);
    const recipients = await this.resolveMatchedRecipients(storeId, snapshot);
    const { smsSegments, chargedAmountFen } = this.resolveChargeAmount(
      snapshot,
      recipients.length,
    );

    return {
      broadcastId: buildSmsBroadcastId(),
      content: snapshot.content,
      recipientCount: snapshot.recipientCount,
      recipients,
      smsSegments,
      unitPriceFen: snapshot.unitPriceFen,
      chargedAmountFen,
    };
  }

  /** 通道不可用必须在**扣费之前**拦住：扣了钱却发不出去是最难解释的事故 */
  private assertChannelReady(storeId: number): void {
    if (!this.provider.isChannelReady() && this.isProduction()) {
      this.logger.error(
        `拒绝群发：短信通道未配置（storeId=${storeId}），已阻止扣费`,
      );
      throw new BadRequestException('短信通道暂不可用，请稍后再试或联系平台');
    }
  }

  /** 读取询价快照，并校验门店归属与提交人群一致性 */
  private async loadMatchingSnapshot(
    storeId: number,
    dto: CreateSmsBroadcastDto,
  ): Promise<SmsQuoteSnapshot> {
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

    return snapshot;
  }

  /** 按快照人群解析有效收件人（无手机号 / 重复号码会被剔除） */
  private async resolveMatchedRecipients(
    storeId: number,
    snapshot: SmsQuoteSnapshot,
  ): Promise<SmsResolvedRecipient[]> {
    const { recipients } = await this.quoteService.resolveRecipients(
      storeId,
      snapshot.customerIds,
    );
    if (recipients.length === 0) {
      throw new BadRequestException('所选收件人均无有效手机号，无法发送');
    }
    return recipients;
  }

  /** 计算计费条数与扣费金额，并对口径差异 / 毛利倒挂做日志观测 */
  private resolveChargeAmount(
    snapshot: SmsQuoteSnapshot,
    validMobileCount: number,
  ): { smsSegments: number; chargedAmountFen: number } {
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
      validMobileCount,
      limits,
      segmentMode,
    );

    this.warnIfSegmentModeDiffers(snapshot.content, limits, segmentMode);
    this.warnIfMarginNegative(snapshot.unitPriceFen, smsSegments);

    const chargedAmountFen = Money.fromDbCents(snapshot.unitPriceFen)
      .multiply(smsSegments)
      .toDbCents();

    return { smsSegments, chargedAmountFen };
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
}

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  SMS_DELIVERY_FAILED_VALUES,
  SMS_DELIVERY_SUCCESS_VALUES,
} from './sms.constants';
import type {
  ParsedSmsDeliveryReport,
  RawSmsDeliveryReport,
  SmsDeliveryCallbackResult,
} from './dto/sms-delivery-callback.dto';

/** 单个回执的处理结果 */
type ApplyOutcome =
  /** 流水号缺失或查不到明细 */
  | 'unmatched'
  /** 同一结果重复推送，已忽略 */
  | 'duplicate'
  /** 状态码解析不出来（未知状态），不落库也不退费 */
  | 'unknown'
  | 'delivered'
  | 'failed';

/**
 * 腾讯云短信送达状态回执处理服务。
 *
 * 为什么必须有它：
 * - 腾讯云按「**送达成功**」计费，运营商回执失败的（空号 / 停机 / 黑名单）不计费；
 * - 而我们在 `SendSms` 同步返回 `Ok` 时就按「**受理成功**」全额扣了商户的钱。
 * 两口径不一致的结果是：给停机号码发短信，腾讯云没收我们的钱，我们却扣了商户的钱。
 *
 * 这套逻辑做的事：回执回来说「没送到」→ 把那一条的钱退给商户。
 * 让系统扣费口径与腾讯云计费口径对齐。
 *
 * 幂等要求（回执可能被重推）：
 * - 同一结果重复推送 → 直接跳过（`deliveryStatus` 未变化即判定重复）
 * - 退费用 `refundedAt` 做闸门，事务内二次确认，一条明细只会退一次
 */
@Injectable()
export class SmsDeliveryCallbackService {
  private readonly logger = new Logger(SmsDeliveryCallbackService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 处理一批回执。
   *
   * 单条失败不影响其它条：回执是零散推送的，一条解析异常不应该让整批失效，
   * 更不应该让腾讯云因拿不到成功响应而反复重推。
   */
  async handleCallback(rawBody: unknown): Promise<SmsDeliveryCallbackResult> {
    const reports = this.parseReports(rawBody);
    const result: SmsDeliveryCallbackResult = {
      received: reports.length,
      matched: 0,
      unmatched: 0,
      delivered: 0,
      failed: 0,
      duplicated: 0,
      unknown: 0,
    };

    for (const report of reports) {
      try {
        const outcome = await this.applyReport(report);
        if (outcome === 'unmatched') {
          result.unmatched += 1;
          continue;
        }
        // unknown = 定位到了明细但状态码不认识：不算已处理，单独告警
        if (outcome === 'unknown') {
          result.unknown += 1;
          continue;
        }
        result.matched += 1;
        if (outcome === 'duplicate') result.duplicated += 1;
        if (outcome === 'delivered') result.delivered += 1;
        if (outcome === 'failed') result.failed += 1;
      } catch (error) {
        // 单条失败吞掉但不静默：回执丢了等于这条短信永远退不了钱
        this.logger.error(
          `[sms-delivery] 回执处理失败 serialNo=${report.serialNo} reason=${
            error instanceof Error ? error.message : 'UnknownError'
          }`,
          error instanceof Error ? error.stack : undefined,
        );
        result.unmatched += 1;
      }
    }

    return result;
  }

  /**
   * 宽松解析回执 body。
   *
   * 支持三种形态：顶层数组、`{ data: [...] }`、`{ SmsStatusSet / reports: [...] }`。
   * 字段名逐个别名尝试，解析不出来就丢对应的 WARN 日志（看日志补别名，别改行为）。
   */
  parseReports(rawBody: unknown): ParsedSmsDeliveryReport[] {
    const list = this.extractList(rawBody);
    const reports: ParsedSmsDeliveryReport[] = [];

    for (const raw of list) {
      const serialNo = this.firstString(raw, [
        'serialNo',
        'SerialNo',
        'serial_no',
      ]);
      if (!serialNo) {
        this.logger.warn(
          `[sms-delivery] 回执缺少流水号，无法定位明细：${this.summarize(raw)}`,
        );
        continue;
      }

      // 别名要同时覆盖「推送回调」的 camelCase 和「主动拉取」的 PascalCase：
      // JS 对象 key 大小写敏感，漏一个就整条解析不出来。
      const statusRaw = this.firstScalar(raw, [
        'status',
        'ReportStatus',
        'reportStatus',
        'report_status',
        'originalStatus',
      ]);
      const message = this.firstString(raw, [
        'errMsg',
        'errmsg',
        'err_msg',
        'Description',
        'description',
      ]);
      const timeRaw = this.firstScalar(raw, [
        'userReceiveTime',
        'UserReceiveTime',
        'user_receive_time',
        'deliveryTime',
      ]);

      reports.push({
        serialNo,
        statusCode:
          statusRaw === null ? null : String(statusRaw).trim().toUpperCase(),
        message,
        deliveredAt: this.parseTime(timeRaw),
      });
    }

    return reports;
  }

  private async applyReport(
    report: ParsedSmsDeliveryReport,
  ): Promise<ApplyOutcome> {
    const recipient = await this.prisma.smsBroadcastRecipient.findFirst({
      where: { serialNo: report.serialNo },
      select: {
        id: true,
        taskId: true,
        status: true,
        deliveryStatus: true,
        phone: true,
      },
    });
    if (!recipient) {
      return 'unmatched';
    }

    const deliveryStatus = this.resolveDeliveryStatus(report.statusCode);
    if (!deliveryStatus) {
      this.logger.warn(
        `[sms-delivery] 未知送达状态码：serialNo=${report.serialNo} code=${report.statusCode ?? 'null'}（不落库）`,
      );
      return 'unknown';
    }

    // 幂等：同一结果重推直接跳过（腾讯云在响应非 0 时会重推）
    if (recipient.deliveryStatus === deliveryStatus) {
      return 'duplicate';
    }

    await this.prisma.smsBroadcastRecipient.update({
      where: { id: recipient.id },
      data: {
        deliveryStatus,
        deliveryCode: report.statusCode,
        deliveryMessage: report.message,
        deliveredAt: report.deliveredAt ?? new Date(),
      },
    });

    await this.syncTaskDeliveryCounts(recipient.taskId);

    /*
     * 送达失败**不退费**：计费口径是「按提交计费」，提交成功的成本已发生，
     * 送达不了是客户名单质量问题（空号 / 停机 / 黑名单），规则在发送前已明示。
     * 这里只如实记录送达结果，商户可在收件人明细里看到、自行清洗名单。
     *
     * 会退钱的只有「提交失败」（status = failed）与「派发判死」，
     * 统一由 SmsRefundService 在派发链路处理。
     */
    return deliveryStatus;
  }

  /** 按明细重算任务的送达计数（回执口径，与提交口径的 successCount 分开统计） */
  private async syncTaskDeliveryCounts(taskId: number): Promise<void> {
    const grouped = await this.prisma.smsBroadcastRecipient.groupBy({
      by: ['deliveryStatus'],
      where: { taskId },
      _count: { _all: true },
    });

    const countOf = (status: string): number =>
      grouped.find((row) => row.deliveryStatus === status)?._count._all ?? 0;

    await this.prisma.smsBroadcastTask.update({
      where: { id: taskId },
      data: {
        deliverySuccessCount: countOf('delivered'),
        deliveryFailedCount: countOf('failed'),
      },
    });
  }

  /**
   * 状态码 → 送达结果。
   *
   * 命中成功集合才是成功，命中失败集合才是失败，**其余一律 unknown**：
   * 未知的中间态（如"已提交运营商"）既不能算送达也不能按失败退钱。
   */
  private resolveDeliveryStatus(
    code: string | null,
  ): 'delivered' | 'failed' | null {
    if (!code) {
      return null;
    }
    if (SMS_DELIVERY_SUCCESS_VALUES.includes(code)) {
      return 'delivered';
    }
    return SMS_DELIVERY_FAILED_VALUES.includes(code) ? 'failed' : null;
  }

  // ─── 宽松取值工具 ──────────────────────────────────────────────────────────

  private extractList(rawBody: unknown): RawSmsDeliveryReport[] {
    if (Array.isArray(rawBody)) {
      return rawBody.filter((item): item is RawSmsDeliveryReport =>
        this.isRecord(item),
      );
    }
    if (this.isRecord(rawBody)) {
      for (const key of ['data', 'Data', 'SmsStatusSet', 'reports', 'result']) {
        const value = rawBody[key];
        if (Array.isArray(value)) {
          return value.filter((item): item is RawSmsDeliveryReport =>
            this.isRecord(item),
          );
        }
      }
      // 单条对象推送
      return [rawBody as RawSmsDeliveryReport];
    }
    return [];
  }

  private firstString(
    record: RawSmsDeliveryReport,
    keys: string[],
  ): string | null {
    for (const key of keys) {
      const value = (record as Record<string, unknown>)[key];
      if (typeof value === 'string' && value.trim() !== '') {
        return value.trim();
      }
      if (typeof value === 'number') {
        return String(value);
      }
    }
    return null;
  }

  private firstScalar(
    record: RawSmsDeliveryReport,
    keys: string[],
  ): string | number | null {
    for (const key of keys) {
      const value = (record as Record<string, unknown>)[key];
      if (typeof value === 'string' || typeof value === 'number') {
        return value;
      }
    }
    return null;
  }

  private parseTime(value: string | number | null): Date | null {
    if (value === null) {
      return null;
    }
    // 秒级时间戳
    if (typeof value === 'number' && Number.isFinite(value)) {
      return new Date(value > 1e12 ? value : value * 1000);
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  /** 回执摘要（只在 WARN 里用，避免把整条报文打进日志） */
  private summarize(record: RawSmsDeliveryReport): string {
    return JSON.stringify(record).slice(0, 300);
  }
}

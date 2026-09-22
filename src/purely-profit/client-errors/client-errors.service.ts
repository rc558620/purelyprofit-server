import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { buildClientErrorLog } from './client-errors-log.builder';
import { ClientErrorSampler } from './client-errors-sampler';
import type { ClientErrorReportDto } from './dto/client-error-report.dto';
import type { ClientErrorRequestMeta } from './client-errors.types';

/**
 * 前端错误上报接收服务。
 *
 * 与 business-events 一样只落结构化日志、不落库：
 * 上报量级不可控（无鉴权 + 可能成风暴），同步写库会把不可控流量引到数据库，
 * 而趋势 / 聚合 / 回归对比这类诉求交给日志管线更合适。
 * 后续若需要按 aggregateKey 建索引做长期趋势，再迁移到专用分析存储，接口无需变更。
 *
 * 降噪靠 ClientErrorSampler 按窗口采样，而不是靠丢弃校验失败的 payload。
 */
@Injectable()
export class ClientErrorsService {
  private readonly logger = new Logger(ClientErrorsService.name);
  private readonly enabled: boolean;
  private readonly stackMaxLength: number;
  private readonly detailsMaxLength: number;
  private readonly appHosts: string[];
  private readonly sampleWindowSeconds: number;
  private readonly sampler: ClientErrorSampler;

  constructor(private readonly configService: ConfigService) {
    this.enabled =
      this.configService.get<boolean>('app.clientErrorLogEnabled') ?? true;
    this.stackMaxLength = this.readPositiveNumberConfig(
      'app.clientErrorStackMaxLength',
      2000,
    );
    this.detailsMaxLength = this.readPositiveNumberConfig(
      'app.clientErrorDetailsMaxLength',
      2000,
    );
    this.appHosts =
      this.configService.get<string[]>('app.clientErrorAppHosts') ?? [];

    this.sampleWindowSeconds = this.readPositiveNumberConfig(
      'app.clientErrorSampleWindowSeconds',
      60,
    );
    this.sampler = new ClientErrorSampler(
      this.sampleWindowSeconds * 1000,
      this.readNonNegativeNumberConfig('app.clientErrorSampleMaxPerWindow', 5),
    );
  }

  report(
    payload: ClientErrorReportDto,
    requestMeta: ClientErrorRequestMeta,
  ): void {
    if (!this.enabled) {
      return;
    }

    const { severity, logEntry } = buildClientErrorLog(payload, requestMeta, {
      stackMaxLength: this.stackMaxLength,
      detailsMaxLength: this.detailsMaxLength,
      appHosts: this.appHosts,
    });

    const decision = this.sampler.acquire(logEntry.aggregateKey);
    if (decision.action === 'suppress') {
      return;
    }

    // 上一窗口被压掉的条数：让「风暴规模」这个信号不至于完全丢失
    if (decision.suppressedSummary) {
      this.logger.warn(
        JSON.stringify({
          event: 'client_error_suppressed_summary',
          domain: 'client_errors',
          aggregateKey: logEntry.aggregateKey,
          logCode: logEntry.logCode,
          alertLevel: logEntry.alertLevel,
          suppressedCount: decision.suppressedSummary,
          windowSeconds: this.sampleWindowSeconds,
          receivedAt: logEntry.receivedAt,
        }),
      );
    }

    // 整条日志必须是单行 JSON：stack 已内联进 logEntry（换行被转义），
    // 不能再作为 logger.error 的第二个参数输出（ConsoleLogger 会原样写入含 \n 的
    // stack，导致一条记录跨多行，行式日志采集器解析失败）。
    const logMessage = JSON.stringify(logEntry);

    if (severity === 'error') {
      this.logger.error(logMessage);
      return;
    }

    this.logger.warn(logMessage);
  }

  private readPositiveNumberConfig(
    configKey: string,
    fallback: number,
  ): number {
    const value = this.configService.get<number>(configKey);
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      return fallback;
    }

    return Math.floor(value);
  }

  private readNonNegativeNumberConfig(
    configKey: string,
    fallback: number,
  ): number {
    const value = this.configService.get<number>(configKey);
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      return fallback;
    }

    return Math.floor(value);
  }
}

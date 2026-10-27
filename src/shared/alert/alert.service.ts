/**
 * 资金链路告警服务。
 *
 * 定位：**只服务需要人工立刻介入的资金事故**，不是通用日志通道。
 * 典型场景：支付回调队列重试耗尽（钱已扣、余额未到账）、落账失败、
 * 回调验签失败突增。这些事件此前只进日志，没人会在事后翻日志，
 * 结果是用户投诉「钱扣了没到账」才被发现。
 *
 * 设计约束：
 * - 告警失败**绝不能**影响业务主流程：发送异常只记日志，不向上抛；
 * - 未配置 webhook 时退化为结构化日志，保证本地与未接入环境不报错；
 * - 同一 key 在抑制窗口内只发一次，避免一次故障刷屏后被当成噪音忽略。
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type AlertLevel = 'warn' | 'error';

export interface SendAlertParams {
  /** 告警级别 */
  level: AlertLevel;
  /** 简短标题，便于在通知列表里扫读 */
  title: string;
  /** 正文：必须带上可定位的订单号 / 门店 / 原因 */
  content: string;
  /**
   * 抑制键：同一 key 在 {@link SUPPRESS_WINDOW_MS} 内只发送一次。
   * 不传时按 title 兜底。
   */
  suppressKey?: string;
}

/** 告警请求超时（毫秒） */
const ALERT_REQUEST_TIMEOUT_MS = 5000;

/** 同一告警的抑制窗口（毫秒）：30 分钟内不重复打扰 */
const SUPPRESS_WINDOW_MS = 30 * 60 * 1000;

/** 抑制表最大条目数，防止长期运行把内存撑大 */
const SUPPRESS_MAP_MAX_SIZE = 500;

@Injectable()
export class AlertService {
  private readonly logger = new Logger(AlertService.name);

  /** suppressKey → 上次发送时间 */
  private readonly lastSentAtByKey = new Map<string, number>();

  constructor(private readonly configService: ConfigService) {}

  /**
   * 发送告警。
   *
   * 调用方无需 try/catch：本方法保证不抛异常，
   * 避免「告警通道挂了」反过来把支付链路拖垮。
   */
  async send(params: SendAlertParams): Promise<void> {
    this.logAlert(params);

    const key = params.suppressKey ?? params.title;
    if (this.isSuppressed(key)) {
      return;
    }
    this.markSent(key);

    const webhookUrl = this.configService
      .get<string>('alert.webhookUrl')
      ?.trim();
    if (!webhookUrl) {
      return;
    }

    await this.postWebhook(webhookUrl, params);
  }

  private logAlert(params: SendAlertParams): void {
    const message = `[告警][${params.title}] ${params.content}`;
    if (params.level === 'error') {
      this.logger.error(message);
      return;
    }
    this.logger.warn(message);
  }

  private async postWebhook(
    webhookUrl: string,
    params: SendAlertParams,
  ): Promise<void> {
    const body = JSON.stringify({
      level: params.level,
      title: params.title,
      content: params.content,
      sentAt: new Date().toISOString(),
    });

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'purelyprofit-server/1.0',
        },
        body,
        signal: AbortSignal.timeout(ALERT_REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        this.logger.error(
          `告警推送失败 httpStatus=${response.status} title=${params.title}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `告警推送异常 title=${params.title}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private isSuppressed(key: string): boolean {
    const lastSentAt = this.lastSentAtByKey.get(key);
    return (
      lastSentAt !== undefined && Date.now() - lastSentAt < SUPPRESS_WINDOW_MS
    );
  }

  private markSent(key: string): void {
    // 抑制表膨胀保护：简单清空重建，告警抑制本身不需要严格 LRU
    if (this.lastSentAtByKey.size >= SUPPRESS_MAP_MAX_SIZE) {
      this.lastSentAtByKey.clear();
    }
    this.lastSentAtByKey.set(key, Date.now());
  }
}

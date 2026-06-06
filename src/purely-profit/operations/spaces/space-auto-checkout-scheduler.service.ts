import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SpaceSessionSettlementService } from './space-session-settlement.service';

/**
 * 后台定时调度：每隔固定时间扫描所有门店，自动结账已到期的倒计时空间会话。
 * 解决自动结账仅在进入空间管理页面时才触发的缺陷。
 *
 * 与 CachePrewarmService 保持一致的 setInterval + lifecycle hooks 模式，
 * 不引入 @nestjs/schedule 依赖。
 */
@Injectable()
export class SpaceAutoCheckoutSchedulerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(SpaceAutoCheckoutSchedulerService.name);
  private initialDelayTimer: NodeJS.Timeout | null = null;
  private intervalTimer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private readonly enabled: boolean;
  private readonly intervalMs: number;
  private readonly initialDelayMs: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly settlementService: SpaceSessionSettlementService,
  ) {
    this.enabled =
      this.configService.get<boolean>('app.spaceAutoCheckoutEnabled') ?? true;
    this.intervalMs =
      this.configService.get<number>('app.spaceAutoCheckoutIntervalMs') ??
      60_000;
    this.initialDelayMs =
      this.configService.get<number>('app.spaceAutoCheckoutInitialDelayMs') ??
      10_000;
  }

  onModuleInit(): void {
    if (!this.enabled) {
      this.logger.log('[space-auto-checkout-scheduler] disabled by config');
      return;
    }

    this.logger.log(
      `[space-auto-checkout-scheduler] starting intervalMs=${this.intervalMs} initialDelayMs=${this.initialDelayMs}`,
    );

    this.initialDelayTimer = setTimeout(() => {
      void this.runCycle();
      this.intervalTimer = setInterval(() => {
        void this.runCycle();
      }, this.intervalMs);
    }, this.initialDelayMs);
  }

  onModuleDestroy(): void {
    if (this.initialDelayTimer) {
      clearTimeout(this.initialDelayTimer);
      this.initialDelayTimer = null;
    }

    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }

    this.logger.log('[space-auto-checkout-scheduler] stopped');
  }

  private async runCycle(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    const startedAt = Date.now();

    try {
      const settledCount =
        await this.settlementService.autoCheckoutAllExpiredSessions(Date.now());
      const durationMs = Date.now() - startedAt;

      if (settledCount > 0) {
        this.logger.log(
          `[space-auto-checkout-scheduler] cycle settled=${settledCount} durationMs=${durationMs}`,
        );
      }
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      this.logger.error(
        `[space-auto-checkout-scheduler] cycle failed durationMs=${durationMs} reason=${
          error instanceof Error ? error.name : 'UnknownError'
        }`,
        error instanceof Error ? error.stack : undefined,
      );
    } finally {
      this.isRunning = false;
    }
  }
}

import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { RedisService } from '../../../redis/redis.service';
import { SpaceSessionAutoCheckoutService } from './space-session-auto-checkout.service';

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
  private cycleLockToken: string | null = null;
  private readonly lockTtlSeconds = 90;
  private readonly lockKey = 'space:auto-checkout-scheduler:cycle';
  private readonly enabled: boolean;
  private readonly intervalMs: number;
  private readonly initialDelayMs: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly autoCheckoutService: SpaceSessionAutoCheckoutService,
    private readonly redisService: RedisService,
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
      this.intervalTimer.unref?.();
    }, this.initialDelayMs);
    this.initialDelayTimer.unref?.();
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
    const token = randomUUID();
    const acquired = await this.redisService.setIfAbsent(
      this.lockKey,
      token,
      this.lockTtlSeconds,
    );
    if (!acquired) {
      return;
    }
    this.cycleLockToken = token;

    const startedAt = Date.now();

    try {
      const settledCount =
        await this.autoCheckoutService.autoCheckoutAllExpiredSessions(
          Date.now(),
        );
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
      await this.releaseCycleLock();
    }
  }

  private async releaseCycleLock(): Promise<void> {
    if (!this.cycleLockToken) {
      return;
    }
    try {
      const current = await this.redisService.get(this.lockKey);
      if (current === this.cycleLockToken) {
        await this.redisService.del(this.lockKey);
      }
    } catch (error) {
      this.logger.warn(
        `[space-auto-checkout-scheduler] releaseLock failed reason=${error instanceof Error ? error.message : 'UnknownError'}`,
      );
    } finally {
      this.cycleLockToken = null;
    }
  }
}

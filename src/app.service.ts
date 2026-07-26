import { Injectable } from '@nestjs/common';
import type {
  HealthSnapshot,
  MetricsSnapshot,
  ReadinessDependencySnapshot,
  ReadinessSnapshot,
} from './observability';
import { getHealthSnapshot, getRuntimeMetricsSnapshot } from './observability';
import { PrismaService } from './prisma/prisma.service';
import { RedisService } from './redis/redis.service';
import { ScanOrderingRealtimeService } from './purely-club/scan-ordering/scan-ordering-realtime.service';

@Injectable()
export class AppService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly redisService: RedisService,
    private readonly scanOrderingRealtimeService: ScanOrderingRealtimeService,
  ) {}

  getHello(): string {
    return 'Hello World!';
  }

  getHealth(): HealthSnapshot {
    return getHealthSnapshot();
  }

  async getReadiness(): Promise<ReadinessSnapshot> {
    const dependencies = await Promise.all([
      this.checkDependency('database', async () =>
        this.prismaService.checkReadiness(),
      ),
      this.checkDependency('redis', async () =>
        this.redisService.checkReadiness(),
      ),
      this.checkDependency('realtime', async () =>
        this.scanOrderingRealtimeService.checkReadiness(),
      ),
    ]);

    return {
      status: dependencies.every((dependency) => dependency.status === 'up')
        ? 'ok'
        : 'error',
      generatedAt: new Date().toISOString(),
      dependencies,
    };
  }

  getMetrics(): MetricsSnapshot {
    return getRuntimeMetricsSnapshot();
  }

  private async checkDependency(
    name: ReadinessDependencySnapshot['name'],
    check: () => Promise<void>,
  ): Promise<ReadinessDependencySnapshot> {
    const startedAt = Date.now();

    try {
      await check();
      return {
        name,
        status: 'up',
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      const details = error instanceof Error ? error.message : 'unknown error';
      return {
        name,
        status: 'down',
        latencyMs: Date.now() - startedAt,
        details,
      };
    }
  }
}

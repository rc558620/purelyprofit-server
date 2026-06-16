import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { recordSqlQuery } from '../observability';

@Injectable()
export class PrismaService
  extends PrismaClient<Prisma.PrismaClientOptions, 'query'>
  implements OnModuleInit, OnModuleDestroy
{
  private readonly pool: Pool;

  constructor(configService: ConfigService) {
    const connectionString = configService.get<string>('database.url');
    const poolMax = configService.get<number>('database.poolMax') ?? 20;
    const poolIdleTimeoutMs =
      configService.get<number>('database.poolIdleTimeoutMs') ?? 30_000;
    const poolConnectionTimeoutMs =
      configService.get<number>('database.poolConnectionTimeoutMs') ?? 5_000;
    const pool = new Pool({
      connectionString,
      max: poolMax,
      idleTimeoutMillis: poolIdleTimeoutMs,
      connectionTimeoutMillis: poolConnectionTimeoutMs,
    });
    const adapter = new PrismaPg(pool);
    const slowQueryLogEnabled =
      configService.get<boolean>('app.slowQueryLogEnabled') ?? true;
    const slowQueryThresholdMs =
      configService.get<number>('app.slowQueryThresholdMs') ?? 80;
    const sqlMetricsEnabled =
      configService.get<boolean>('app.sqlMetricsEnabled') ?? true;
    const queryListenerEnabled = sqlMetricsEnabled || slowQueryLogEnabled;

    super({
      adapter,
      log: queryListenerEnabled ? [{ emit: 'event', level: 'query' }] : [],
    });

    this.pool = pool;

    if (queryListenerEnabled) {
      this.$on('query', (event: Prisma.QueryEvent) => {
        if (sqlMetricsEnabled) {
          recordSqlQuery({
            query: event.query,
            durationMs: event.duration,
            slowThresholdMs: slowQueryThresholdMs,
          });
        }

        if (slowQueryLogEnabled && event.duration >= slowQueryThresholdMs) {
          const compactQuery = event.query
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 240);
          console.warn(
            `[slow-query] ${event.duration}ms target=postgres query="${compactQuery}"`,
          );
        }
      });
    }
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
    await this.pool.end();
  }

  async checkReadiness(): Promise<void> {
    await this.$queryRaw`SELECT 1`;
  }
}

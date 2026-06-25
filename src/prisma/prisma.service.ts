import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '@prisma/client';
import os from 'node:os';
import { Pool } from 'pg';
import { recordSqlQuery } from '../observability';

@Injectable()
export class PrismaService
  extends PrismaClient<Prisma.PrismaClientOptions, 'query'>
  implements OnModuleInit, OnModuleDestroy
{
  private static readonly logger = new Logger(PrismaService.name);
  private readonly pool: Pool;
  private readonly poolMax: number;
  private readonly cpuCount: number;
  private readonly statementTimeoutMs: number;

  constructor(configService: ConfigService) {
    const connectionString = configService.get<string>('database.url');
    const poolMax = configService.get<number>('database.poolMax') ?? 20;
    const cpuCount = os.cpus().length;
    const poolIdleTimeoutMs =
      configService.get<number>('database.poolIdleTimeoutMs') ?? 30_000;
    const poolConnectionTimeoutMs =
      configService.get<number>('database.poolConnectionTimeoutMs') ?? 5_000;
    const pool = new Pool({
      connectionString,
      max: poolMax,
      min: configService.get<number>('database.poolMin') ?? 5,
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
    this.poolMax = poolMax;
    this.cpuCount = cpuCount;
    this.statementTimeoutMs =
      configService.get<number>('database.statementTimeoutMs') ?? 10_000;

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
          PrismaService.logger.warn(
            `[slow-query] ${event.duration}ms target=postgres query="${compactQuery}"`,
          );
        }
      });
    }
  }

  async onModuleInit() {
    this.warnIfPoolExceedsPostgresLimit();
    await this.$connect();
    await this.applyStatementTimeout();
  }

  async onModuleDestroy() {
    await this.$disconnect();
    await this.pool.end();
  }

  async checkReadiness(): Promise<void> {
    await this.$queryRaw`SELECT 1`;
  }

  /**
   * 集群模式下每个 worker 独立建池，总连接数 = worker 数 × poolMax。
   * 当总连接数超过 PostgreSQL 默认 max_connections(100) 时打印警告，
   * 提醒运维调整 PG 配置或降低 poolMax / worker 数。
   */
  private warnIfPoolExceedsPostgresLimit(): void {
    const DEFAULT_PG_MAX_CONNECTIONS = 100;
    const totalConnections = this.cpuCount * this.poolMax;

    if (totalConnections > DEFAULT_PG_MAX_CONNECTIONS) {
      PrismaService.logger.warn(
        `[prisma] ⚠️ 集群模式下 DB 连接池总量可能超限: ` +
          `workers=${this.cpuCount} × poolMax=${this.poolMax} = ${totalConnections} > ` +
          `PostgreSQL 默认 max_connections=${DEFAULT_PG_MAX_CONNECTIONS}。` +
          `建议调大 PostgreSQL max_connections 或降低 DATABASE_POOL_MAX / CLUSTER_WORKERS。`,
      );
    }
  }

  /**
   * 在每个连接上设置 statement_timeout，防止单条慢查询无限占用连接池连接。
   *
   * 默认 10 秒，可通过 DATABASE_STATEMENT_TIMEOUT_MS 环境变量调整。
   * pg.Pool 在首次查询时才真正建立连接，此处的 $executeRaw 会触发连接初始化；
   * pg 驱动会在连接池的每个新连接上执行此 SET 命令。
   */
  private async applyStatementTimeout(): Promise<void> {
    try {
      await this
        .$executeRaw`SET statement_timeout = ${this.statementTimeoutMs}`;
    } catch (error: unknown) {
      // 连接级 SET 在 pool 模式下仅在当前连接生效；
      // 如果失败（如测试环境 mock），不阻塞启动。
      PrismaService.logger.warn(
        `设置 statement_timeout 失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

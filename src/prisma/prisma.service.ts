import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '@prisma/client';
import cluster from 'node:cluster';
import os from 'node:os';
import { Pool } from 'pg';
import { recordSqlQuery } from '../observability';

/**
 * 在集群模式下根据 worker 数量与 PG max_connections 自动调整 poolMax。
 *
 * 策略：
 * - 单进程模式：使用用户配置的 poolMax（默认 20）
 * - 集群模式：确保 worker 数 × effectivePoolMax 不超过 pgMaxConnections
 *   effectivePoolMax = max(poolMin, floor(pgMaxConnections / workerCount) - 2)
 *   其中 -2 留出余量给管理连接
 *
 * workerCount 优先使用 CLUSTER_WORKERS 环境变量（通过 ConfigService），
 * 未配置时回退到 os.cpus().length。
 * pgMaxConnections 优先使用 DATABASE_PG_MAX_CONNECTIONS 环境变量（通过 ConfigService），
 * 未配置时默认 100。
 */
function resolveEffectivePoolMax(
  configuredPoolMax: number,
  configuredPoolMin: number,
  configService: ConfigService,
): number {
  if (!cluster.isWorker) {
    return configuredPoolMax;
  }

  const pgMaxConnections =
    configService.get<number>('database.pgMaxConnections') ?? 100;

  if (!Number.isFinite(pgMaxConnections) || pgMaxConnections <= 0) {
    return configuredPoolMax;
  }

  const clusterWorkers = configService.get<number>('cluster.workers');
  const workerCount = clusterWorkers && clusterWorkers > 0
    ? clusterWorkers
    : os.cpus().length;
  const autoPoolMax = Math.max(
    configuredPoolMin,
    Math.floor(pgMaxConnections / workerCount) - 2,
  );

  if (autoPoolMax < configuredPoolMax) {
    PrismaService.logger.warn(
      `[prisma] 集群模式自动调整 poolMax: ` +
        `configured=${configuredPoolMax} → effective=${autoPoolMax} ` +
        `(workers=${workerCount}, pgMaxConnections=${pgMaxConnections})`,
    );
  }

  return autoPoolMax;
}

@Injectable()
export class PrismaService
  extends PrismaClient<Prisma.PrismaClientOptions, 'query'>
  implements OnModuleInit, OnModuleDestroy
{
  public static readonly logger = new Logger(PrismaService.name);
  private readonly pool: Pool;
  private readonly poolMax: number;
  private readonly cpuCount: number;
  private readonly pgMaxConnections: number;
  private readonly statementTimeoutMs: number;

  constructor(configService: ConfigService) {
    const connectionString = configService.get<string>('database.url');
    const configuredPoolMax =
      configService.get<number>('database.poolMax') ?? 20;
    const configuredPoolMin =
      configService.get<number>('database.poolMin') ?? 5;
    const clusterWorkers = configService.get<number>('cluster.workers');
    const cpuCount = clusterWorkers && clusterWorkers > 0
      ? clusterWorkers
      : os.cpus().length;
    const effectivePoolMax = resolveEffectivePoolMax(
      configuredPoolMax,
      configuredPoolMin,
      configService,
    );
    const poolIdleTimeoutMs =
      configService.get<number>('database.poolIdleTimeoutMs') ?? 30_000;
    const poolConnectionTimeoutMs =
      configService.get<number>('database.poolConnectionTimeoutMs') ?? 5_000;
    const statementTimeoutMs =
      configService.get<number>('database.statementTimeoutMs') ?? 10_000;

    // 通过连接串 options 参数注入 statement_timeout，确保连接池中每个新连接
    // 都自动获得 timeout 保护，而非依赖单次 SET 命令（仅对当前连接生效）。
    const poolUrl = new URL(connectionString!);
    const existingOptions = poolUrl.searchParams.get('options') ?? '';
    const timeoutOption = `-c statement_timeout=${statementTimeoutMs}`;
    poolUrl.searchParams.set(
      'options',
      existingOptions ? `${existingOptions} ${timeoutOption}` : timeoutOption,
    );

    const pool = new Pool({
      connectionString: poolUrl.toString(),
      max: effectivePoolMax,
      min: configuredPoolMin,
      idleTimeoutMillis: poolIdleTimeoutMs,
      connectionTimeoutMillis: poolConnectionTimeoutMs,
    });
    const adapter = new PrismaPg(pool);
    const slowQueryLogEnabled =
      configService.get<boolean>('app.slowQueryLogEnabled') ?? true;
    const slowQueryThresholdMs =
      configService.get<number>('app.slowQueryThresholdMs') ?? 80;
    const sqlMetricsEnabled =
      configService.get<boolean>('app.sqlMetricsEnabled') ?? false;
    const sqlMetricsSampleRate =
      Math.max(1, configService.get<number>('app.sqlMetricsSampleRate') ?? 1);
    // 仅当 sqlMetricsEnabled 或 slowQueryLogEnabled 任一开启时，才注册 Prisma query 事件监听
    // 生产环境建议关闭 sqlMetricsEnabled，只保留 slowQueryLogEnabled
    const queryListenerEnabled = sqlMetricsEnabled || slowQueryLogEnabled;

    super({
      adapter,
      log: queryListenerEnabled ? [{ emit: 'event', level: 'query' }] : [],
    });

    this.pool = pool;
    this.poolMax = effectivePoolMax;
    this.cpuCount = cpuCount;
    this.pgMaxConnections =
      configService.get<number>('database.pgMaxConnections') ?? 100;
    this.statementTimeoutMs = statementTimeoutMs;

    if (queryListenerEnabled) {
      let queryCounter = 0;
      this.$on('query', (event: Prisma.QueryEvent) => {
        // SQL metrics 采样：仅当 sqlMetricsEnabled 且采样率匹配时记录
        if (sqlMetricsEnabled) {
          queryCounter += 1;
          if (queryCounter % sqlMetricsSampleRate === 0) {
            recordSqlQuery({
              query: event.query,
              durationMs: event.duration,
              slowThresholdMs: slowQueryThresholdMs,
            });
          }
        }

        // slow query log 不受采样影响，始终全量记录
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
   *
   * 注意：集群模式下 poolMax 已由 resolveEffectivePoolMax 自动调整，
   * 此处仅做信息性提示，帮助运维确认连接池总量。
   */
  private warnIfPoolExceedsPostgresLimit(): void {
    const totalConnections = this.cpuCount * this.poolMax;

    if (totalConnections > this.pgMaxConnections) {
      PrismaService.logger.warn(
        `[prisma] ⚠️ 集群模式下 DB 连接池总量: ` +
          `workers=${this.cpuCount} × poolMax=${this.poolMax} = ${totalConnections}，` +
          `超过 PostgreSQL max_connections=${this.pgMaxConnections}。` +
          `建议调大 PostgreSQL max_connections 或设置 DATABASE_PG_MAX_CONNECTIONS。`,
      );
    } else if (cluster.isWorker) {
      PrismaService.logger.log(
        `[prisma] 集群模式连接池: workers=${this.cpuCount} × poolMax=${this.poolMax} = ${totalConnections}`,
      );
    }
  }

  /**
   * statement_timeout 已通过连接串 options 参数注入，每个新连接自动生效。
   * 不再需要 applyStatementTimeout()，因为 SET statement_timeout 仅对当前
   * session/连接生效，无法覆盖连接池后续新建连接。
   *
   * 旧实现的问题：$executeRaw`SET statement_timeout = ...` 只影响执行时
   * 拿到的那条连接，连接池扩容/回收重建后的新连接不会有此设置。
   * 新实现：通过 URL options=-c statement_timeout=N 让 PostgreSQL 在建连时
   * 就设置好，保证所有连接都有超时保护。
   */
}

/**
 * 事务超时分级常量。
 *
 * Prisma $transaction 的 timeout 选项控制整个事务的最大执行时间，
 * 与 statement_timeout（单条 SQL 超时）互补：
 * - statement_timeout 限制单条 SQL，防止慢查询占连接
 * - $transaction timeout 限制整个事务，防止事务长时间持有锁
 *
 * 使用示例：
 * ```ts
 * await prisma.$transaction(fn, { timeout: TX_TIMEOUT_SHORT });
 * ```
 */
export const TX_TIMEOUT_SHORT = 5_000;   // 5 秒：简单写操作（如单条 update/insert）
export const TX_TIMEOUT_MEDIUM = 15_000;  // 15 秒：多表写操作（如创建订单 + 扣减库存）
export const TX_TIMEOUT_LONG = 30_000;    // 30 秒：复杂聚合写操作（如批量结算 + 清分）

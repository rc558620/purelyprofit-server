import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * 无界增长表保留期清理服务。
 *
 * 两张表：
 * - idempotency_records：保留 7 天（expiresAt + 1 天安全余量），每 6h 执行
 * - audit_logs：保留 90 天，每 24h 执行分批 DELETE
 *
 * 分批策略：
 * - audit_logs 每批 DELETE 5000 行，批间 sleep 100ms，避免长事务和 WAL 膨胀
 * - idempotency_records 单条 DELETE（量小，无需分批）
 *
 * 多 worker 保证：
 * - BullMQ repeatable job 元数据存 Redis，多 worker 共享
 * - 任务实际执行由 worker 抢占（BLPOP），天然只有一个实例执行
 * - processor concurrency=1 确保单 worker 内不并发
 */
@Injectable()
export class RetentionCleanupService {
  private readonly logger = new Logger(RetentionCleanupService.name);

  /** idempotency_records 保留天数（expiresAt + 1 天安全余量） */
  private static readonly IDEMPOTENCY_RETENTION_DAYS = 7;
  /** audit_logs 保留天数 */
  private static readonly AUDIT_LOG_RETENTION_DAYS = 90;
  /** audit_logs 分批删除每批行数 */
  private static readonly AUDIT_LOG_BATCH_SIZE = 5000;
  /** 批间 sleep 毫秒 */
  private static readonly BATCH_SLEEP_MS = 100;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 清理 idempotency_records：删除 expires_at < NOW() - INTERVAL '1 day' 的记录。
   * 保留 7 天 = expiresAt（TTL 24h）+ 1 天安全余量。
   * 单条 SQL，无需分批（量小）。
   */
  async cleanupIdempotencyRecords(): Promise<number> {
    const startedAt = Date.now();

    const result = await this.prisma.$executeRaw`
      DELETE FROM idempotency_records
      WHERE expires_at < NOW() - INTERVAL '${RetentionCleanupService.IDEMPOTENCY_RETENTION_DAYS} days'
    `;

    const durationMs = Date.now() - startedAt;
    this.logger.log(
      `[retention-cleanup] idempotency deleted=${result} durationMs=${durationMs}`,
    );

    return result;
  }

  /**
   * 清理 audit_logs：删除 created_at < NOW() - INTERVAL '90 days' 的记录。
   * 分批 DELETE（每批 5000 行），批间 sleep 100ms，避免长事务和 WAL 膨胀。
   *
   * 分批策略：用 id > 上次最大 id 的游标推进，每批 DELETE ... WHERE id <= maxId LIMIT batchSize。
   * 先查出需删除的最大 id，再用 id 范围分批删除。
   */
  async cleanupAuditLogs(): Promise<number> {
    const startedAt = Date.now();
    let totalDeleted = 0;

    // 查出需删除的最大 id（单次聚合，不拉数据）
    const maxIdRows: Array<{ max_id: bigint }> = await this.prisma.$queryRaw`
      SELECT MAX(id) as max_id FROM audit_logs
      WHERE created_at < NOW() - INTERVAL '${RetentionCleanupService.AUDIT_LOG_RETENTION_DAYS} days'
    `;
    const maxId = maxIdRows[0]?.max_id;
    if (!maxId) {
      const durationMs = Date.now() - startedAt;
      this.logger.log(
        `[retention-cleanup] audit_logs no rows to delete durationMs=${durationMs}`,
      );
      return 0;
    }

    // 分批 DELETE：每批 batchSize 行，用 id 游标推进
    let cursorId = 0n;
    const batchSize = RetentionCleanupService.AUDIT_LOG_BATCH_SIZE;
    const sleepMs = RetentionCleanupService.BATCH_SLEEP_MS;

    while (cursorId < maxId) {
      const batchEndId = cursorId + BigInt(batchSize);
      const result = await this.prisma.$executeRaw`
        DELETE FROM audit_logs
        WHERE id > ${cursorId} AND id <= ${batchEndId}
          AND id <= ${maxId}
          AND created_at < NOW() - INTERVAL '${RetentionCleanupService.AUDIT_LOG_RETENTION_DAYS} days'
      `;
      totalDeleted += Number(result);

      const batchDurationMs = Date.now() - startedAt;
      if (Number(result) > 0) {
        this.logger.log(
          `[retention-cleanup] audit_logs batch cursorId=${cursorId} deleted=${result} totalDeleted=${totalDeleted} durationMs=${batchDurationMs}`,
        );
      }

      cursorId = batchEndId;

      // 批间 sleep，避免持续高压 DB
      if (cursorId < maxId) {
        await this.sleep(sleepMs);
      }
    }

    const durationMs = Date.now() - startedAt;
    this.logger.log(
      `[retention-cleanup] audit_logs completed totalDeleted=${totalDeleted} durationMs=${durationMs}`,
    );

    return totalDeleted;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

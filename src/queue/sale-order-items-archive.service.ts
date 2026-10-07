import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

/**
 * sale_order_items 归档服务。
 *
 * 将超过保留窗口的冷数据从 sale_order_items 迁移到 sale_order_items_archive。
 *
 * 策略：
 * - 按 created_at 游标推进，每批 batchSize 行
 * - 每批一个事务：INSERT INTO archive + DELETE FROM source，事务原子保证
 * - 幂等：INSERT...SELECT + DELETE WHERE id IN (已插入的 id)，重复执行不会重复迁移
 * - 断点续传：按 id 升序处理，失败后下次从同一游标继续
 * - 不产生长事务：单批 5000 行 INSERT+DELETE 预估 <2s
 *
 * 多 worker 保证：
 * - BullMQ repeatable job 元数据存 Redis，多 worker 共享
 * - 任务实际执行由 worker 抢占（BLPOP），天然只有一个实例执行
 * - processor concurrency=1 确保单 worker 内不并发
 */
@Injectable()
export class SaleOrderItemsArchiveService {
  private readonly logger = new Logger(SaleOrderItemsArchiveService.name);

  /** 批间 sleep 毫秒 */
  private static readonly BATCH_SLEEP_MS = 100;
  /** 单次任务最大批次数（防止一次任务跑太久） */
  private static readonly MAX_BATCHES_PER_RUN = 200;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * 执行一轮归档：分批迁移超过保留窗口的 sale_order_items 到归档表。
   *
   * @returns 迁移总行数
   */
  async archiveColdRecords(): Promise<number> {
    const retentionDays =
      this.configService.get<number>('app.archiveSaleOrderItemsRetentionDays') ??
      180;
    const batchSize =
      this.configService.get<number>('app.archiveSaleOrderItemsBatchSize') ??
      5000;
    const maxBatches = SaleOrderItemsArchiveService.MAX_BATCHES_PER_RUN;
    const sleepMs = SaleOrderItemsArchiveService.BATCH_SLEEP_MS;

    const startedAt = Date.now();
    let totalArchived = 0;
    let batchCount = 0;
    let lastArchivedId = 0;

    this.logger.log(
      `[sale-order-items-archive] start retentionDays=${retentionDays} batchSize=${batchSize} maxBatches=${maxBatches}`,
    );

    while (batchCount < maxBatches) {
      const result = await this.archiveBatch(
        retentionDays,
        batchSize,
        lastArchivedId,
      );

      if (result.archived === 0) {
        break;
      }

      totalArchived += result.archived;
      lastArchivedId = result.lastId;
      batchCount++;

      const elapsedMs = Date.now() - startedAt;
      this.logger.log(
        `[sale-order-items-archive] batch=${batchCount} archived=${result.archived} lastId=${lastArchivedId} totalArchived=${totalArchived} elapsedMs=${elapsedMs}`,
      );

      // 本批未满说明已无更多数据
      if (result.archived < batchSize) {
        break;
      }

      // 批间 sleep
      await this.sleep(sleepMs);
    }

    const durationMs = Date.now() - startedAt;
    this.logger.log(
      `[sale-order-items-archive] completed totalArchived=${totalArchived} batches=${batchCount} durationMs=${durationMs}`,
    );

    return totalArchived;
  }

  /**
   * 归档单批：查出超过保留窗口且 id > lastArchivedId 的 batchSize 行，
   * 在同一事务内 INSERT 到归档表 + DELETE 源表。
   *
   * 幂等保证：
   * - INSERT...SELECT 选中 id 后，DELETE WHERE id IN (同批 id)
   * - 两步在同一事务内，事务原子性保证不会只 INSERT 不 DELETE 或反之
   * - 若事务失败则全部回滚，下次重跑从同一 lastArchivedId 继续
   * - 归档表无 unique 约束，若极端情况下重复执行同一 id（事务部分提交——不会发生
   *   因为是单事务），也不会报错，但正常流程不会出现
   *
   * @param retentionDays 保留天数
   * @param batchSize 每批行数
   * @param lastArchivedId 上一批最后处理的 id（游标推进）
   * @returns { archived: 本批迁移行数, lastId: 本批最大 id }
   */
  private async archiveBatch(
    retentionDays: number,
    batchSize: number,
    lastArchivedId: number,
  ): Promise<{ archived: number; lastId: number }> {
    return this.prisma.$transaction(async (tx) => {
      // 1. 查出本批待归档行的 id（按 id 升序，跳过已处理的）
      const rows: Array<{ id: number }> = await tx.$queryRaw`
        SELECT id FROM sale_order_items
        WHERE created_at < NOW() - INTERVAL '${retentionDays} days'
          AND id > ${lastArchivedId}
        ORDER BY id ASC
        LIMIT ${batchSize}
      `;

      if (rows.length === 0) {
        return { archived: 0, lastId: lastArchivedId };
      }

      const ids = rows.map((r) => r.id);
      const batchLastId = ids[ids.length - 1];

      // 2. INSERT 到归档表（从源表 SELECT 全部列）
      await tx.$executeRaw`
        INSERT INTO sale_order_items_archive (
          id, order_id, store_id, product_id, product_name,
          category_name, sale_price, profit, quantity, image, created_at
        )
        SELECT
          id, order_id, store_id, product_id, product_name,
          category_name, sale_price, profit, quantity, image, created_at
        FROM sale_order_items
        WHERE id = ANY(${ids}::int[])
      `;

      // 3. DELETE 源表（同一事务，保证原子性）
      await tx.$executeRaw`
        DELETE FROM sale_order_items
        WHERE id = ANY(${ids}::int[])
      `;

      return { archived: rows.length, lastId: batchLastId };
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

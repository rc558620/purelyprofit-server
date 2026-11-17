/* ── 财务模块第三轮性能索引（只增不删，最小风险面）─────────────────────────
 *
 * 诊断数据来源：独立基准库（200,000 行 finance_account_records，其中单店 120,000 行、
 * 单店未结清 66,000 行；80,000 行 finance_reconciliation_records，其中单店 40,000 行），
 * 每个查询 EXPLAIN (ANALYZE, BUFFERS) 跑 3 次取中位，加索引前后均执行 VACUUM ANALYZE。
 *
 * 1) 账款搜索 trigram 索引（counterpart / note）
 *    代码侧条件（finance-account.query.ts 的 searchText 分支）：
 *      counterpart ILIKE '%kw%' OR note ILIKE '%kw%'
 *    20260610120000 曾为 counterpart 建过 trigram，但 20260613074513 重建表时把它 DROP 掉了，
 *    note 则从来没建过 —— 两条分支都无索引，只能顺扫整表再排序：
 *      加索引前：Seq Scan + Sort         73.844 ms / buffers 2,906（高选择度关键词，命中 14 行）
 *                同条件 COUNT            66.834 ms
 *      加索引后：BitmapOr(两个 GIN)        0.255 ms / buffers    31
 *                同条件 COUNT             0.185 ms / buffers    25
 *    低选择度关键词（如单字）不上 trigram 更快：顺扫有序索引凑满 limit 即返回，
 *    加索引前后 2.32 ms → 2.46 ms（计划未变，属噪声），故本迁移不改变既有排序契约。
 *    note 可为 NULL：NULL 不入 GIN，与 Prisma `contains`（NULL 不匹配）语义一致。
 *
 * 2) 未结清账款按创建时间倒序取前 N 条（报表明细行）
 *    代码侧（finance-overview-report.query.ts 的 queryReportAccountRows）：
 *      where storeId + remaining > 0  orderBy created_at DESC, id DESC  limit 200
 *    既有部分索引 (store_id, remaining) WHERE remaining > 0 只能代替过滤，
 *    仍要把单店 66,000 行未结清记录全部取出后排序，才能拿到前 200 条：
 *      加索引前：Index Scan(store_id,remaining) + Sort   35.025 ms / buffers 2,902
 *      加索引后：Index Scan(store_id,created_at DESC,id DESC) 直接取前 200 行
 *                                                       0.228 ms / buffers   203
 *    报表概况 120s 缓存，但每次财务写入都会失效重建，故这 200 行是冷启动主要成本。
 *
 * 3) 对账列表默认排序索引
 *    代码侧（finance-reconciliation.query.ts 的 queryReconciliationRecordPage）：
 *      orderBy [{ date: desc }, { id: desc }] + skip/take
 *    既有 (store_id, status, date) / (store_id, type, date) 都以 status/type 为第二列，
 *    筛选「全部」时无法提供有序输入，只能取出单店全部对账单再 Sort：
 *      加索引前：Sort                     首页 17.035 ms / buffers 1,569
 *                                       深页 OFFSET 5000  23.982 ms
 *      加索引后：Index Scan(store_id,date DESC,id DESC)
 *                                       首页  0.042 ms / buffers    23
 *                                       深页  3.422 ms / buffers 5,047（OFFSET 本身仍线性）
 *    状态/类型筛选路径本来就命中既有索引（0.070 ms），本迁移不影响。
 *
 * 写放大评估：
 *  - (store_id, created_at, id) 部分索引的列插入后不再变化，UPDATE 只改 remaining/paid_amount
 *    时该行仅在「结清那一刻」移出部分索引，日常部分收付不触发。
 *  - GIN trigram 只加在 finance_account_records 的搜索列上；该表读写比远高于 1，
 *    且 GIN 的 fastupdate 会先在 pending list 里合并，不放大常规写入延迟。
 *  - 对账索引新增列 id 仅插入时写入。
 *
 * 时区假设：不涉及时间列类型变更，created_at / date 仍为 TIMESTAMP(3) WITHOUT TIME ZONE，
 *           与应用会话时区 UTC 一致（prisma.service.ts 已钉死 timezone=UTC）。
 *
 * 上线提示（大表零锁阻塞）：
 *   Prisma Migrate 会把本迁移包在事务里，CREATE INDEX CONCURRENTLY 无法在事务内执行。
 *   finance_account_records 若线上已达百万级，请由 DBA 在低峰手工执行下面四条后跳过本迁移：
 *     CREATE INDEX CONCURRENTLY IF NOT EXISTS "finance_account_records_counterpart_trgm_idx"
 *       ON "finance_account_records" USING GIN ("counterpart" gin_trgm_ops);
 *     CREATE INDEX CONCURRENTLY IF NOT EXISTS "finance_account_records_note_trgm_idx"
 *       ON "finance_account_records" USING GIN ("note" gin_trgm_ops);
 *     CREATE INDEX CONCURRENTLY IF NOT EXISTS "finance_account_records_store_id_created_at_id_idx"
 *       ON "finance_account_records"("store_id", "created_at" DESC, "id" DESC) WHERE ("remaining" > 0);
 *     CREATE INDEX CONCURRENTLY IF NOT EXISTS "finance_reconciliation_records_store_id_date_id_idx"
 *       ON "finance_reconciliation_records"("store_id", "date" DESC, "id" DESC);
 *   执行后用下面语句校验（indisvalid 必须为 true，否则是中断后留下的 INVALID 索引）：
 *     SELECT indexrelid::regclass, indisvalid FROM pg_index
 *      WHERE indexrelid::regclass::text LIKE 'finance_%'
 *        AND (indexrelid::regclass::text LIKE '%trgm%'
 *             OR indexrelid::regclass::text LIKE '%created_at_id_idx'
 *             OR indexrelid::regclass::text LIKE '%store_id_date_id_idx');
 *
 * 回滚见 prisma/rollback/20261117120000_add_finance_perf_indexes_round3.rollback.sql
 */

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 账款搜索：counterpart / note 补 trigram（与 finance-reconciliation 同款，见上一批迁移）
CREATE INDEX IF NOT EXISTS "finance_account_records_counterpart_trgm_idx"
  ON "finance_account_records" USING GIN ("counterpart" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "finance_account_records_note_trgm_idx"
  ON "finance_account_records" USING GIN ("note" gin_trgm_ops);

-- CreateIndex：与 schema 中 @@index([storeId, createdAt(sort: Desc), id(sort: Desc)], where: raw("(remaining > 0)")) 对齐
CREATE INDEX IF NOT EXISTS "finance_account_records_store_id_created_at_id_idx"
  ON "finance_account_records"("store_id", "created_at" DESC, "id" DESC)
  WHERE ("remaining" > 0);

-- CreateIndex：与 schema 中 @@index([storeId, date(sort: Desc), id(sort: Desc)]) 对齐
CREATE INDEX IF NOT EXISTS "finance_reconciliation_records_store_id_date_id_idx"
  ON "finance_reconciliation_records"("store_id", "date" DESC, "id" DESC);

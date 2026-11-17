/* ── 财务模块第二轮性能索引（只增不删，最小风险面）─────────────────────────
 *
 * 诊断数据来源：独立基准库（200,000 行 finance_account_records，其中单店 120,000 行；
 * 80,000 行 finance_reconciliation_records，其中单店 40,000 行），
 * 每个查询 EXPLAIN (ANALYZE, BUFFERS) 跑 3 次取中位，加索引前后均执行 VACUUM ANALYZE。
 *
 * 1) 账款列表全序索引
 *    代码侧排序链（finance-account.query.ts）：
 *      orderBy [{ dueDate: asc }, { updatedAt: desc }, { id: desc }]
 *    既有 (store_id, due_date) 只能保证第一列有序，PostgreSQL 仍需 Incremental Sort：
 *      加索引前：Incremental Sort + Index Scan(store_id,due_date)  0.406 ms / buffers 161
 *               深页 OFFSET 5000：Incremental Sort rows=5020      8.594 ms / buffers 6031
 *      加索引后：Index Scan(store_id,due_date,updated_at DESC,id DESC) 0.056 ms / buffers 23
 *               深页：同索引直接有序扫描                           3.210 ms
 *    贷款期日可为 NULL，PostgreSQL 对 ASC 默认 NULLS LAST，与前端「无到期日排最后」
 *    的既有展示一致，本索引不改变排序语义。
 *
 * 2) 对账搜索 trigram 索引（counterpart / note）
 *    finance-reconciliation.query.ts 的搜索命中 title / counterpart / note 三列，
 *    但此前只有 title 有 trigram（20260610120000_add_search_trgm_indexes）。
 *    三列 OR 缺一条分支的索引，PostgreSQL 只能退化为 BitmapOr(部分) + 过滤或全表扫：
 *      加索引前：Seq Scan rows removed=79,987   121.892 ms
 *      加索引后：BitmapOr(title/counterpart/note 三个 GIN)  1.676 ms（高选择度关键词）
 *                低选择度关键词 8.253 ms（仍走 BitmapOr + Recheck）
 *    note 可为 NULL：NULL 不入 GIN 索引，与 Prisma `contains`（NULL 不匹配）语义一致。
 *    pg_trgm 的 GIN 构建较重，建议单独低峰窗口执行。
 *
 * 写放大评估：
 *  - btree 新增列 created_at/id 均为插入后不变，UPDATE 时只有 updated_at 变化会触发
 *    该索引的原地更新；账款写入频率远低于读（列表 / 报表均为高频读）。
 *  - GIN 仅作用于 finance_reconciliation_records（写频率最低的财务表之一）。
 *
 * 时区假设：不涉及时间列类型变更，due_date / updated_at 仍为 TIMESTAMP(3) WITHOUT
 *           TIME ZONE，与应用会话时区 UTC 一致。
 *
 * 上线提示（大表零锁阻塞）：
 *   Prisma Migrate 会把本迁移包在事务里，CREATE INDEX CONCURRENTLY 无法在事务内执行。
 *   finance_account_records 若线上已达百万级，请由 DBA 在低峰手工执行下面三条后跳过本迁移：
 *     CREATE INDEX CONCURRENTLY IF NOT EXISTS "finance_account_records_store_id_due_date_updated_at_id_idx"
 *       ON "finance_account_records"("store_id", "due_date", "updated_at" DESC, "id" DESC);
 *     CREATE INDEX CONCURRENTLY IF NOT EXISTS "finance_reconciliation_records_counterpart_trgm_idx"
 *       ON "finance_reconciliation_records" USING GIN ("counterpart" gin_trgm_ops);
 *     CREATE INDEX CONCURRENTLY IF NOT EXISTS "finance_reconciliation_records_note_trgm_idx"
 *       ON "finance_reconciliation_records" USING GIN ("note" gin_trgm_ops);
 *   执行后用下面语句校验（indisvalid 必须为 true，否则是中断后留下的 INVALID 索引）：
 *     SELECT indexrelid::regclass, indisvalid FROM pg_index
 *      WHERE indexrelid::regclass::text LIKE 'finance_%'
 *        AND indexrelid::regclass::text LIKE '%trgm%';
 *
 * 回滚见 prisma/rollback/20261117100000_add_finance_perf_indexes.rollback.sql
 *
 * 本次刻意**不删除**既有 (store_id, due_date)：它仍是列表 COUNT（Index Only Scan，
 * 23 ms）与「即将到期」提醒的成本最低路径；删除它需要等列表迁移 keyset 分页之后，
 * 属于另一批改动，不在本迁移中处理。
 */

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateIndex：与 schema 中 @@index([storeId, dueDate, updatedAt(sort: Desc), id(sort: Desc)]) 对齐
CREATE INDEX IF NOT EXISTS "finance_account_records_store_id_due_date_updated_at_id_idx"
  ON "finance_account_records"("store_id", "due_date", "updated_at" DESC, "id" DESC);

-- 对账搜索：counterpart / note 补 trigram，与既有 title trigram 组成完整 BitmapOr
CREATE INDEX IF NOT EXISTS "finance_reconciliation_records_counterpart_trgm_idx"
  ON "finance_reconciliation_records" USING GIN ("counterpart" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "finance_reconciliation_records_note_trgm_idx"
  ON "finance_reconciliation_records" USING GIN ("note" gin_trgm_ops);

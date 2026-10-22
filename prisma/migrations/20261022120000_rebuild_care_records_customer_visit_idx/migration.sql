/* ── 会员护理档案（care_records）────────────────────────────────
 *
 * 重建顾客时间线主索引：idx_care_records_customer_visit。
 *
 * 背景：首个迁移 20261022100000_add_care_records 建的是
 *   (store_id, customer_id, visit_at)，前导列为 store_id。
 *   真实库实证（1200 行、4 个顾客）发现：PG 对
 *   `WHERE store_id = ? AND customer_id = ? ORDER BY visit_at ASC, id ASC`
 *   会改选 uq_care_records_customer_seq（同为 customer_id 前导），
 *   再退化成 Incremental Sort —— 前导 store_id 的索引竞争不过它。
 *
 * 顾客时间线是核心查询（B 端详情 + C 端列表都是它），
 * 前导 customer_id 才能让索引序直接等于 ORDER BY，免排序；
 * store_id 降级为返回后的越权兜底过滤（建档时与顾客同源，恒等）。
 *
 * 门店维度列表另有 idx_care_records_store_visit 承担，不受影响。
 *
 * 回滚：DROP INDEX IF EXISTS "idx_care_records_customer_visit";
 *       CREATE INDEX "idx_care_records_store_customer_visit"
 *         ON "care_records"("store_id", "customer_id", "visit_at");
 * ────────────────────────────────────────────────────────────────*/

DROP INDEX IF EXISTS "idx_care_records_store_customer_visit";

CREATE INDEX "idx_care_records_customer_visit"
  ON "care_records"("customer_id", "visit_at" ASC, "id" ASC);

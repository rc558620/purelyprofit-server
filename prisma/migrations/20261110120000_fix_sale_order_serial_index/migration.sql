/* 修正销售订单「当日最大序号」查询的错配索引。
 *
 * 调用链：sales-record-create-flow.service.ts → generateOrderNo
 *   → sales-record.query.ts:queryMaxSerial（$queryRaw）
 *   WHERE store_id = ? AND manual_entry = ? AND date >= ? AND date <= ?
 *   SELECT MAX((regexp_match(order_no, '-([0-9]+)$'))[1]::integer)
 *
 * 原索引 sale_orders_store_id_manual_entry_created_at_idx 第三列为 created_at，
 * 而查询的日期条件落在业务日期 date 上（补录历史订单时两者不同），该索引对
 * date 范围无用：planner 通常改走 sale_orders_store_id_date_id_idx 扫描当日
 * 全部订单，再逐行回表过滤 manual_entry，最后回表取 order_no 做正则求 MAX。
 *
 * 这里把第三列换成 date，让三个过滤列全部进入索引范围扫描：扫描行数从
 * 「当日全部订单」收敛到「当日该号段订单」，并省掉 manual_entry 的回表判断。
 * 该查询在 pg_advisory_xact_lock（同店同营业日建单串行）持锁期内执行，
 * 减少的回表会直接缩短并发建单的锁等待。
 * 注：以上为基于索引列与执行计划的推演，仓库内无 EXPLAIN / 慢查询实测数据，
 * 上线前后建议用 EXPLAIN (ANALYZE, BUFFERS) 对比确认。
 *
 * 依据：全仓仅 queryMaxSerial 一处以 manual_entry 作为过滤条件，也没有任何
 * 查询按 (store_id, manual_entry, created_at) 过滤或排序 created_at；
 * store_id + created_at 的路径由既有 sale_orders_store_id_created_at_idx 覆盖。
 * 本迁移是「替换」而非「新增」，不增加索引数量与写入放大。
 *
 * 时区：仅调整索引列，不改变任何时间列类型与查询口径。
 * 大表上线时如需避免 CREATE INDEX 持 SHARE 锁，可在事务外以 CONCURRENTLY
 * 手工创建同名索引后再部署本迁移（IF NOT EXISTS 保证幂等）。
 * 回滚：见 migration_rollback.sql
 */

DROP INDEX IF EXISTS "sale_orders_store_id_manual_entry_created_at_idx";

CREATE INDEX IF NOT EXISTS "sale_orders_store_id_manual_entry_date_idx"
  ON "sale_orders" ("store_id", "manual_entry", "date");

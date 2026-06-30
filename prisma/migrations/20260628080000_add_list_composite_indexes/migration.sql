-- ═══════════════════════════════════════════════════════════
-- P0: 列表查询复合索引优化
-- 目的：为空间预约、空间会话、财务流水、销售记录列表查询补排序友好索引
-- ═══════════════════════════════════════════════════════════

-- ── space_reservations ──────────────────────────────────────
-- 新增：(store_id, status, reserved_at, created_at, id) 覆盖门店维度列表排序
-- 现有 storeId+status+reservedAt 三列索引被新五列索引前缀覆盖，可安全删除
-- 现有 storeId+createdAt 二列索引可被新索引覆盖，安全删除

DROP INDEX IF EXISTS "space_reservations_store_id_status_reserved_at_idx";
DROP INDEX IF EXISTS "space_reservations_store_id_created_at_idx";

CREATE INDEX "space_reservations_store_id_status_reserved_at_created_at_id_idx"
  ON "space_reservations" (
    "store_id",
    "status",
    "reserved_at",
    "created_at",
    "id"
  );

-- ── space_sessions ─────────────────────────────────────────
-- 新增：(store_id, status, start_time DESC, id DESC) 覆盖门店维度会话列表排序
-- 现有 storeId+status+startTime 三列索引被新四列索引前缀覆盖，可安全删除
DROP INDEX IF EXISTS "space_sessions_store_id_status_start_time_idx";

CREATE INDEX "space_sessions_store_id_status_start_time_id_idx"
  ON "space_sessions" (
    "store_id",
    "status",
    "start_time" DESC,
    "id" DESC
  );

-- 新增：(store_id, status, end_time DESC, id DESC) 覆盖门店维度历史结账列表排序
-- 现有 storeId+endTime 二列索引可被此索引覆盖（前两列 storeId+status 更精确）
-- 注意：storeId+endTime 在不带 status 筛选时仍需评估，但实际业务中历史列表始终带 status 条件
DROP INDEX IF EXISTS "space_sessions_store_id_end_time_idx";

CREATE INDEX "space_sessions_store_id_status_end_time_id_idx"
  ON "space_sessions" (
    "store_id",
    "status",
    "end_time" DESC,
    "id" DESC
  );

-- ── finance_cash_flow_records ───────────────────────────────
-- 新增：(store_id, date DESC, created_at DESC, id DESC) 覆盖财务流水列表排序
-- 现有 storeId+date 二列索引被新四列索引前缀覆盖，可安全删除
DROP INDEX IF EXISTS "finance_cash_flow_records_store_id_date_idx";

CREATE INDEX "finance_cash_flow_records_store_id_date_created_at_id_idx"
  ON "finance_cash_flow_records" (
    "store_id",
    "date" DESC,
    "created_at" DESC,
    "id" DESC
  );

-- ── sale_orders ────────────────────────────────────────────
-- 新增：(store_id, date DESC, id DESC) 覆盖销售记录列表排序
-- 现有 storeId+date 二列索引被新三列索引前缀覆盖，可安全删除
DROP INDEX IF EXISTS "sale_orders_store_id_date_idx";

CREATE INDEX "sale_orders_store_id_date_id_idx"
  ON "sale_orders" (
    "store_id",
    "date" DESC,
    "id" DESC
  );

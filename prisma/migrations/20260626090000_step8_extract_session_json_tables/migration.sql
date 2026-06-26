-- Step 8.1: 拆 SpaceSession.items / renewRecords JSON → 独立表
-- 目的：交易明细能被 SQL 查询、聚合、审计

-- ============================================================
-- 1. 创建 space_session_items 表
-- ============================================================
CREATE TABLE "space_session_items" (
    "id"             SERIAL PRIMARY KEY,
    "session_id"     INTEGER NOT NULL REFERENCES "space_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "product_id"     TEXT    NOT NULL,
    "product_name"   TEXT    NOT NULL,
    "category_name"  TEXT    NOT NULL,
    "sale_price"     INTEGER NOT NULL,  -- 销售单价（分）
    "profit"         INTEGER NOT NULL,  -- 单件利润（分）
    "quantity"       INTEGER NOT NULL,
    "sort_order"     INTEGER NOT NULL DEFAULT 0,
    "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "space_session_items_session_id_sort_order_idx" ON "space_session_items"("session_id", "sort_order");
CREATE INDEX "space_session_items_product_id_idx" ON "space_session_items"("product_id");

-- ============================================================
-- 2. 创建 space_session_renew_records 表
-- ============================================================
CREATE TABLE "space_session_renew_records" (
    "id"               SERIAL PRIMARY KEY,
    "session_id"       INTEGER NOT NULL REFERENCES "space_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "record_id"        TEXT    NOT NULL UNIQUE,  -- 业务 ID (rn_{uuid})
    "amount"           INTEGER NOT NULL,          -- 续费金额（分）
    "added_minutes"    INTEGER NOT NULL,
    "payment_method"   "SalesPaymentMethod" NOT NULL,
    "groupon_code"     TEXT,
    "groupon_platform" TEXT,
    "note"             TEXT,
    "renewed_at"       INTEGER NOT NULL,          -- 毫秒时间戳
    "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "space_session_renew_records_session_id_idx" ON "space_session_renew_records"("session_id");
CREATE INDEX "space_session_renew_records_payment_method_idx" ON "space_session_renew_records"("payment_method");

-- ============================================================
-- 3. 回填：从 SpaceSession.items JSON → space_session_items 行
-- ============================================================
-- 使用 PL/pgSQL 逐行解析 JSON 数组并插入
DO $$
DECLARE
    session_rec RECORD;
    item_json   JSONB;
    item_row    RECORD;
    sort_idx    INTEGER;
BEGIN
    FOR session_rec IN SELECT id, items FROM space_sessions LOOP
        sort_idx := 0;
        FOR item_json IN SELECT * FROM jsonb_array_elements(session_rec.items::jsonb) LOOP
            INSERT INTO "space_session_items" (
                "session_id", "product_id", "product_name", "category_name",
                "sale_price", "profit", "quantity", "sort_order"
            ) VALUES (
                session_rec.id,
                COALESCE(item_json->>'productId', ''),
                COALESCE(item_json->>'productName', ''),
                COALESCE(item_json->>'categoryName', ''),
                COALESCE((item_json->>'salePrice')::INTEGER, 0),
                COALESCE((item_json->>'profit')::INTEGER, 0),
                COALESCE((item_json->>'quantity')::INTEGER, 0),
                sort_idx
            );
            sort_idx := sort_idx + 1;
        END LOOP;
    END LOOP;
END $$;

-- ============================================================
-- 4. 回填：从 SpaceSession.renewRecords JSON → space_session_renew_records 行
-- ============================================================
DO $$
DECLARE
    session_rec RECORD;
    renew_json  JSONB;
    renew_row   RECORD;
BEGIN
    FOR session_rec IN SELECT id, "renew_records" FROM space_sessions LOOP
        FOR renew_json IN SELECT * FROM jsonb_array_elements(session_rec.renew_records::jsonb) LOOP
            INSERT INTO "space_session_renew_records" (
                "session_id", "record_id", "amount", "added_minutes",
                "payment_method", "groupon_code", "groupon_platform",
                "note", "renewed_at"
            ) VALUES (
                session_rec.id,
                COALESCE(renew_json->>'id', 'rn_backfill_' || session_rec.id || '_' || renew_json->>'id'),
                COALESCE((renew_json->>'amount')::INTEGER, 0),
                COALESCE((renew_json->>'addedMinutes')::INTEGER, 0),
                COALESCE(renew_json->>'paymentMethod', 'cash')::"SalesPaymentMethod",
                renew_json->>'grouponCode',
                renew_json->>'grouponPlatform',
                renew_json->>'note',
                COALESCE((renew_json->>'renewedAt')::INTEGER, 0)
            );
        END LOOP;
    END LOOP;
END $$;

-- ============================================================
-- 5. 删除旧的 JSON 列
-- ============================================================
ALTER TABLE "space_sessions" DROP COLUMN "items";
ALTER TABLE "space_sessions" DROP COLUMN "renew_records";

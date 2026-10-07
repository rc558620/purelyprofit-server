/* ── I9 归档任务：创建 sale_order_items_archive 归档表 ──────────────
 * 来源：I3 路线 B（归档冷热分离）决策派生。
 *
 * 归档表结构与 sale_order_items 完全一致，但：
 * - 不含任何 FK 约束（归档表不引用 sale_orders/products/stores）
 * - 不含 @@unique 约束
 * - 仅 1 条索引 [store_id, created_at]（归档表查询场景极有限）
 *
 * Prisma model：不声明。归档表通过 raw SQL 读写，避免污染 Prisma Client
 * 与 migrate diff drift。
 *
 * 时区假设：created_at 列为 UTC（DB 会话时区钉死 UTC，见 prisma.service.ts:100-109），
 * 保留窗口以 UTC 时间计算，6 个月 = INTERVAL '6 months'。
 *
 * 回滚：见 migration_rollback.sql
 */

-- 创建归档表（结构与 sale_order_items 一致，无 FK 无 unique）
CREATE TABLE IF NOT EXISTS "sale_order_items_archive" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "store_id" INTEGER NOT NULL,
    "product_id" INTEGER,
    "product_name" TEXT NOT NULL,
    "category_name" TEXT NOT NULL,
    "sale_price" INTEGER NOT NULL,
    "profit" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "image" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("id")
);

-- 归档表仅 1 条索引：按门店 + 时间范围检索
CREATE INDEX IF NOT EXISTS "sale_order_items_archive_store_id_created_at_idx"
    ON "sale_order_items_archive" ("store_id", "created_at");

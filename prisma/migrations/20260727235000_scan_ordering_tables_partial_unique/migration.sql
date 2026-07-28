-- 将 scan_ordering_tables 的全局唯一索引转换为仅对未软删除记录生效的部分唯一索引
-- 1. DROP CONSTRAINT 需要先获取约束名称（通过 \d+ scan_ordering_tables）
ALTER TABLE "scan_ordering_tables" DROP CONSTRAINT IF EXISTS "scan_ordering_tables_store_id_table_code_key";

CREATE UNIQUE INDEX "uq_scan_ordering_table_store_code_active" 
ON "scan_ordering_tables"("store_id", "table_code") 
WHERE ("deleted_at" IS NULL);

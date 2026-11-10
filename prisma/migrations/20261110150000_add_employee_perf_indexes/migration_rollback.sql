-- employee 模块性能优化（第二批）回滚脚本（手工执行，Prisma 不会自动调用）
-- 仅在确认这些索引未被其他查询依赖、且需要回退本批优化时执行。

DROP INDEX IF EXISTS "employees_store_id_status_created_at_id_idx";
DROP INDEX IF EXISTS "employees_store_id_status_resign_date_created_at_id_idx";
DROP INDEX IF EXISTS "employee_payrolls_store_id_created_at_id_idx";
DROP INDEX IF EXISTS "employee_shifts_store_id_date_id_idx";

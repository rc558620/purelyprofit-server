-- employee 模块性能优化（第二批）：补齐列表排序复合索引
--
-- 场景（purely-profit 商家端员工管理读路径）：
--   1. 员工列表 employees-list.domain.ts:buildEmployeeListOrderBy
--      「全部」视图 ORDER BY status ASC, created_at DESC, id DESC；
--      「在职」视图 ORDER BY created_at DESC, id DESC。
--      历史迁移 20261007100000 已删除 created_at 系排序索引，当前 employees
--      只剩 updated_at 系索引，列表需对门店全量员工做排序。
--   2. 离职视图 ORDER BY resign_date DESC, created_at DESC, id DESC；
--      概览 employees.query.ts 另按 resign_date >= 本月月初统计本月离职人数。
--   3. 工资单列表 employees-payroll.service.ts:listPayrolls
--      ORDER BY created_at DESC, id DESC，现有索引均以 month 为前导排序列。
--   4. 排班列表 employees-shift.service.ts:listShifts
--      ORDER BY date、id，现有 (store_id, date) 缺 id 兜底列。
--
-- 设计取舍（以稳为先）：
--   - 全部为普通 B-tree 复合索引，不带 partial 谓词、不声明 DESC：
--     避免 partial 谓词与 Prisma schema 声明的对齐风险；Postgres 可反向扫描
--     ASC 索引满足同向 DESC 排序，不写方向可保持与 schema 生成 DDL 完全一致。
--   - 索引名通过 schema 的 @@index(map: ...) 显式固定，迁移 SQL 使用同名，
--     保证「迁移链重放结构」与「schema 声明」一致，结构基线不漂移。
--   - 部门 / 职位 / 班次定义字典表单店数据量极小，排序成本可忽略，
--     不新增索引以免带来写入放大；department 的 ILIKE 与 keyword 模糊搜索
--     需要表达式 / GIN 索引，留待有 EXPLAIN 实测数据后再评估。
--   - 仅新增索引，不改动任何表结构、字段与返回结构，前端无需同步。
--
-- 时区假设：本迁移只新增索引，不改写任何时间列类型与查询口径。
-- 上线提示：CREATE INDEX 会持 SHARE 锁短暂阻塞写入，建议在低峰执行；
--           如需在线建索引，可在事务外以 CREATE INDEX CONCURRENTLY 手工创建
--           同名索引后再部署本迁移（IF NOT EXISTS 保证幂等）。
-- 依据：仓库内暂无 EXPLAIN / 慢查询实测数据，收益基于索引列与 ORDER BY 推演，
--       上线前后建议用 EXPLAIN (ANALYZE, BUFFERS) 对比确认。
-- 回滚：见 migration_rollback.sql

CREATE INDEX IF NOT EXISTS "employees_store_id_status_created_at_id_idx"
  ON "employees" ("store_id", "status", "created_at", "id");

CREATE INDEX IF NOT EXISTS "employees_store_id_status_resign_date_created_at_id_idx"
  ON "employees" ("store_id", "status", "resign_date", "created_at", "id");

CREATE INDEX IF NOT EXISTS "employee_payrolls_store_id_created_at_id_idx"
  ON "employee_payrolls" ("store_id", "created_at", "id");

CREATE INDEX IF NOT EXISTS "employee_shifts_store_id_date_id_idx"
  ON "employee_shifts" ("store_id", "date", "id");

-- 打印代理台账补「业务域」：扫码点餐与空间小票各自的订单 ID 会撞号，
-- 只按 sale_order_id 查询会把 A 业务的回执当成 B 业务的打印结果。
ALTER TABLE "print_agent_tasks" ADD COLUMN "domain" VARCHAR(16) NOT NULL DEFAULT 'scan';

-- 存量回填：本次改动前只有空间小票下发时写入 sale_order_id（扫码点餐当时不传该字段），
-- 因此历史行带 sale_order_id 的一律属于 space；不回填的话空间查不到旧回执，
-- 扫码同号订单的兜底查询还会把它当成自己的打印结果。
UPDATE "print_agent_tasks" SET "domain" = 'space' WHERE "sale_order_id" IS NOT NULL;

-- 查询模式：门店 + 业务域 + 业务订单 + 票种，取最近一条（补打去重与状态对账）。
-- 索引名与 schema 里的 map 保持一致：默认名会超过 Postgres 63 字符上限被截断，
-- 导致 Prisma 认为索引缺失、后续迁移重复建索引。
DROP INDEX IF EXISTS "print_agent_tasks_sale_order_id_created_at_idx";
CREATE INDEX "print_agent_tasks_domain_lookup_idx"
    ON "print_agent_tasks"("store_id", "domain", "sale_order_id", "target", "created_at" DESC);

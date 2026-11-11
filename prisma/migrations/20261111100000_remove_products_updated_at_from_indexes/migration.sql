/* ── products 索引移除 updated_at 末列，恢复库存扣减的 HOT 更新 ──────────
 *
 * 背景：products 是写热点表，销售扣减 / 进货 / 回滚每次都会执行
 * `UPDATE products SET stock = ..., updated_at = ...`
 * （inventory-stock.query.ts:143-152 的 Prisma @updatedAt、:190-196 的 raw SQL，
 *  以及 operations / club 侧扫单接单与退款回补的 product.updateMany）。
 * 现有 3 条索引都以 updated_at 结尾，于是每次扣减都要维护 3 条 btree，
 * 且 PG 因「被更新列参与索引」无法走 HOT，持续产生 dead tuple。
 *
 * 已逐条核对：products 上没有任何以 updated_at 为前导列的筛选 / 排序 /
 * 范围查询；两处 `ORDER BY stock ASC, updated_at DESC`
 * （notifications-build.service.ts:69、dashboard-home.query.ts:295）
 * 首列是 stock，本就无法利用这 3 条索引避免排序。去掉末列不改变任何查询
 * 能力，只让 updated_at 脱离索引：stock 与 updated_at 均不在索引中，库存
 * 扣减即可走 HOT，同时索引更短、INSERT 维护成本更低。
 *
 * 语义不变：updated_at 仍由 Prisma / raw SQL 正常刷新，商品 DTO 的
 * updatedAt、自助下单菜单 menuVersion、库存预警通知时间戳与排序均保持原样。
 *
 * 事务与并发：项目未上线、无生产数据，本迁移用普通 CREATE / DROP（可被
 * Prisma migrate 包在事务里）。若后续在有存量数据的环境执行，需改为
 * CREATE INDEX CONCURRENTLY / DROP INDEX CONCURRENTLY 并在事务外分步执行；
 * 顺序保持「先 CREATE 新索引，再 DROP 旧索引」，任何阶段都有索引覆盖。
 *
 * 索引名与 Prisma 依据 schema 推导的默认名一致（见 20261023040000
 * _align_index_names 记录过的 drift 教训），不使用 *_partial_idx 后缀。
 *
 * 时区假设：本迁移不涉及时间列，无时区运算。
 *
 * 回滚：见同目录 migration_rollback.sql
 */

CREATE INDEX IF NOT EXISTS "products_store_id_category_idx"
  ON "products" ("store_id", "category") WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "products_store_id_is_active_idx"
  ON "products" ("store_id", "is_active") WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "products_category_id_idx"
  ON "products" ("category_id");

DROP INDEX IF EXISTS "products_store_id_category_updated_at_idx";
DROP INDEX IF EXISTS "products_store_id_is_active_updated_at_idx";
DROP INDEX IF EXISTS "products_category_id_updated_at_idx";

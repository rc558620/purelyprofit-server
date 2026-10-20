/* ── marketing_customers 缺 club_user_id 单列索引 ─────────────
 * idx_marketing_customers_club_user 由 20260731040000 建立，但被
 * 20261007100000_sync_local_drift_baseline 当作「datamodel 未声明的漂移」DROP 掉
 * （当时 datamodel 里确实没声明，本次已在 customers.prisma 补齐，避免再次漂移）。
 *
 * 缺失后果：按 club_user_id 定位顾客、且**不带 storeId** 的查询退化为全表扫描——
 * 现存的 uq_marketing_customers_store_club_user 前导列是 store_id，服务不了这类谓词。
 * 命中位置都在 C 端登录 / 换绑 / 账号合并热路径上：
 *   - club-account-merge.service.ts  findMany({ where: { clubUserId } })
 *   - club-phone-bind.service.ts     findMany({ where: { phone, clubUserId } })
 *                                    updateMany({ where: { clubUserId } })
 *   - club-phone-rebind.service.ts   同上形态
 * 顾客表随运营时间线性增长，这些路径会同步劣化。
 *
 * 生产环境说明：存量表上加索引建议改为
 *   CREATE INDEX CONCURRENTLY "idx_marketing_customers_club_user"
 *     ON "marketing_customers" ("club_user_id") WHERE "club_user_id" IS NOT NULL;
 * 单独在事务外执行（Prisma migrate 会把迁移包在事务里，CONCURRENTLY 无法在内运行）。
 *
 * 回滚：
 *   DROP INDEX IF EXISTS "idx_marketing_customers_club_user";
 */

CREATE INDEX IF NOT EXISTS "idx_marketing_customers_club_user"
  ON "marketing_customers" ("club_user_id")
  WHERE "club_user_id" IS NOT NULL;

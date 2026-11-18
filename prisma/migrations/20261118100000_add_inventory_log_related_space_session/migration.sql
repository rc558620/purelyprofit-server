/* ── 空间追加点单库存流水回填：从「备注字符串匹配」改为「等值业务键」──────────
 * 背景（space-session-settlement.service 结账事务内）：
 *
 *   UPDATE inventory_adjustment_logs
 *   SET sale_order_id = ?
 *   WHERE store_id = ? AND adjust_type = 'sale' AND sale_order_id IS NULL
 *     AND note = '空间管理追加点单（会话#X）'
 *
 * 该语句有两个问题：
 *   1. 没有任何索引能收敛 `sale_order_id IS NULL` 的全库未回填集合，
 *      现有 (sale_order_id, created_at) 无法只取 NULL 分区，(store_id, created_at DESC)
 *      只能收敛到「本店全部流水」，随后逐行比较 note 字符串 —— 随流水表线性恶化，
 *      而这条语句恰好跑在结账事务里（放大持锁时间）。
 *   2. `note` 是唯一关联键：文案一改就静默漏回填，出现「钱已收、流水没挂单」，
 *      交班库存列无法回溯该笔销售后的库存。
 *
 * 本迁移把关联键结构化：加单时直接落会话 ID，结账按等值定位。
 *
 * 锁与执行说明（生产必读）：
 *   - `ADD COLUMN` 可空、无默认值 → 只改 catalog，毫秒级，不重写表。
 *   - 历史回填 `UPDATE` 是一次性全表条件扫描，行数 = 迁移前未回填的
 *     `sale` 流水量。大表建议低峰执行，或按 id 区间分批（见文末分批示例）。
 *   - `CREATE INDEX` 在 Prisma 迁移里**不能**写 CONCURRENTLY：Prisma 默认把
 *     整个 migration 包在事务里，而 CREATE INDEX CONCURRENTLY 禁止在事务块内执行。
 *     大表请改为手工在事务外单独执行下面第 3 段（已在注释里标注等价 SQL）。
 *
 * 回滚：见同目录 migration_rollback.sql
 */

-- 1. 等值定位键：加单时写会话 ID，结账按本列回填 sale_order_id
ALTER TABLE "inventory_adjustment_logs"
  ADD COLUMN IF NOT EXISTS "related_space_session_id" INTEGER;

-- 2. 历史数据一次性回填：从旧备注解析会话号，让上线前已加单的流水也能被等值命中
UPDATE "inventory_adjustment_logs"
SET "related_space_session_id" =
  substring("note" from '会话#([0-9]+)）')::INTEGER
WHERE "related_space_session_id" IS NULL
  AND "adjust_type" = 'sale'
  AND "sale_order_id" IS NULL
  AND "note" LIKE '空间管理追加点单（会话#%'
  AND substring("note" from '会话#([0-9]+)）') ~ '^[0-9]+$';

-- 3. 结账回填专用 partial index：只覆盖「尚未回填」的流水
--    生产大表等价写法（事务外单独执行，不放进 Prisma migration）：
--      CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_inventory_adjustment_logs_pending_space_session"
--        ON "inventory_adjustment_logs" ("related_space_session_id")
--        WHERE "sale_order_id" IS NULL;
CREATE INDEX IF NOT EXISTS "idx_inventory_adjustment_logs_pending_space_session"
  ON "inventory_adjustment_logs" ("related_space_session_id")
  WHERE "sale_order_id" IS NULL;

/* 分批回填示例（超大表时替代第 2 段，每批单独提交、逐步收敛）：
 *
 *   UPDATE inventory_adjustment_logs
 *   SET related_space_session_id = substring(note from '会话#([0-9]+)）')::INTEGER
 *   WHERE id IN (
 *     SELECT id FROM inventory_adjustment_logs
 *     WHERE related_space_session_id IS NULL
 *       AND adjust_type = 'sale'
 *       AND sale_order_id IS NULL
 *       AND note LIKE '空间管理追加点单（会话#%'
 *     LIMIT 5000
 *   );
 *   -- 重复执行直到 0 rows affected
 */

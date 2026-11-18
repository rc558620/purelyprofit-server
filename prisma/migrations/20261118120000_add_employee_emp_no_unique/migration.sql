-- 员工工号唯一约束：并发新增曾按「最后一条记录 +1」发号，可能生成重复工号。
--
-- 存量排查前置：同门店若已存在重复工号（包含软删除员工），本迁移会带明细失败，
-- 需先人工修正数据后再执行，避免迁移静默改写历史工号。
DO $$
DECLARE
  duplicate_list TEXT;
BEGIN
  SELECT string_agg(
           format('store_id=%s emp_no=%s 重复%s次', duplicated.store_id, duplicated.emp_no, duplicated.dup_count),
           '; '
         )
  INTO duplicate_list
  FROM (
    SELECT "store_id", "emp_no", COUNT(*) AS dup_count
    FROM "employees"
    GROUP BY "store_id", "emp_no"
    HAVING COUNT(*) > 1
  ) AS duplicated;

  IF duplicate_list IS NOT NULL THEN
    RAISE EXCEPTION '员工工号存在重复，无法创建唯一约束：%', duplicate_list;
  END IF;
END
$$;

-- 旧索引是非唯一的部分索引，被唯一索引取代
DROP INDEX IF EXISTS "employees_store_id_emp_no_idx";

CREATE UNIQUE INDEX "employees_store_id_emp_no_key" ON "employees"("store_id", "emp_no");

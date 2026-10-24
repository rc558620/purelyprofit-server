-- 员工服务人员（技师）标记
--
-- 背景：非餐饮业态里「技师」一词硬编码，判定靠 position LIKE '%技师%' 模糊匹配。
-- 门店可自定义称呼（如「美容师」「洗车工」）后，职位名不再可靠，改为员工级布尔标记。
-- 历史数据按职位名回填，保证本次上线前后行为完全等价。

-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "is_technician" BOOLEAN NOT NULL DEFAULT false;

-- Backfill
UPDATE "employees" SET "is_technician" = true WHERE "position" LIKE '%技师%' AND "deleted_at" IS NULL;

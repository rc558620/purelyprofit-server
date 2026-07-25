-- CreateEnum
CREATE TYPE "StoreBusinessMode" AS ENUM ('catering', 'general');

-- AlterTable: 为 stores 表新增 business_mode 字段
-- 默认值为 'general'，历史门店默认为非餐饮业态
ALTER TABLE "stores" ADD COLUMN "business_mode" "StoreBusinessMode" NOT NULL DEFAULT 'general';

-- ─── 历史数据回填策略 ──────────────────────────────────────────
-- storeType 存储在 Redis（stores:profile:{storeId}），不在数据库中。
-- 无法在此迁移中直接根据 storeType 回填 business_mode。
-- 默认值 'general' 即为安全回填：
--   - 非餐饮门店（零售、服务、便利店等）→ general ✓
--   - 餐饮门店需后续通过运营脚本或后台接口修正为 catering
-- 运营修正脚本示例：
--   UPDATE stores SET business_mode = 'catering'
--   WHERE id IN (需修正的门店 ID 列表);
-- ────────────────────────────────────────────────────────────────

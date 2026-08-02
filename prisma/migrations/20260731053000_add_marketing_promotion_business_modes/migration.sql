-- AlterTable: 为营销活动表新增 business_modes 门店业态数组列
-- 该迁移在数据库中已应用，本地文件缺失导致 Prisma 校验失败，此文件为重建（与数据库实际状态一致）。
ALTER TABLE "marketing_promotions"
  ADD COLUMN "business_modes" "StoreBusinessMode"[]
    NOT NULL DEFAULT ARRAY['general'::"StoreBusinessMode", 'catering'::"StoreBusinessMode"];

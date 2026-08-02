-- 保留规格组“不限选”的 null 语义，避免回填时被转换为当前选项数量。
ALTER TABLE "scan_ordering_spec_groups"
  ALTER COLUMN "max_selections" DROP NOT NULL,
  ALTER COLUMN "max_selections" DROP DEFAULT;

-- 同一门店的普通商品只能关联一条未删除的扫码菜单商品。
-- 若存在历史重复关联，停止迁移而不是静默删除任一记录及其规格。
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "scan_ordering_menu_products"
    WHERE "product_id" IS NOT NULL AND "deleted_at" IS NULL
    GROUP BY "store_id", "product_id"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      '存在重复的有效扫码菜单商品关联；请先合并规格并软删除重复记录后重试迁移';
  END IF;
END $$;

CREATE UNIQUE INDEX "uq_scan_ordering_menu_product_store_product_active"
  ON "scan_ordering_menu_products" ("store_id", "product_id")
  WHERE "product_id" IS NOT NULL AND "deleted_at" IS NULL;

-- 菜单和商家端均按排序字段读取规格，复合索引避免高频关联读取后额外排序。
CREATE INDEX "idx_scan_ordering_spec_group_menu_product_active_sort"
  ON "scan_ordering_spec_groups" ("menu_product_id", "is_active", "sort_order", "id");

CREATE INDEX "idx_scan_ordering_spec_option_group_active_sort"
  ON "scan_ordering_spec_options" ("group_id", "is_active", "sort_order", "id");

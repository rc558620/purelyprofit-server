-- 历史扫码菜单商品曾统一归入“默认分类”，按普通商品分类回填菜单分类。
-- 仅处理关联普通商品且仍有效的菜单商品；独立菜单商品保持原分类不变。
WITH missing_categories AS (
  SELECT DISTINCT
    product.store_id,
    BTRIM(product.category) AS name
  FROM "scan_ordering_menu_products" AS menu_product
  INNER JOIN "products" AS product ON product.id = menu_product.product_id
  LEFT JOIN "scan_ordering_menu_categories" AS category
    ON category.store_id = product.store_id
    AND category.name = BTRIM(product.category)
    AND category.deleted_at IS NULL
  WHERE menu_product.deleted_at IS NULL
    AND product.deleted_at IS NULL
    AND BTRIM(product.category) <> ''
    AND category.id IS NULL
), ranked_categories AS (
  SELECT
    missing_categories.store_id,
    missing_categories.name,
    COALESCE(existing.max_sort_order, -1)
      + ROW_NUMBER() OVER (
        PARTITION BY missing_categories.store_id
        ORDER BY missing_categories.name
      ) AS sort_order
  FROM missing_categories
  LEFT JOIN (
    SELECT store_id, MAX(sort_order) AS max_sort_order
    FROM "scan_ordering_menu_categories"
    WHERE deleted_at IS NULL
    GROUP BY store_id
  ) AS existing ON existing.store_id = missing_categories.store_id
)
INSERT INTO "scan_ordering_menu_categories" (
  "store_id", "name", "sort_order", "is_active", "version", "created_at", "updated_at"
)
SELECT
  store_id,
  name,
  sort_order,
  true,
  0,
  NOW(),
  NOW()
FROM ranked_categories
ON CONFLICT ("store_id", "name") WHERE "deleted_at" IS NULL DO NOTHING;

UPDATE "scan_ordering_menu_products" AS menu_product
SET
  "category_id" = category.id,
  "updated_at" = NOW()
FROM "products" AS product
INNER JOIN "scan_ordering_menu_categories" AS category
  ON category.store_id = product.store_id
  AND category.name = BTRIM(product.category)
  AND category.deleted_at IS NULL
WHERE menu_product.product_id = product.id
  AND menu_product.deleted_at IS NULL
  AND product.deleted_at IS NULL
  AND BTRIM(product.category) <> ''
  AND menu_product.category_id IS DISTINCT FROM category.id;

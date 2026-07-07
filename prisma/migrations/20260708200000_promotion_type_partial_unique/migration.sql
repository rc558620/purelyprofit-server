-- B4: 单门店同类型仅允许一个上架活动（PostgreSQL 条件唯一索引）
-- 防止并发请求绕过应用层 ensurePromotionTypeUnique 检查

-- 先清理可能存在的重复数据（同一门店同类型且都 enabled=true 的多条记录）
-- 保留最早创建的一条，其余下架
UPDATE marketing_promotions AS mp
SET enabled = false
WHERE mp.enabled = true
  AND EXISTS (
    SELECT 1
    FROM marketing_promotions AS dup
    WHERE dup.store_id = mp.store_id
      AND dup.type = mp.type
      AND dup.enabled = true
      AND (dup.created_at < mp.created_at
           OR (dup.created_at = mp.created_at AND dup.id < mp.id))
  );

-- 创建条件唯一索引
CREATE UNIQUE INDEX "marketing_promotions_store_type_enabled_uniq"
  ON marketing_promotions (store_id, type)
  WHERE enabled = true;

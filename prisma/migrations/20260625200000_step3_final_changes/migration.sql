-- Step 3: 综合改动 —— 支付状态机、推广人关联、重复字段清理（0.8, 0.9, 0.10）

-- ─────────────────────────────────────────────────────────────────────────────
-- 0.8: StoreMembershipOrder 支付状态机与幂等逻辑优化
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. 修改 status 默认值为 pending（原默认值 'paid' 不符合实际业务流程）
ALTER TABLE "store_membership_orders" 
  ALTER COLUMN "status" SET DEFAULT 'pending';

-- 2. 为 paymentOrderId 添加唯一约束（确保回调幂等）
CREATE UNIQUE INDEX "store_membership_orders_payment_order_id_key" 
  ON "store_membership_orders"("payment_order_id")
  WHERE "payment_order_id" IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 0.9: StoreMembershipPromoRecord 推广人关联
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. 新增 partnerId 外键字段
ALTER TABLE "store_membership_promo_records" 
  ADD COLUMN "partner_id" INT NULL;

-- 2. 添加外键约束
ALTER TABLE "store_membership_promo_records"
  ADD CONSTRAINT "store_membership_promo_records_partner_id_fkey" 
  FOREIGN KEY ("partner_id") 
  REFERENCES "store_partners"("id") 
  ON DELETE SET NULL;

-- 3. 添加索引
CREATE INDEX "store_membership_promo_records_partner_id_registered_at_idx"
  ON "store_membership_promo_records"("partner_id", "registered_at");

-- 4. 回填 partnerId（根据 inviteePhone 匹配 StorePartner）
UPDATE "store_membership_promo_records" AS promo
SET "partner_id" = partner.id
FROM "store_partners" AS partner
WHERE promo."store_id" = partner."store_id"
  AND promo."invitee_phone" = partner."phone"
  AND partner."deleted_at" IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 0.10: 清理 pointsDeducted / beanDeducted 重复字段
-- ─────────────────────────────────────────────────────────────────────────────

-- 保留 pointsUsed 和 beansUsed，删除 pointsDeducted 和 beanDeducted
ALTER TABLE "store_membership_orders" 
  DROP COLUMN IF EXISTS "points_deducted",
  DROP COLUMN IF EXISTS "bean_deducted";

-- ═══════════════════════════════════════════════════════════
-- P2: 清理冗余索引
-- 目的：减少写入成本和 schema 膨胀
-- ═══════════════════════════════════════════════════════════

-- 1. StoreMembershipPromoRecord: [storeId, registeredAt] 被 [storeId, hasCharged, registeredAt] 前缀覆盖
DROP INDEX IF EXISTS "store_membership_promo_records_store_id_registered_at_idx";

-- 2. Member: [customerId] 与 @@unique([customerId]) 完全重复
DROP INDEX IF EXISTS "members_customer_id_idx";

-- 3. MarketingCustomer: [memberId] 与 @@unique([memberId]) 完全重复
DROP INDEX IF EXISTS "marketing_customers_member_id_idx";

-- 4. Staff: [storeId] 被 [storeId, updatedAt] 前缀覆盖
DROP INDEX IF EXISTS "staffs_store_id_idx";

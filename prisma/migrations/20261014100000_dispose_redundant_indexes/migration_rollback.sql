/* 回滚：恢复 9 条冗余索引 + 2 条冲突裁决索引（共 11 条）
 * 执行顺序与正向迁移相反，全部 CONCURRENTLY 无锁表 */

-- 11. StoreMembershipOrder [status, createdAt]
CREATE INDEX CONCURRENTLY IF NOT EXISTS "store_membership_orders_status_created_at_idx"
  ON "store_membership_orders" ("status", "created_at");

-- 10. StorePartner [status, updatedAt]
CREATE INDEX CONCURRENTLY IF NOT EXISTS "store_partners_status_updated_at_idx"
  ON "store_partners" ("status", "updated_at");

-- 9. ScanOrderingTableQrCode [tokenHash] 全量
CREATE INDEX CONCURRENTLY IF NOT EXISTS "scan_ordering_table_qr_codes_token_hash_idx"
  ON "scan_ordering_table_qr_codes" ("token_hash");

-- 8. ScanOrders [paymentExpiresAt] 全量
CREATE INDEX CONCURRENTLY IF NOT EXISTS "scan_orders_payment_expires_at_idx"
  ON "scan_orders" ("payment_expires_at");

-- 7. ScanOrderingPickupSequence [storeId, businessDate]
CREATE INDEX CONCURRENTLY IF NOT EXISTS "scan_ordering_pickup_sequences_store_date_idx"
  ON "scan_ordering_pickup_sequences" ("store_id", "business_date");

-- 6. PrintAgent [storeId]
CREATE INDEX CONCURRENTLY IF NOT EXISTS "print_agents_store_id_idx"
  ON "print_agents" ("store_id");

-- 5. SelfOrder [storeId]
CREATE INDEX CONCURRENTLY IF NOT EXISTS "self_orders_store_id_idx"
  ON "self_orders" ("store_id");

-- 4. ScanOrders [storeId]
CREATE INDEX CONCURRENTLY IF NOT EXISTS "scan_orders_store_id_idx"
  ON "scan_orders" ("store_id");

-- 3. ScanOrderingTable [storeId]
CREATE INDEX CONCURRENTLY IF NOT EXISTS "scan_ordering_tables_store_id_idx"
  ON "scan_ordering_tables" ("store_id");

-- 2. ScanOrderingType [storeId]
CREATE INDEX CONCURRENTLY IF NOT EXISTS "scan_ordering_types_store_id_idx"
  ON "scan_ordering_types" ("store_id");

-- 1. ScanOrderingArea [storeId]
CREATE INDEX CONCURRENTLY IF NOT EXISTS "scan_ordering_areas_store_id_idx"
  ON "scan_ordering_areas" ("store_id");

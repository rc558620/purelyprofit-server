/* ── 冗余索引处置（S3 审计 9 条）──────────────────────────────
 * 删除经代码核实确认无独立使用价值的 9 条冗余索引。
 * 全部使用 CONCURRENTLY 避免锁表。
 *
 * 冲突裁决：StorePartner [status, updatedAt] 和
 * StoreMembershipOrder [status, createdAt] 经核实 Pulse dashboard
 * 跨门店查询依赖但表规模极小（档B <1.5k / <12k 行），且均有
 * [storeId, status, ...] 复合索引覆盖带 storeId 的查询路径，
 * 裸跨门店索引选择度极低、写放大无收益，裁决删除。
 *
 * 时区假设：本批不涉及时间列索引的时区转换。
 * 回滚：见 migration_rollback.sql
 */

-- 1. ScanOrderingArea [storeId] — 被 @@unique([storeId, name]) 覆盖
DROP INDEX CONCURRENTLY IF EXISTS "scan_ordering_areas_store_id_idx";

-- 2. ScanOrderingType [storeId] — 被 @@unique([storeId, name]) 覆盖
DROP INDEX CONCURRENTLY IF EXISTS "scan_ordering_types_store_id_idx";

-- 3. ScanOrderingTable [storeId] — 被 @@index([storeId, status]) 覆盖
DROP INDEX CONCURRENTLY IF EXISTS "scan_ordering_tables_store_id_idx";

-- 4. ScanOrders [storeId] — 被 @@unique([storeId, orderNo]) 等多条覆盖
DROP INDEX CONCURRENTLY IF EXISTS "scan_orders_store_id_idx";

-- 5. SelfOrder [storeId] — 被 @@unique([storeId, orderNo]) 覆盖
DROP INDEX CONCURRENTLY IF EXISTS "self_orders_store_id_idx";

-- 6. PrintAgent [storeId] — 被 @@unique([storeId, deviceId]) 覆盖
DROP INDEX CONCURRENTLY IF EXISTS "print_agents_store_id_idx";

-- 7. ScanOrderingPickupSequence [storeId, businessDate] — 与 @@unique([storeId, businessDate]) 完全重复
DROP INDEX CONCURRENTLY IF EXISTS "scan_ordering_pickup_sequences_store_date_idx";

-- 8. ScanOrders [paymentExpiresAt] 全量 — partial idx_scan_orders_payment_expiry 覆盖唯一查询路径
--    查询点 scan-ordering-payment-expiration.service.ts:57-66 恒带
--    paymentStatus='unpaid' + deletedAt=null，完全匹配 partial 条件
DROP INDEX CONCURRENTLY IF EXISTS "scan_orders_payment_expires_at_idx";

-- 9. ScanOrderingTableQrCode [tokenHash] 全量 — partial idx_qr_token_hash_active 覆盖唯一查询路径
--    查询点 club-scan-ordering.service.ts:64-68 恒带 status='active'，
--    完全匹配 partial 条件
DROP INDEX CONCURRENTLY IF EXISTS "scan_ordering_table_qr_codes_token_hash_idx";

-- 10. StorePartner [status, updatedAt] — 冲突裁决删除
--    跨门店查询（dashboard-home.query.ts:198-215, membership-ledger.service.ts:161,
--    growth-admin.query.ts:123）表规模档B <1500 行，[storeId, status, updatedAt] 覆盖带 storeId 路径
DROP INDEX CONCURRENTLY IF EXISTS "store_partners_status_updated_at_idx";

-- 11. StoreMembershipOrder [status, createdAt] — 冲突裁决删除
--    跨门店查询（dashboard-home.query.ts:224-258, dashboard-revenue-detail.service.ts:93-124）
--    表规模档B <12k 行，[storeId, status, createdAt] 覆盖带 storeId 路径
DROP INDEX CONCURRENTLY IF EXISTS "store_membership_orders_status_created_at_idx";

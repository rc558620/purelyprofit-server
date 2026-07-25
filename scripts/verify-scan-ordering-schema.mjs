#!/usr/bin/env node
// ============================================================================
// scripts/verify-scan-ordering-schema.mjs
//
// 扫码点餐迁移后数据校验脚本
// 用法: node scripts/verify-scan-ordering-schema.mjs
// ============================================================================

import 'dotenv/config';
import { PrismaClient } from '../prisma/purely-profit/src/generated/client/index.js';

const prisma = new PrismaClient();

const PASS = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';

let errors = 0;

async function check(label, fn) {
  try {
    await fn();
    console.log(`  ${PASS} ${label}`);
  } catch (e) {
    console.error(`  ${FAIL} ${label}: ${e.message}`);
    errors++;
  }
}

async function main() {
  console.log('\n🔍 扫码点餐领域数据模型校验\n');

  // ---- 1. 表存在性检查 ----
  console.log('1️⃣  表存在性检查');
  const requiredTables = [
    'scan_ordering_areas',
    'scan_ordering_tables',
    'scan_ordering_sessions',
    'scan_ordering_cart_items',
    'scan_ordering_cart_item_specs',
    'scan_orders',
    'scan_order_items',
    'scan_order_item_specs',
    'scan_order_status_histories',
    'scan_ordering_menu_categories',
    'scan_ordering_menu_products',
    'scan_ordering_spec_groups',
    'scan_ordering_spec_options',
    'scan_ordering_table_qr_codes',
    'scan_order_payment_attempts',
    'scan_order_coupon_usages',
    'scan_order_service_calls',
    'idempotency_records',
  ];

  for (const table of requiredTables) {
    await check(`表 ${table} 存在`, async () => {
      const res = await prisma.$queryRawUnsafe(
        `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
        table,
      );
      if (res.length === 0) throw new Error('表不存在');
    });
  }

  // ---- 2. 新增列检查 ----
  console.log('\n2️⃣  新增列检查');

  const columnChecks = [
    ['scan_ordering_sessions', 'club_user_id'],
    ['scan_ordering_sessions', 'session_token_hash'],
    ['scan_ordering_sessions', 'last_active_at'],
    ['scan_ordering_sessions', 'deleted_at'],
    ['scan_ordering_cart_items', 'spec_signature'],
    ['scan_ordering_cart_items', 'unit_price_amount'],
    ['scan_ordering_cart_items', 'version'],
    ['scan_ordering_cart_items', 'deleted_at'],
    ['scan_orders', 'session_id'],
    ['scan_orders', 'club_user_id'],
    ['scan_orders', 'guest_count'],
    ['scan_orders', 'remark'],
    ['scan_orders', 'idempotency_key'],
    ['scan_orders', 'pricing_version'],
    ['scan_orders', 'coupon_id'],
    ['scan_orders', 'currency'],
    ['scan_orders', 'payable_amount'],
    ['scan_orders', 'payment_expires_at'],
    ['scan_orders', 'deleted_at'],
    ['scan_order_items', 'product_image_url_snapshot'],
    ['scan_order_items', 'category_name_snapshot'],
    ['scan_order_items', 'spec_signature'],
    ['scan_order_items', 'unit_price_amount'],
    ['scan_order_items', 'discount_amount'],
    ['scan_order_items', 'payable_line_amount'],
    ['scan_order_items', 'sort_order'],
    ['scan_ordering_table_qr_codes', 'token_prefix'],
    ['scan_ordering_table_qr_codes', 'expires_at'],
    ['scan_ordering_table_qr_codes', 'created_by_user_id'],
    ['scan_ordering_menu_products', 'description'],
    ['scan_ordering_menu_products', 'image_url'],
    ['scan_ordering_menu_products', 'sales_count'],
    ['scan_ordering_menu_products', 'is_recommended'],
    ['scan_ordering_menu_products', 'available_from'],
    ['scan_ordering_menu_products', 'available_to'],
    ['scan_ordering_spec_groups', 'min_selections'],
    ['scan_ordering_spec_groups', 'max_selections'],
    ['scan_order_status_histories', 'operator_id'],
  ];

  for (const [table, column] of columnChecks) {
    await check(`${table}.${column}`, async () => {
      const res = await prisma.$queryRawUnsafe(
        `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
        table,
        column,
      );
      if (res.length === 0) throw new Error('列不存在');
    });
  }

  // ---- 3. 重复外键字段已移除 ----
  console.log('\n3️⃣  重复外键字段已移除');

  const removedColumns = [
    ['scan_ordering_sessions', 'scan_ordering_table_id'],
    ['scan_ordering_cart_items', 'scan_ordering_session_id'],
    ['scan_ordering_cart_items', 'spec_id'],
    ['scan_ordering_cart_item_specs', 'scan_ordering_cart_item_id'],
    ['scan_order_items', 'scan_orders_id'],
    ['scan_order_item_specs', 'scan_order_item_id'],
    ['scan_order_status_histories', 'scan_orders_id'],
    ['scan_ordering_menu_products', 'scan_ordering_menu_category_id'],
    ['scan_ordering_spec_groups', 'scan_ordering_menu_product_id'],
    ['scan_ordering_spec_options', 'scan_ordering_spec_group_id'],
    ['scan_ordering_table_qr_codes', 'scan_ordering_table_id'],
    ['scan_ordering_tables', 'scan_ordering_area_id'],
  ];

  for (const [table, column] of removedColumns) {
    await check(`${table}.${column} 已移除`, async () => {
      const res = await prisma.$queryRawUnsafe(
        `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
        table,
        column,
      );
      if (res.length > 0) throw new Error('列仍然存在，应已移除');
    });
  }

  // ---- 4. 外键约束检查 ----
  console.log('\n4️⃣  外键约束检查');

  const fkChecks = [
    ['scan_ordering_tables', 'area_id', 'scan_ordering_areas'],
    ['scan_ordering_sessions', 'table_id', 'scan_ordering_tables'],
    ['scan_ordering_cart_items', 'session_id', 'scan_ordering_sessions'],
    ['scan_ordering_cart_item_specs', 'cart_item_id', 'scan_ordering_cart_items'],
    ['scan_orders', 'table_id', 'scan_ordering_tables'],
    ['scan_orders', 'session_id', 'scan_ordering_sessions'],
    ['scan_order_items', 'order_id', 'scan_orders'],
    ['scan_order_item_specs', 'order_item_id', 'scan_order_items'],
    ['scan_order_status_histories', 'order_id', 'scan_orders'],
    ['scan_ordering_menu_products', 'category_id', 'scan_ordering_menu_categories'],
    ['scan_ordering_spec_groups', 'menu_product_id', 'scan_ordering_menu_products'],
    ['scan_ordering_spec_options', 'group_id', 'scan_ordering_spec_groups'],
    ['scan_ordering_table_qr_codes', 'table_id', 'scan_ordering_tables'],
    ['scan_order_payment_attempts', 'order_id', 'scan_orders'],
    ['scan_order_coupon_usages', 'order_id', 'scan_orders'],
    ['scan_order_service_calls', 'table_id', 'scan_ordering_tables'],
    ['scan_order_service_calls', 'session_id', 'scan_ordering_sessions'],
  ];

  for (const [table, column, refTable] of fkChecks) {
    await check(`${table}.${column} → ${refTable}`, async () => {
      const res = await prisma.$queryRawUnsafe(
        `SELECT 1 FROM information_schema.key_column_usage kcu
         JOIN information_schema.table_constraints tc ON kcu.constraint_name = tc.constraint_name
         WHERE tc.constraint_type = 'FOREIGN KEY'
           AND kcu.table_schema = 'public'
           AND kcu.table_name = $1
           AND kcu.column_name = $2`,
        table,
        column,
      );
      if (res.length === 0) throw new Error('外键约束不存在');
    });
  }

  // ---- 5. 关键索引检查 ----
  console.log('\n5️⃣  关键索引检查');

  const indexChecks = [
    'uq_scan_ordering_sessions_user_table_active',
    'uq_scan_ordering_cart_item_active',
    'uq_scan_orders_store_idempotency_key',
    'uq_scan_ordering_active_qr_per_table',
    'uq_menu_category_store_name_active',
    'uq_menu_product_store_name_active',
    'uq_payment_attempt_provider_txn',
    'uq_coupon_usage_active_lock',
    'idx_cart_item_session_active',
    'idx_scan_orders_table_active',
    'idx_scan_orders_store_status_created',
    'idx_scan_orders_payment_expiry',
    'idx_service_calls_store_pending',
    'idx_qr_token_hash_active',
  ];

  for (const indexName of indexChecks) {
    await check(`索引 ${indexName}`, async () => {
      const res = await prisma.$queryRawUnsafe(
        `SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1`,
        indexName,
      );
      if (res.length === 0) throw new Error('索引不存在');
    });
  }

  // ---- 6. CHECK 约束检查 ----
  console.log('\n6️⃣  CHECK 约束检查');

  const checkConstraints = [
    ['scan_ordering_cart_items', 'scan_ordering_cart_items_quantity_check'],
    ['scan_order_items', 'scan_order_items_quantity_check'],
    ['scan_ordering_menu_products', 'scan_ordering_menu_products_stock_quantity_check'],
  ];

  for (const [table, constraintName] of checkConstraints) {
    await check(`CHECK ${table}.${constraintName}`, async () => {
      const res = await prisma.$queryRawUnsafe(
        `SELECT 1 FROM information_schema.table_constraints
         WHERE constraint_type = 'CHECK' AND table_schema = 'public' AND constraint_name = $1`,
        constraintName,
      );
      if (res.length === 0) throw new Error('CHECK 约束不存在');
    });
  }

  // ---- 7. 枚举类型检查 ----
  console.log('\n7️⃣  枚举类型检查');

  const enumChecks = [
    ['ScanOrderingSessionStatus', ['active', 'checked_out', 'expired', 'left']],
    ['CartItemStatus', ['active', 'removed', 'ordered', 'expired']],
    ['ScanOrderPaymentAttemptStatus', ['created', 'paying', 'succeeded', 'failed', 'closed', 'refunded']],
    ['ScanOrderCouponUsageStatus', ['locked', 'consumed', 'released', 'refunded']],
    ['ScanOrderServiceCallStatus', ['pending', 'acknowledged', 'resolved', 'cancelled']],
    ['ScanOrderServiceCallType', ['waiter', 'water', 'checkout', 'other']],
    ['IdempotencyRecordStatus', ['processing', 'succeeded', 'failed']],
  ];

  for (const [enumName, expectedValues] of enumChecks) {
    await check(`枚举 ${enumName}`, async () => {
      const res = await prisma.$queryRawUnsafe(
        `SELECT enumlabel FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = $1 ORDER BY e.enumsortorder`,
        enumName,
      );
      const values = res.map((r) => r.enumlabel);
      for (const v of expectedValues) {
        if (!values.includes(v)) throw new Error(`缺少枚举值: ${v}`);
      }
    });
  }

  // ---- 汇总 ----
  console.log(`\n${'='.repeat(50)}`);
  if (errors === 0) {
    console.log('✅ 所有校验通过');
  } else {
    console.log(`❌ ${errors} 项校验失败`);
    process.exit(1);
  }
}

main().finally(() => prisma.$disconnect());

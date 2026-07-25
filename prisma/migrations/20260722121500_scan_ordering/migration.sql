-- ============================================================================
-- 扫码点餐领域完整建表迁移
-- 包含：表结构、枚举、索引、外键、部分唯一索引（partial unique indexes）
-- ============================================================================

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- ============================================================================
-- 枚举定义
-- ============================================================================

CREATE TYPE "ScanOrderingTableStatus" AS ENUM ('empty', 'dining', 'clearing', 'disabled');
CREATE TYPE "ScanOrderingSessionStatus" AS ENUM ('active', 'checked_out', 'expired', 'left');
CREATE TYPE "CartItemStatus" AS ENUM ('active', 'removed', 'ordered', 'expired');
CREATE TYPE "ScanOrderStatus" AS ENUM ('pending_payment', 'pending_acceptance', 'preparing', 'served', 'completed', 'cancelled', 'rejected', 'refunding');
CREATE TYPE "ScanOrderPaymentStatus" AS ENUM ('unpaid', 'paid', 'refunding', 'refunded');
CREATE TYPE "ScanOrderFulfillmentStatus" AS ENUM ('preparing', 'served', 'closed');
CREATE TYPE "ScanOrderingStockMode" AS ENUM ('unlimited', 'finite', 'sold_out');
CREATE TYPE "ScanOrderingSpecSelectionType" AS ENUM ('single', 'multiple');
CREATE TYPE "ScanOrderingQrCodeStatus" AS ENUM ('active', 'revoked');
CREATE TYPE "ScanOrderPaymentAttemptStatus" AS ENUM ('created', 'paying', 'succeeded', 'failed', 'closed', 'refunded');
CREATE TYPE "ScanOrderCouponUsageStatus" AS ENUM ('locked', 'consumed', 'released', 'refunded');
CREATE TYPE "ScanOrderServiceCallStatus" AS ENUM ('pending', 'acknowledged', 'resolved', 'cancelled');
CREATE TYPE "ScanOrderServiceCallType" AS ENUM ('waiter', 'water', 'checkout', 'other');
CREATE TYPE "IdempotencyRecordStatus" AS ENUM ('processing', 'succeeded', 'failed');

-- ============================================================================
-- 桌台区域
-- ============================================================================

CREATE TABLE "scan_ordering_areas" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "scan_ordering_areas_pkey" PRIMARY KEY ("id")
);

-- ============================================================================
-- 桌台
-- ============================================================================

CREATE TABLE "scan_ordering_tables" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "area_id" INTEGER,
    "table_code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 1,
    "status" "ScanOrderingTableStatus" NOT NULL DEFAULT 'empty',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 0,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "scan_ordering_tables_pkey" PRIMARY KEY ("id")
);

-- ============================================================================
-- 点餐会话
-- ============================================================================

CREATE TABLE "scan_ordering_sessions" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "table_id" INTEGER,
    "club_user_id" INTEGER,
    "session" TEXT NOT NULL,
    "session_token_hash" VARCHAR(128),
    "guest_count" INTEGER NOT NULL DEFAULT 0,
    "status" "ScanOrderingSessionStatus" NOT NULL DEFAULT 'active',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "last_active_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "scan_ordering_sessions_pkey" PRIMARY KEY ("id")
);

-- ============================================================================
-- 购物车
-- ============================================================================

CREATE TABLE "scan_ordering_cart_items" (
    "id" SERIAL NOT NULL,
    "session_id" INTEGER NOT NULL,
    "menu_product_id" INTEGER NOT NULL,
    "spec_signature" CHAR(64) NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unit_price_amount" INTEGER NOT NULL DEFAULT 0,
    "line_total_amount" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "CartItemStatus" NOT NULL DEFAULT 'active',
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "scan_ordering_cart_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "scan_ordering_cart_items_quantity_check" CHECK (quantity > 0)
);

CREATE TABLE "scan_ordering_cart_item_specs" (
    "id" SERIAL NOT NULL,
    "cart_item_id" INTEGER NOT NULL,
    "spec_option_id" INTEGER NOT NULL,
    "extra_price_snapshot" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "scan_ordering_cart_item_specs_pkey" PRIMARY KEY ("id")
);

-- ============================================================================
-- 订单
-- ============================================================================

CREATE TABLE "scan_orders" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "order_no" TEXT NOT NULL,
    "table_id" INTEGER NOT NULL,
    "session_id" INTEGER,
    "club_user_id" INTEGER,
    "guest_count" INTEGER,
    "remark" VARCHAR(500),
    "idempotency_key" VARCHAR(128),
    "pricing_version" VARCHAR(128),
    "coupon_id" INTEGER,
    "currency" CHAR(3) NOT NULL DEFAULT 'CNY',
    "item_original_amount" INTEGER NOT NULL DEFAULT 0,
    "specification_extra_amount" INTEGER NOT NULL DEFAULT 0,
    "product_discount_amount" INTEGER NOT NULL DEFAULT 0,
    "order_discount_amount" INTEGER NOT NULL DEFAULT 0,
    "service_fee_amount" INTEGER NOT NULL DEFAULT 0,
    "tax_amount" INTEGER NOT NULL DEFAULT 0,
    "payable_amount" INTEGER NOT NULL DEFAULT 0,
    "paid_amount" INTEGER NOT NULL DEFAULT 0,
    "status" "ScanOrderStatus" NOT NULL DEFAULT 'pending_payment',
    "payment_status" "ScanOrderPaymentStatus" NOT NULL DEFAULT 'unpaid',
    "fulfillment_status" "ScanOrderFulfillmentStatus" NOT NULL DEFAULT 'preparing',
    "version" INTEGER NOT NULL DEFAULT 0,
    "payment_expires_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "accepted_at" TIMESTAMP(3),
    "served_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "reject_reason" TEXT,
    "cancel_reason" TEXT,
    CONSTRAINT "scan_orders_pkey" PRIMARY KEY ("id")
);

-- ============================================================================
-- 订单项（快照字段）
-- ============================================================================

CREATE TABLE "scan_order_items" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "store_id" INTEGER NOT NULL,
    "menu_product_id" INTEGER NOT NULL,
    "product_name_snapshot" TEXT NOT NULL,
    "product_image_url_snapshot" TEXT,
    "category_name_snapshot" TEXT,
    "spec_signature" CHAR(64),
    "quantity" INTEGER NOT NULL,
    "base_price_snapshot" INTEGER NOT NULL,
    "unit_price_amount" INTEGER NOT NULL DEFAULT 0,
    "discount_amount" INTEGER NOT NULL DEFAULT 0,
    "line_total_amount" INTEGER NOT NULL,
    "payable_line_amount" INTEGER NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "scan_order_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "scan_order_items_quantity_check" CHECK (quantity > 0)
);

CREATE TABLE "scan_order_item_specs" (
    "id" SERIAL NOT NULL,
    "order_item_id" INTEGER NOT NULL,
    "spec_option_id" INTEGER NOT NULL,
    "spec_option_name_snapshot" TEXT NOT NULL,
    "extra_price_snapshot" INTEGER NOT NULL,
    CONSTRAINT "scan_order_item_specs_pkey" PRIMARY KEY ("id")
);

-- ============================================================================
-- 订单状态历史
-- ============================================================================

CREATE TABLE "scan_order_status_histories" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "store_id" INTEGER NOT NULL,
    "from_status" "ScanOrderStatus" NOT NULL,
    "to_status" "ScanOrderStatus" NOT NULL,
    "operator_type" TEXT NOT NULL,
    "operator_id" INTEGER,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "scan_order_status_histories_pkey" PRIMARY KEY ("id")
);

-- ============================================================================
-- 菜单分类
-- ============================================================================

CREATE TABLE "scan_ordering_menu_categories" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "scan_ordering_menu_categories_pkey" PRIMARY KEY ("id")
);

-- ============================================================================
-- 菜单商品
-- ============================================================================

CREATE TABLE "scan_ordering_menu_products" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "category_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" VARCHAR(500),
    "image_url" TEXT,
    "base_price" INTEGER NOT NULL,
    "stock_mode" "ScanOrderingStockMode" NOT NULL DEFAULT 'unlimited',
    "stock_quantity" INTEGER,
    "sales_count" INTEGER NOT NULL DEFAULT 0,
    "is_recommended" BOOLEAN NOT NULL DEFAULT false,
    "available_from" VARCHAR(5),
    "available_to" VARCHAR(5),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "scan_ordering_menu_products_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "scan_ordering_menu_products_stock_quantity_check" CHECK (
        stock_mode = 'unlimited' OR stock_quantity IS NOT NULL
    )
);

-- ============================================================================
-- 规格组
-- ============================================================================

CREATE TABLE "scan_ordering_spec_groups" (
    "id" SERIAL NOT NULL,
    "menu_product_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "selection_type" "ScanOrderingSpecSelectionType" NOT NULL DEFAULT 'single',
    "min_selections" INTEGER NOT NULL DEFAULT 1,
    "max_selections" INTEGER NOT NULL DEFAULT 1,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "scan_ordering_spec_groups_pkey" PRIMARY KEY ("id")
);

-- ============================================================================
-- 规格项
-- ============================================================================

CREATE TABLE "scan_ordering_spec_options" (
    "id" SERIAL NOT NULL,
    "group_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "extra_price" INTEGER NOT NULL,
    "stock_quantity" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "scan_ordering_spec_options_pkey" PRIMARY KEY ("id")
);

-- ============================================================================
-- 桌台二维码
-- ============================================================================

CREATE TABLE "scan_ordering_table_qr_codes" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "table_id" INTEGER NOT NULL,
    "token_hash" VARCHAR(128) NOT NULL,
    "token_prefix" VARCHAR(16),
    "version" INTEGER NOT NULL,
    "status" "ScanOrderingQrCodeStatus" NOT NULL DEFAULT 'active',
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_by_user_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "scan_ordering_table_qr_codes_pkey" PRIMARY KEY ("id")
);

-- ============================================================================
-- 支付尝试
-- ============================================================================

CREATE TABLE "scan_order_payment_attempts" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "store_id" INTEGER NOT NULL,
    "payment_channel" VARCHAR(32) NOT NULL,
    "merchant_payment_no" VARCHAR(64) NOT NULL,
    "provider_transaction_id" VARCHAR(128),
    "amount" INTEGER NOT NULL,
    "status" "ScanOrderPaymentAttemptStatus" NOT NULL DEFAULT 'created',
    "request_payload_hash" VARCHAR(64),
    "callback_payload" JSONB,
    "paid_at" TIMESTAMP(3),
    "expired_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "scan_order_payment_attempts_pkey" PRIMARY KEY ("id")
);

-- ============================================================================
-- 优惠券使用记录
-- ============================================================================

CREATE TABLE "scan_order_coupon_usages" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "coupon_id" INTEGER NOT NULL,
    "club_user_id" INTEGER NOT NULL,
    "store_id" INTEGER NOT NULL,
    "discount_amount" INTEGER NOT NULL,
    "status" "ScanOrderCouponUsageStatus" NOT NULL DEFAULT 'locked',
    "locked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consumed_at" TIMESTAMP(3),
    "released_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "scan_order_coupon_usages_pkey" PRIMARY KEY ("id")
);

-- ============================================================================
-- 服务呼叫
-- ============================================================================

CREATE TABLE "scan_order_service_calls" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "table_id" INTEGER NOT NULL,
    "session_id" INTEGER NOT NULL,
    "club_user_id" INTEGER,
    "call_type" "ScanOrderServiceCallType" NOT NULL DEFAULT 'waiter',
    "remark" VARCHAR(200),
    "status" "ScanOrderServiceCallStatus" NOT NULL DEFAULT 'pending',
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledged_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "scan_order_service_calls_pkey" PRIMARY KEY ("id")
);

-- ============================================================================
-- 幂等记录
-- ============================================================================

CREATE TABLE "idempotency_records" (
    "id" SERIAL NOT NULL,
    "scope" VARCHAR(64) NOT NULL,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "actor_id" INTEGER NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "resource_type" VARCHAR(64),
    "resource_id" INTEGER,
    "response_snapshot" JSONB,
    "status" "IdempotencyRecordStatus" NOT NULL DEFAULT 'processing',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- ============================================================================
-- Prisma 标准索引与唯一约束
-- ============================================================================

-- 区域
CREATE INDEX "scan_ordering_areas_store_id_idx" ON "scan_ordering_areas"("store_id");
CREATE UNIQUE INDEX "scan_ordering_areas_store_id_name_key" ON "scan_ordering_areas"("store_id", "name");

-- 桌台
CREATE INDEX "scan_ordering_tables_store_id_idx" ON "scan_ordering_tables"("store_id");
CREATE INDEX "scan_ordering_tables_store_id_status_idx" ON "scan_ordering_tables"("store_id", "status");
CREATE UNIQUE INDEX "scan_ordering_tables_store_id_table_code_key" ON "scan_ordering_tables"("store_id", "table_code");

-- 会话
CREATE INDEX "scan_ordering_sessions_store_id_session_idx" ON "scan_ordering_sessions"("store_id", "session");
CREATE INDEX "scan_ordering_sessions_store_id_table_id_status_idx" ON "scan_ordering_sessions"("store_id", "table_id", "status");
CREATE INDEX "scan_ordering_sessions_club_user_id_status_last_active_at_idx" ON "scan_ordering_sessions"("club_user_id", "status", "last_active_at" DESC);
CREATE INDEX "scan_ordering_sessions_expires_at_idx" ON "scan_ordering_sessions"("expires_at");

-- 购物车
CREATE INDEX "scan_ordering_cart_items_session_id_status_idx" ON "scan_ordering_cart_items"("session_id", "status");
CREATE INDEX "scan_ordering_cart_items_menu_product_id_idx" ON "scan_ordering_cart_items"("menu_product_id");
CREATE INDEX "scan_ordering_cart_item_specs_cart_item_id_idx" ON "scan_ordering_cart_item_specs"("cart_item_id");
CREATE UNIQUE INDEX "scan_ordering_cart_item_specs_cart_item_id_spec_option_id_key" ON "scan_ordering_cart_item_specs"("cart_item_id", "spec_option_id");

-- 订单
CREATE INDEX "scan_orders_store_id_idx" ON "scan_orders"("store_id");
CREATE INDEX "scan_orders_store_id_status_idx" ON "scan_orders"("store_id", "status");
CREATE INDEX "scan_orders_store_id_table_id_idx" ON "scan_orders"("store_id", "table_id");
CREATE INDEX "scan_orders_store_id_created_at_idx" ON "scan_orders"("store_id", "created_at");
CREATE INDEX "scan_orders_club_user_id_created_at_idx" ON "scan_orders"("club_user_id", "created_at" DESC);
CREATE INDEX "scan_orders_payment_expires_at_idx" ON "scan_orders"("payment_expires_at");
CREATE UNIQUE INDEX "scan_orders_store_id_order_no_key" ON "scan_orders"("store_id", "order_no");

-- 订单项
CREATE INDEX "scan_order_items_order_id_id_idx" ON "scan_order_items"("order_id", "id");
CREATE INDEX "scan_order_items_store_id_menu_product_id_idx" ON "scan_order_items"("store_id", "menu_product_id");
CREATE INDEX "scan_order_item_specs_order_item_id_id_idx" ON "scan_order_item_specs"("order_item_id", "id");

-- 状态历史
CREATE INDEX "scan_order_status_histories_order_id_idx" ON "scan_order_status_histories"("order_id");
CREATE INDEX "scan_order_status_histories_store_id_idx" ON "scan_order_status_histories"("store_id");

-- 菜单分类
CREATE INDEX "scan_ordering_menu_categories_store_id_is_active_sort_order_idx" ON "scan_ordering_menu_categories"("store_id", "is_active", "sort_order");
CREATE UNIQUE INDEX "scan_ordering_menu_categories_store_id_name_key" ON "scan_ordering_menu_categories"("store_id", "name");

-- 菜单商品
CREATE INDEX "scan_ordering_menu_products_store_id_category_id_is_active__idx" ON "scan_ordering_menu_products"("store_id", "category_id", "is_active", "sort_order");
CREATE INDEX "scan_ordering_menu_products_store_id_is_active_idx" ON "scan_ordering_menu_products"("store_id", "is_active");
CREATE UNIQUE INDEX "scan_ordering_menu_products_store_id_name_key" ON "scan_ordering_menu_products"("store_id", "name");

-- 规格
CREATE INDEX "scan_ordering_spec_groups_menu_product_id_is_active_idx" ON "scan_ordering_spec_groups"("menu_product_id", "is_active");
CREATE INDEX "scan_ordering_spec_options_group_id_is_active_idx" ON "scan_ordering_spec_options"("group_id", "is_active");

-- 二维码
CREATE INDEX "scan_ordering_table_qr_codes_table_id_idx" ON "scan_ordering_table_qr_codes"("table_id");
CREATE INDEX "scan_ordering_table_qr_codes_store_id_idx" ON "scan_ordering_table_qr_codes"("store_id");
CREATE INDEX "scan_ordering_table_qr_codes_token_hash_idx" ON "scan_ordering_table_qr_codes"("token_hash");
CREATE UNIQUE INDEX "scan_ordering_table_qr_codes_table_id_status_unique" ON "scan_ordering_table_qr_codes"("table_id", "status");

-- 支付尝试
CREATE INDEX "scan_order_payment_attempts_order_id_created_at_idx" ON "scan_order_payment_attempts"("order_id", "created_at" DESC);
CREATE INDEX "scan_order_payment_attempts_status_expired_at_idx" ON "scan_order_payment_attempts"("status", "expired_at");
CREATE UNIQUE INDEX "scan_order_payment_attempts_merchant_payment_no_key" ON "scan_order_payment_attempts"("merchant_payment_no");

-- 优惠券使用
CREATE INDEX "scan_order_coupon_usages_order_id_idx" ON "scan_order_coupon_usages"("order_id");
CREATE INDEX "scan_order_coupon_usages_club_user_id_status_idx" ON "scan_order_coupon_usages"("club_user_id", "status");
CREATE INDEX "scan_order_coupon_usages_coupon_id_status_idx" ON "scan_order_coupon_usages"("coupon_id", "status");

-- 服务呼叫
CREATE INDEX "scan_order_service_calls_store_id_status_requested_at_idx" ON "scan_order_service_calls"("store_id", "status", "requested_at");
CREATE INDEX "scan_order_service_calls_session_id_call_type_requested_at_idx" ON "scan_order_service_calls"("session_id", "call_type", "requested_at" DESC);

-- 幂等记录
CREATE INDEX "idempotency_records_expires_at_idx" ON "idempotency_records"("expires_at");
CREATE UNIQUE INDEX "idempotency_records_scope_actor_id_idempotency_key_key" ON "idempotency_records"("scope", "actor_id", "idempotency_key");

-- ============================================================================
-- 部分唯一索引 (Partial Unique Indexes)
-- Prisma 不支持 WHERE 条件的唯一索引，需手动编写。
-- 这些索引解决软删除后重名/重复的问题。
-- ============================================================================

-- 会话：同一用户同一桌台只能有一个活跃会话
CREATE UNIQUE INDEX "uq_scan_ordering_sessions_user_table_active"
ON "scan_ordering_sessions"("club_user_id", "table_id")
WHERE "status" = 'active' AND "deleted_at" IS NULL;

-- 购物车：同一会话+商品+规格签名只能有一行活跃记录
CREATE UNIQUE INDEX "uq_scan_ordering_cart_item_active"
ON "scan_ordering_cart_items"("session_id", "menu_product_id", "spec_signature")
WHERE "status" = 'active' AND "deleted_at" IS NULL;

-- 订单：同一门店+幂等键（软删除不参与）
CREATE UNIQUE INDEX "uq_scan_orders_store_idempotency_key"
ON "scan_orders"("store_id", "idempotency_key")
WHERE "deleted_at" IS NULL AND "idempotency_key" IS NOT NULL;

-- 桌台二维码：每张桌只能有一个 active 的二维码
-- （替代原 table_id+status 唯一约束，允许多条 revoked 历史）
DROP INDEX IF EXISTS "scan_ordering_table_qr_codes_table_id_status_unique";
CREATE UNIQUE INDEX "uq_scan_ordering_active_qr_per_table"
ON "scan_ordering_table_qr_codes"("table_id")
WHERE "status" = 'active';

-- 菜单分类：软删除后允许重建同名
DROP INDEX IF EXISTS "scan_ordering_menu_categories_store_id_name_key";
CREATE UNIQUE INDEX "uq_menu_category_store_name_active"
ON "scan_ordering_menu_categories"("store_id", "name")
WHERE "deleted_at" IS NULL;

-- 菜单商品：软删除后允许重建同名
DROP INDEX IF EXISTS "scan_ordering_menu_products_store_id_name_key";
CREATE UNIQUE INDEX "uq_menu_product_store_name_active"
ON "scan_ordering_menu_products"("store_id", "name")
WHERE "deleted_at" IS NULL;

-- 支付尝试：provider_transaction_id 非空时唯一
CREATE UNIQUE INDEX "uq_payment_attempt_provider_txn"
ON "scan_order_payment_attempts"("provider_transaction_id")
WHERE "provider_transaction_id" IS NOT NULL;

-- 优惠券使用：同一券只能有一个锁定或核销状态的记录
CREATE UNIQUE INDEX "uq_coupon_usage_active_lock"
ON "scan_order_coupon_usages"("coupon_id")
WHERE "status" IN ('locked', 'consumed');

-- 购物车活跃行部分索引（加速 WHERE status = 'active' 查询）
CREATE INDEX "idx_cart_item_session_active"
ON "scan_ordering_cart_items"("session_id", "updated_at" DESC)
WHERE "status" = 'active' AND "deleted_at" IS NULL;

-- 桌台订单活跃状态部分索引
CREATE INDEX "idx_scan_orders_table_active"
ON "scan_orders"("store_id", "table_id", "status", "created_at" DESC)
WHERE "status" IN ('pending_payment', 'pending_acceptance', 'preparing', 'served')
  AND "deleted_at" IS NULL;

-- 门店订单状态+时间复合部分索引
CREATE INDEX "idx_scan_orders_store_status_created"
ON "scan_orders"("store_id", "status", "created_at" DESC)
WHERE "deleted_at" IS NULL;

-- 支付超时扫描部分索引
CREATE INDEX "idx_scan_orders_payment_expiry"
ON "scan_orders"("payment_expires_at")
WHERE "payment_status" = 'unpaid' AND "deleted_at" IS NULL;

-- 服务呼叫待办部分索引
CREATE INDEX "idx_service_calls_store_pending"
ON "scan_order_service_calls"("store_id", "status", "requested_at" ASC)
WHERE "status" IN ('pending', 'acknowledged');

-- 二维码 token_hash 活跃查找部分索引
CREATE INDEX "idx_qr_token_hash_active"
ON "scan_ordering_table_qr_codes"("token_hash")
WHERE "status" = 'active';

-- ============================================================================
-- 外键约束
-- ============================================================================

ALTER TABLE "scan_ordering_tables" ADD CONSTRAINT "scan_ordering_tables_area_id_fkey" FOREIGN KEY ("area_id") REFERENCES "scan_ordering_areas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "scan_ordering_sessions" ADD CONSTRAINT "scan_ordering_sessions_table_id_fkey" FOREIGN KEY ("table_id") REFERENCES "scan_ordering_tables"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "scan_ordering_cart_items" ADD CONSTRAINT "scan_ordering_cart_items_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "scan_ordering_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "scan_ordering_cart_item_specs" ADD CONSTRAINT "scan_ordering_cart_item_specs_cart_item_id_fkey" FOREIGN KEY ("cart_item_id") REFERENCES "scan_ordering_cart_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "scan_orders" ADD CONSTRAINT "scan_orders_table_id_fkey" FOREIGN KEY ("table_id") REFERENCES "scan_ordering_tables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "scan_orders" ADD CONSTRAINT "scan_orders_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "scan_ordering_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "scan_order_items" ADD CONSTRAINT "scan_order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "scan_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "scan_order_item_specs" ADD CONSTRAINT "scan_order_item_specs_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "scan_order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "scan_order_status_histories" ADD CONSTRAINT "scan_order_status_histories_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "scan_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "scan_ordering_menu_products" ADD CONSTRAINT "scan_ordering_menu_products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "scan_ordering_menu_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "scan_ordering_spec_groups" ADD CONSTRAINT "scan_ordering_spec_groups_menu_product_id_fkey" FOREIGN KEY ("menu_product_id") REFERENCES "scan_ordering_menu_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "scan_ordering_spec_options" ADD CONSTRAINT "scan_ordering_spec_options_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "scan_ordering_spec_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "scan_ordering_table_qr_codes" ADD CONSTRAINT "scan_ordering_table_qr_codes_table_id_fkey" FOREIGN KEY ("table_id") REFERENCES "scan_ordering_tables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "scan_order_payment_attempts" ADD CONSTRAINT "scan_order_payment_attempts_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "scan_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "scan_order_coupon_usages" ADD CONSTRAINT "scan_order_coupon_usages_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "scan_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "scan_order_service_calls" ADD CONSTRAINT "scan_order_service_calls_table_id_fkey" FOREIGN KEY ("table_id") REFERENCES "scan_ordering_tables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "scan_order_service_calls" ADD CONSTRAINT "scan_order_service_calls_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "scan_ordering_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

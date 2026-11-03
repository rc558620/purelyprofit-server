-- 会员卡后端闭环（be-01）：卡模板 / 持卡实例 / 核销流水 / 售卡订单四表与枚举，
-- 并给开台、结账链路补齐会员资产所需列。
--
-- 隔离原则：本次只做**加法**（新枚举 + 新表 + 新可空列 + 默认 0 的计数列），
-- 不改名、不删除任何既有列，历史数据无需回填即可上线。
--
-- 口径说明：
-- - 金额列统一以「分」存储，元只在接口层转换；
-- - member_cards.remain_times 是次数卡的可用剩余次数，预扣即扣减、释放即回加，
--   服务层必须用带条件的 updateMany（where remain_times >= n）保证并发不超扣；
-- - member_card_orders.order_no 同时作为微信 out_trade_no，全局唯一；
-- - transaction_id 用部分唯一索引做支付回调幂等兜底（仅约束非 null）。

-- CreateEnum
CREATE TYPE "MarketingProductNature" AS ENUM ('regular', 'monthly', 'quarterly', 'yearly', 'times');

-- CreateEnum
CREATE TYPE "MemberCardKind" AS ENUM ('monthly', 'quarterly', 'yearly', 'times');

-- CreateEnum
CREATE TYPE "MemberCardStatus" AS ENUM ('active', 'expired', 'exhausted', 'frozen', 'refunded');

-- CreateEnum
CREATE TYPE "MemberCardSourceType" AS ENUM ('club_order', 'staff_issue', 'gift', 'migration');

-- CreateEnum
CREATE TYPE "MemberCardOrderSource" AS ENUM ('club_wechat', 'staff_cash', 'staff_wechat', 'gift');

-- CreateEnum
CREATE TYPE "MemberCardOrderStatus" AS ENUM ('unpaid', 'pending', 'paid', 'refunded', 'cancelled', 'closed');

-- CreateEnum
CREATE TYPE "MemberCardChangeType" AS ENUM ('reserve', 'consume', 'release', 'purchase', 'refund', 'expire', 'adjust', 'gift');

-- CreateEnum
CREATE TYPE "MemberCardTransactionStatus" AS ENUM ('pending', 'done', 'cancelled');

-- CreateEnum
CREATE TYPE "MemberCardOperatorType" AS ENUM ('club', 'cashier', 'system');

-- AlterTable: 营销商品区分「常规商品 / 卡性质商品」，并单向关联卡模板
ALTER TABLE "marketing_products" ADD COLUMN     "card_plan_id" INTEGER,
ADD COLUMN     "nature" "MarketingProductNature" NOT NULL DEFAULT 'regular';

-- AlterTable: 结账多资产核销拆分（卡抵扣 / 储值余额支付均为非现金收入）
ALTER TABLE "sale_orders" ADD COLUMN     "balance_paid_amount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "card_deduct_amount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable: 开台识别会员并锁定本次使用的会员卡
ALTER TABLE "space_sessions" ADD COLUMN     "active_card_id" INTEGER,
ADD COLUMN     "customer_id" INTEGER;

-- CreateTable
CREATE TABLE "member_card_plans" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "MemberCardKind" NOT NULL,
    "price" INTEGER NOT NULL,
    "original_price" INTEGER,
    "valid_days" INTEGER NOT NULL,
    "total_times" INTEGER,
    "per_use_times" INTEGER NOT NULL DEFAULT 1,
    "usable_space_types" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "usable_weekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "max_guest_per_use" INTEGER,
    "purchase_limit" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "member_card_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_cards" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "plan_id" INTEGER NOT NULL,
    "card_no" VARCHAR(64) NOT NULL,
    "kind" "MemberCardKind" NOT NULL,
    "name_snapshot" TEXT NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "status" "MemberCardStatus" NOT NULL DEFAULT 'active',
    "starts_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3),
    "total_times" INTEGER,
    "used_times" INTEGER DEFAULT 0,
    "remain_times" INTEGER,
    "price_paid" INTEGER NOT NULL DEFAULT 0,
    "source_type" "MemberCardSourceType" NOT NULL DEFAULT 'staff_issue',
    "order_id" INTEGER,
    "operator_staff_id" INTEGER,
    "operator_name_snapshot" VARCHAR(100),
    "remark" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "member_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_card_transactions" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "card_id" INTEGER NOT NULL,
    "change_type" "MemberCardChangeType" NOT NULL,
    "status" "MemberCardTransactionStatus" NOT NULL DEFAULT 'done',
    "delta_times" INTEGER NOT NULL DEFAULT 0,
    "before_times" INTEGER,
    "after_times" INTEGER,
    "related_session_id" INTEGER,
    "related_space_name_snapshot" VARCHAR(100),
    "related_sale_order_no" VARCHAR(64),
    "related_order_id" INTEGER,
    "operator_type" "MemberCardOperatorType" NOT NULL DEFAULT 'system',
    "operator_staff_id" INTEGER,
    "operator_name" VARCHAR(100),
    "remark" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_card_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_card_orders" (
    "id" SERIAL NOT NULL,
    "order_no" VARCHAR(64) NOT NULL,
    "store_id" INTEGER NOT NULL,
    "plan_id" INTEGER NOT NULL,
    "plan_name_snapshot" TEXT NOT NULL,
    "kind" "MemberCardKind" NOT NULL,
    "unit_amount" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "source" "MemberCardOrderSource" NOT NULL,
    "status" "MemberCardOrderStatus" NOT NULL DEFAULT 'unpaid',
    "customer_id" INTEGER NOT NULL,
    "customer_name" VARCHAR(100),
    "customer_phone" VARCHAR(20),
    "club_user_id" INTEGER,
    "operator_staff_id" INTEGER,
    "operator_name" VARCHAR(100),
    "payment_channel" VARCHAR(32),
    "transaction_id" TEXT,
    "sp_mch_id" TEXT,
    "sub_mch_id" TEXT,
    "expires_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "callback_received_at" TIMESTAMP(3),
    "remark" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "member_card_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: 卡性质商品筛选（门店 + 商品性质 + 上架）
CREATE INDEX "marketing_products_store_id_nature_is_active_idx" ON "marketing_products"("store_id", "nature", "is_active");

-- CreateIndex: 按卡模板反查关联商品
CREATE INDEX "marketing_products_card_plan_id_idx" ON "marketing_products"("card_plan_id");

-- CreateIndex: 卡模板列表（门店 + 上架 + 类型，稳定倒序分页）
CREATE INDEX "member_card_plans_store_id_is_active_kind_created_at_id_idx" ON "member_card_plans"("store_id", "is_active", "kind", "created_at" DESC, "id" DESC) WHERE (deleted_at IS NULL);

-- CreateIndex: 卡模板名称关键字检索
CREATE INDEX "member_card_plans_store_id_name_idx" ON "member_card_plans"("store_id", "name") WHERE (deleted_at IS NULL);

-- CreateIndex: 同门店未删除模板名称唯一
CREATE UNIQUE INDEX "uq_member_card_plans_store_name" ON "member_card_plans"("store_id", "name") WHERE (deleted_at IS NULL);

-- CreateIndex: 持卡列表（门店 + 状态 + 类型，稳定倒序分页）
CREATE INDEX "member_cards_store_id_status_kind_created_at_id_idx" ON "member_cards"("store_id", "status", "kind", "created_at" DESC, "id" DESC);

-- CreateIndex: 顾客卡包
CREATE INDEX "member_cards_customer_id_status_created_at_idx" ON "member_cards"("customer_id", "status", "created_at" DESC);

-- CreateIndex: 开台识别可用卡
CREATE INDEX "member_cards_store_id_customer_id_status_idx" ON "member_cards"("store_id", "customer_id", "status");

-- CreateIndex
CREATE INDEX "member_cards_plan_id_idx" ON "member_cards"("plan_id");

-- CreateIndex
CREATE INDEX "member_cards_order_id_idx" ON "member_cards"("order_id");

-- CreateIndex: 到期巡检
CREATE INDEX "member_cards_expires_at_idx" ON "member_cards"("expires_at");

-- CreateIndex: 同门店卡号唯一
CREATE UNIQUE INDEX "uq_member_cards_store_card_no" ON "member_cards"("store_id", "card_no");

-- CreateIndex: 卡详情流水列表
CREATE INDEX "member_card_transactions_card_id_created_at_id_idx" ON "member_card_transactions"("card_id", "created_at" DESC, "id" DESC);

-- CreateIndex: 门店维度流水审计
CREATE INDEX "member_card_transactions_store_id_created_at_idx" ON "member_card_transactions"("store_id", "created_at" DESC);

-- CreateIndex: 结账确认 / 取消释放按场次回查预扣流水
CREATE INDEX "idx_member_card_txn_session_change_status" ON "member_card_transactions"("related_session_id", "change_type", "status");

-- CreateIndex
CREATE INDEX "member_card_transactions_related_order_id_idx" ON "member_card_transactions"("related_order_id");

-- CreateIndex: 微信 out_trade_no 全局唯一
CREATE UNIQUE INDEX "member_card_orders_order_no_key" ON "member_card_orders"("order_no");

-- CreateIndex: 售卡订单列表（门店 + 状态 + 来源）
CREATE INDEX "member_card_orders_store_id_status_source_created_at_id_idx" ON "member_card_orders"("store_id", "status", "source", "created_at" DESC, "id" DESC);

-- CreateIndex: 顾客维度订单 / 限购校验
CREATE INDEX "member_card_orders_customer_id_status_created_at_idx" ON "member_card_orders"("customer_id", "status", "created_at" DESC);

-- CreateIndex: C 端「我的订单」
CREATE INDEX "member_card_orders_club_user_id_created_at_idx" ON "member_card_orders"("club_user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "member_card_orders_plan_id_idx" ON "member_card_orders"("plan_id");

-- CreateIndex: 支付回调幂等最终兜底（同一笔微信流水只允许绑定一个售卡订单）
CREATE UNIQUE INDEX "uq_member_card_orders_transaction" ON "member_card_orders"("transaction_id") WHERE (transaction_id IS NOT NULL);

-- CreateIndex: 门店 + 顾客回查在用场次
CREATE INDEX "space_sessions_store_id_customer_id_idx" ON "space_sessions"("store_id", "customer_id");

-- CreateIndex: 按卡回查在用场次
CREATE INDEX "space_sessions_active_card_id_idx" ON "space_sessions"("active_card_id");

-- AddForeignKey: 卡性质商品 → 卡模板（模板下线不连带删商品）
ALTER TABLE "marketing_products" ADD CONSTRAINT "marketing_products_card_plan_id_fkey" FOREIGN KEY ("card_plan_id") REFERENCES "member_card_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_cards" ADD CONSTRAINT "member_cards_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "member_card_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_cards" ADD CONSTRAINT "member_cards_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "member_card_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_card_transactions" ADD CONSTRAINT "member_card_transactions_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "member_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_card_transactions" ADD CONSTRAINT "member_card_transactions_related_order_id_fkey" FOREIGN KEY ("related_order_id") REFERENCES "member_card_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_card_orders" ADD CONSTRAINT "member_card_orders_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "member_card_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "space_sessions" ADD CONSTRAINT "space_sessions_active_card_id_fkey" FOREIGN KEY ("active_card_id") REFERENCES "member_cards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

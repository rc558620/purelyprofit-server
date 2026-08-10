-- 纯利宝团购券：新增营销商品类型标记与团购券订单表

-- 商品类型枚举：service=服务商品，voucher=团购券商品
CREATE TYPE "MarketingProductType" AS ENUM ('service', 'voucher');

-- 团购券订单状态：unpaid=未支付 pending=待使用 used=已使用 refunded=已退款 expired=已过期
CREATE TYPE "ClubVoucherOrderStatus" AS ENUM ('unpaid', 'pending', 'used', 'refunded', 'expired');

-- AlterTable: 营销商品扩展团购券字段（默认 service，存量商品不受影响）
ALTER TABLE "marketing_products"
  ADD COLUMN "type" "MarketingProductType" NOT NULL DEFAULT 'service',
  ADD COLUMN "valid_days" INTEGER;

-- CreateTable: 团购券订单（券码支付成功后生成，供商家开台读取核销）
CREATE TABLE "club_voucher_orders" (
    "id" SERIAL NOT NULL,
    "voucher_code" TEXT,
    "platform" TEXT NOT NULL DEFAULT 'chunlibao',
    "store_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "customer_id" INTEGER,
    "product_id" INTEGER NOT NULL,
    "product_name" TEXT NOT NULL,
    "product_price" INTEGER NOT NULL,
    "product_original_price" INTEGER,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "person_count" INTEGER,
    "guest_name" TEXT,
    "guest_phone" TEXT,
    "guest_type" TEXT NOT NULL DEFAULT 'member',
    "order_no" TEXT NOT NULL,
    "original_amount_fen" INTEGER NOT NULL,
    "discount_amount_fen" INTEGER NOT NULL DEFAULT 0,
    "paid_amount_fen" INTEGER NOT NULL,
    "points_deduct_fen" INTEGER NOT NULL DEFAULT 0,
    "points_used" INTEGER NOT NULL DEFAULT 0,
    "payment_channel" TEXT NOT NULL DEFAULT 'wechat',
    "transaction_id" TEXT,
    "status" "ClubVoucherOrderStatus" NOT NULL DEFAULT 'unpaid',
    "expires_at" TIMESTAMP(3),
    "verify_at" TIMESTAMP(3),
    "used_at" TIMESTAMP(3),
    "used_store_id" INTEGER,
    "used_session_id" INTEGER,
    "refund_at" TIMESTAMP(3),
    "refund_amount_fen" INTEGER,
    "refund_channel" TEXT,
    "refund_no" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "club_voucher_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: 券码唯一（商家读取/开台核销按券码定位）
CREATE UNIQUE INDEX "club_voucher_orders_voucher_code_key" ON "club_voucher_orders"("voucher_code");

-- CreateIndex: 业务订单号唯一（微信 out_trade_no）
CREATE UNIQUE INDEX "club_voucher_orders_order_no_key" ON "club_voucher_orders"("order_no");

-- CreateIndex: 退款单号唯一（幂等）
CREATE UNIQUE INDEX "club_voucher_orders_refund_no_key" ON "club_voucher_orders"("refund_no");

-- CreateIndex: 门店维度列表/对账查询
CREATE INDEX "club_voucher_orders_store_id_status_created_at_idx" ON "club_voucher_orders"("store_id", "status", "created_at" DESC);

-- CreateIndex: 用户维度列表查询
CREATE INDEX "club_voucher_orders_user_id_status_created_at_idx" ON "club_voucher_orders"("user_id", "status", "created_at" DESC);

-- CreateIndex: 开台会话反向追溯
CREATE INDEX "club_voucher_orders_used_session_id_idx" ON "club_voucher_orders"("used_session_id");

-- 优惠拆解快照：下单时后端生成的优惠明细展示行（会员售价/等级折扣/活动折扣/满减/小计）

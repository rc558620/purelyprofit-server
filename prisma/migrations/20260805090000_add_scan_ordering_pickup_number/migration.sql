-- 扫码点餐取餐号：门店 + 上海业务日维度递增，支付成功后分配，出餐时叫号。

-- 1. 取餐号状态枚举
CREATE TYPE "ScanOrderPickupNumberStatus" AS ENUM ('assigned', 'called', 'completed', 'cancelled');

-- 2. scan_orders 增加取餐号字段
ALTER TABLE "scan_orders"
  ADD COLUMN "pickup_number" INTEGER,
  ADD COLUMN "pickup_business_date" DATE,
  ADD COLUMN "pickup_assigned_at" TIMESTAMPTZ,
  ADD COLUMN "pickup_called_at" TIMESTAMPTZ,
  ADD COLUMN "pickup_completed_at" TIMESTAMPTZ,
  ADD COLUMN "pickup_number_status" "ScanOrderPickupNumberStatus";

CREATE INDEX "scan_orders_store_pickup_date_idx"
  ON "scan_orders"("store_id", "pickup_business_date", "pickup_number");

-- 3. 门店取餐号每日计数表（并发安全：store_id + business_date 唯一）
CREATE TABLE "scan_ordering_pickup_sequences" (
  "id" SERIAL NOT NULL,
  "store_id" INTEGER NOT NULL,
  "business_date" DATE NOT NULL,
  "next_number" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "scan_ordering_pickup_sequences_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "scan_ordering_pickup_sequences_store_id_business_date_key"
  ON "scan_ordering_pickup_sequences"("store_id", "business_date");

CREATE INDEX "scan_ordering_pickup_sequences_store_date_idx"
  ON "scan_ordering_pickup_sequences"("store_id", "business_date");

-- 4. 门店语音播报开关（默认关闭）
ALTER TABLE "stores"
  ADD COLUMN "pickup_voice_enabled" BOOLEAN NOT NULL DEFAULT false;

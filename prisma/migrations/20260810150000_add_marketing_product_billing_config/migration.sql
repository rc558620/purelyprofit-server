-- 营销产品开台计费预配置：团购券商品（type=voucher）新增开台计费字段
-- 供商家开台读取团购券码后快速回填计费方式/预设时长/台位费/到时自动结账/计时单价
ALTER TABLE "marketing_products" ADD COLUMN "billing_mode" TEXT NOT NULL DEFAULT 'items';
ALTER TABLE "marketing_products" ADD COLUMN "hourly_rate" INTEGER;
ALTER TABLE "marketing_products" ADD COLUMN "countdown_minutes" INTEGER;
ALTER TABLE "marketing_products" ADD COLUMN "countdown_price" INTEGER;
ALTER TABLE "marketing_products" ADD COLUMN "auto_checkout" BOOLEAN NOT NULL DEFAULT false;

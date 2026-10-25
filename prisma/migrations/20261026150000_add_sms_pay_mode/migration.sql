-- 支付模式：live=微信真实收款，test=测试模式直充（无微信订单）
-- 真实对账 / 报表只能统计 live，测试单必须靠字段结构性识别，不能靠金额或文案猜
CREATE TYPE "SmsPayMode" AS ENUM ('live', 'test');

-- 存量数据全部来自真实微信支付，默认 live 即可，无需回填脚本
ALTER TABLE "sms_recharge_orders"
  ADD COLUMN "pay_mode" "SmsPayMode" NOT NULL DEFAULT 'live';

ALTER TABLE "sms_wallet_logs"
  ADD COLUMN "pay_mode" "SmsPayMode" NOT NULL DEFAULT 'live';

-- 对账 / 报表按模式过滤
CREATE INDEX "idx_sms_recharge_orders_pay_mode"
  ON "sms_recharge_orders" ("pay_mode", "created_at");
CREATE INDEX "idx_sms_wallet_logs_pay_mode"
  ON "sms_wallet_logs" ("pay_mode", "created_at");

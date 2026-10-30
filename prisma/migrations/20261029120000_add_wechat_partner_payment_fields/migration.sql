-- 服务商（Partner）模式：C 端门店微信收款链路的数据模型扩展
--
-- 背景：原门店收款走「直连普通商户」模式，门店自己提供商户号 + APIv3 密钥。
-- 改造为服务商模式后：签名主体是服务商商户号（sp_mchid，平台持有），
-- 资金去向由子商户号（sub_mchid，商家提供）决定，子商户在微信侧
-- **不存在也不支持设置** APIv3 密钥与证书，回调统一由服务商密钥加密。
--
-- 隔离原则：本次只做**加法**（新增可空列 + 新枚举 + 新索引），
-- 不改名、不改语义、不删除任何既有列，保证 partner.enabled=false 时旧链路零影响。

-- CreateEnum
CREATE TYPE "StoreWechatPayBindStatus" AS ENUM ('pending', 'verified', 'failed');

-- AlterTable: 门店收款配置补充子商户号与绑定状态
ALTER TABLE "store_wechat_pay_configs"
    ADD COLUMN "sub_mch_id" TEXT,
    ADD COLUMN "sub_appid" TEXT,
    ADD COLUMN "bind_status" "StoreWechatPayBindStatus" NOT NULL DEFAULT 'pending',
    ADD COLUMN "bind_checked_at" TIMESTAMP(3),
    ADD COLUMN "bind_fail_reason" TEXT;

-- 回填：历史数据里 mch_id 记录的正是门店自己的商户号，
-- 在服务商模式下其语义等同于子商户号，先回填避免灰度期读到空值。
-- ⚠️ 该回填只是「尽力迁移」：若门店历史上填的是平台商户号（旧实现的错误用法），
-- 回填后 bind_status 仍是 pending，必须在 P4 的授权校验里被拦下，不能直接放行。
UPDATE "store_wechat_pay_configs"
SET "sub_mch_id" = "mch_id"
WHERE "sub_mch_id" IS NULL
  AND "mch_id" IS NOT NULL
  AND "mch_id" <> '';

-- CreateIndex: 回调解密后按 sub_mchid 反查门店做资金归属校验
CREATE INDEX "store_wechat_pay_configs_sub_mch_id_idx" ON "store_wechat_pay_configs"("sub_mch_id");

-- CreateIndex: 运营兜底筛出长期未校验 / 校验失败的门店
CREATE INDEX "store_wechat_pay_configs_bind_status_idx" ON "store_wechat_pay_configs"("bind_status");

-- AlterTable: 充值订单记录下单时的服务商/子商户号，供退款与对账使用
ALTER TABLE "club_recharge_orders"
    ADD COLUMN "sp_mch_id" TEXT,
    ADD COLUMN "sub_mch_id" TEXT;

-- 说明：历史充值单不做回填（改造前压根没有这两个概念），统一留 NULL。
-- P2 退款逻辑必须实现「订单无记录时回落门店当前配置 + 告警」，禁止直接报系统错误。

-- CreateIndex: 按子商户对账 / 导出
CREATE INDEX "club_recharge_orders_sub_mch_id_idx" ON "club_recharge_orders"("sub_mch_id");

-- AlterTable: 团购券订单——退款走微信原路退回（ClubVoucherOrderRefundService），
-- 必须记录原收款主体，禁止退款时再用「门店当前配置」顶替。
ALTER TABLE "club_voucher_orders"
    ADD COLUMN "sp_mch_id" TEXT,
    ADD COLUMN "sub_mch_id" TEXT;

-- AlterTable: 扫码点餐支付尝试——退款同样走 ClubWechatRefundService
ALTER TABLE "scan_order_payment_attempts"
    ADD COLUMN "sp_mch_id" VARCHAR(32),
    ADD COLUMN "sub_mch_id" VARCHAR(32);

-- AlterTable: 自助下单支付尝试——与扫码点餐同构，统一口径（当前无退款调用，预留）
ALTER TABLE "self_order_payment_attempts"
    ADD COLUMN "sp_mch_id" VARCHAR(32),
    ADD COLUMN "sub_mch_id" VARCHAR(32);

-- 说明 1：历史单据一律不回填（改造前没有这两个概念），统一留 NULL。
-- P2 退款逻辑必须实现「订单无记录时回落门店当前配置 + 告警」，禁止直接报系统错误。
-- 说明 2：仅 club_recharge_orders 建了 sub_mch_id 索引。它是数据量最大且有明确
-- 「按子商户对账 / 导出」场景的表；其余三张表日常按单号 / 订单 ID 查询，
-- 暂不为低频导出场景给热表加写成本。

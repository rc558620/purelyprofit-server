-- 每日签到（二）：签到事实表 + 幂等唯一索引 + 统计索引 + 活动侧全量唯一约束。
--
-- 回滚方案（低成本，可独立执行）：
-- DROP INDEX IF EXISTS "marketing_promotions_store_daily_check_in_uniq";
-- DROP TABLE IF EXISTS "club_daily_check_in_records";
-- 表为新表、无历史数据依赖，回滚不会破坏任何既有业务；枚举值的回滚见上一个迁移说明。
--
-- 口径：
-- - check_in_date 为上海时区 YYYY-MM-DD 字符串（字典序 = 日期序，支持范围扫描）；
-- - points_awarded 是积分个数（INTEGER），不是金额分；
-- - 事实表不软删，唯一约束不含 deleted_at；
-- - promotion_id 外键 ON DELETE SET NULL：商家删除签到活动时历史记录保留，
--   不影响既有 DELETE /marketing/promotions/:id 契约。

-- CreateTable
CREATE TABLE "club_daily_check_in_records" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "club_user_id" INTEGER,
    "member_id" INTEGER,
    "promotion_id" INTEGER,
    "check_in_date" TEXT NOT NULL,
    "points_awarded" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "club_daily_check_in_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex：幂等最终兜底（同门店 + 同顾客 + 同上海自然日）
CREATE UNIQUE INDEX "uq_club_daily_check_in_records_store_customer_date"
    ON "club_daily_check_in_records"("store_id", "customer_id", "check_in_date");

-- CreateIndex：门店按日统计 / 报表
CREATE INDEX "idx_club_daily_check_in_records_store_date"
    ON "club_daily_check_in_records"("store_id", "check_in_date");

-- CreateIndex：顾客维度对账与时间线
CREATE INDEX "idx_club_daily_check_in_records_customer_created"
    ON "club_daily_check_in_records"("customer_id", "created_at");

-- CreateIndex：活动维度参与人次统计
CREATE INDEX "idx_club_daily_check_in_records_promotion"
    ON "club_daily_check_in_records"("promotion_id");

-- AddForeignKey
ALTER TABLE "club_daily_check_in_records"
    ADD CONSTRAINT "club_daily_check_in_records_store_id_fkey"
    FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_daily_check_in_records"
    ADD CONSTRAINT "club_daily_check_in_records_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "marketing_customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey：活动删除时仅置空快照，不删除签到事实
ALTER TABLE "club_daily_check_in_records"
    ADD CONSTRAINT "club_daily_check_in_records_promotion_id_fkey"
    FOREIGN KEY ("promotion_id") REFERENCES "marketing_promotions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 单门店「含停用态」最多一个签到活动：
-- 既有部分唯一索引 marketing_promotions_store_type_enabled_uniq 只约束 enabled=true，
-- 停用态若重复创建，C 端 status 会取错配置。此处由数据库共同兜底（跨迁移事务后才可引用新枚举值）。
CREATE UNIQUE INDEX "marketing_promotions_store_daily_check_in_uniq"
    ON "marketing_promotions"("store_id")
    WHERE "type" = 'daily_check_in'::"MarketingPromotionType";

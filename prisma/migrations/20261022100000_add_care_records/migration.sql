/* ── 会员护理档案（care_records）────────────────────────────────
 *
 * 美容院业态：空间场次结账成功后，按场次 guest_phone 匹配 marketing_customers
 * 自动生成护理记录。商家后续在 B 端补录照片与护理说明，会员在 purelyClub 只读查看。
 *
 * 建模约束（与 prisma/purely-profit/operations/care-records.prisma 保持一致）：
 * - 无 deleted_at：业务上护理记录不可删除，且删除会让 seq 断号、对比基线错乱。
 *   顾客软删后，所有读取入口都以「顾客 deleted_at IS NULL」为前驱，记录自然不可达。
 * - session_id 必填 + 唯一：结账幂等键（同一场次只生成一条）。设成可空会让
 *   PG 唯一索引不去重 NULL，数据库兜底失效。
 * - 快照字段（service_name / amount_cents / technician_name）只在结账固化一次，
 *   源数据后续变更不回溯。
 *
 * 时间列沿用全库口径 TIMESTAMP(3)（naive，由 Prisma 按 UTC 解释）；
 * created_at 列默认值 CURRENT_TIMESTAMP 与既有迁移一致。
 *
 * 回滚：
 *   DROP TABLE IF EXISTS "care_records";
 */

-- CreateTable
CREATE TABLE "care_records" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "seq" INTEGER NOT NULL,
    "visit_at" TIMESTAMP(3) NOT NULL,
    "service_name" TEXT NOT NULL DEFAULT '',
    "amount_cents" INTEGER NOT NULL DEFAULT 0,
    "content" VARCHAR(500) NOT NULL DEFAULT '',
    "photos" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "technician_name" TEXT,
    "session_id" INTEGER NOT NULL,
    "created_by_staff_id" INTEGER,
    "updated_by_staff_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "care_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- seq 唯一性兜底：行锁之外的最后一道防线
CREATE UNIQUE INDEX "uq_care_records_customer_seq" ON "care_records"("customer_id", "seq");

-- CreateIndex
-- 结账幂等键 + 溯源
CREATE UNIQUE INDEX "uq_care_records_session" ON "care_records"("session_id");

-- CreateIndex
-- 顾客时间线（B 端详情 / C 端列表）：ORDER BY visit_at 直接走索引
CREATE INDEX "idx_care_records_store_customer_visit" ON "care_records"("store_id", "customer_id", "visit_at");

-- CreateIndex
-- 门店维度列表 / 报表 / 导出：复合排序稳定
CREATE INDEX "idx_care_records_store_visit" ON "care_records"("store_id", "visit_at" DESC, "id" DESC);

-- AddForeignKey
-- RESTRICT：顾客为软删除，物理删除仅在有护理记录时被显式拦截，避免静默丢档
ALTER TABLE "care_records" ADD CONSTRAINT "care_records_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "marketing_customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 续费价覆盖：允许运营为「单个门店 x 单个档位」议定基础价，
-- 支撑新的续费定价公式：
--     续费价 = (本门店本档位的覆盖价 ?? 当前配置价) + 子账号加价
--
-- 设计要点：
-- 1. 覆盖的是**基础配置价**而非最终价，因此年 / 永久档位的子账号加价仍然叠加，
--    与既有公式正交，既不重复计价也不会吞掉已议定的子账号费用。
-- 2. 列可空：NULL 表示未覆盖，完全回落到「配置价 + 子账号加价」的标准口径，
--    存量数据无需订正；运营清空该列即恢复默认价。
-- 3. 与 `price`（成交总额，只记账不参与定价）语义互斥：
--    `price` 是一次成交的结果，本列是**未来每次续费**都生效的定价输入。
--
-- 改价直接影响门店实际扣款，同步建审计表留痕（谁 / 何时 / 从多少改成多少）。

-- AlterTable
ALTER TABLE "store_membership_locked_prices"
  ADD COLUMN IF NOT EXISTS "renewal_price_override" INTEGER;

-- CreateTable
CREATE TABLE IF NOT EXISTS "store_membership_price_override_audits" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "plan_id" "MembershipPlanCycle" NOT NULL,
    "old_price" INTEGER,
    "new_price" INTEGER,
    "operator_user_id" INTEGER,
    "operator_name" TEXT,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_membership_price_override_audits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "store_membership_price_override_audits_store_id_created_at_idx"
  ON "store_membership_price_override_audits"("store_id", "created_at");

CREATE INDEX IF NOT EXISTS "store_membership_price_override_audits_store_id_plan_id_created_at_idx"
  ON "store_membership_price_override_audits"("store_id", "plan_id", "created_at");

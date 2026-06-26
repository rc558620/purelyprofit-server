-- Step 2: 收敛会员/顾客双事实源
-- 建立 Member ↔ MarketingCustomer 双向外键关联
-- 废弃 Member 表中的运行态字段（改为可选，保留历史数据）

-- 1. 为 Member 表添加 customer_id 字段（外键关联到 marketing_customers）
ALTER TABLE "members" ADD COLUMN "customer_id" INTEGER;

-- 2. 为 MarketingCustomer 表添加 member_id 字段（外键关联到 members）
ALTER TABLE "marketing_customers" ADD COLUMN "member_id" INTEGER;

-- 3. 添加唯一索引（确保一对一关系）
CREATE UNIQUE INDEX "members_customer_id_key" ON "members"("customer_id") WHERE "customer_id" IS NOT NULL;
CREATE UNIQUE INDEX "marketing_customers_member_id_key" ON "marketing_customers"("member_id") WHERE "member_id" IS NOT NULL;

-- 4. 添加外键约束
ALTER TABLE "members" ADD CONSTRAINT "members_customer_id_fkey" 
  FOREIGN KEY ("customer_id") REFERENCES "marketing_customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "marketing_customers" ADD CONSTRAINT "marketing_customers_member_id_fkey" 
  FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- 5. 添加外键索引（提升查询性能）
CREATE INDEX "members_customer_id_idx" ON "members"("customer_id");
CREATE INDEX "marketing_customers_member_id_idx" ON "marketing_customers"("member_id");

-- 6. 废弃 Member 表的运行态字段：将 NOT NULL 约束改为允许 NULL
-- （这些字段的值已迁移到 MarketingCustomer 或不再维护）
ALTER TABLE "members" ALTER COLUMN "level" DROP NOT NULL;
ALTER TABLE "members" ALTER COLUMN "points" DROP NOT NULL;
ALTER TABLE "members" ALTER COLUMN "total_consume_amount" DROP NOT NULL;
ALTER TABLE "members" ALTER COLUMN "total_consume_count" DROP NOT NULL;
ALTER TABLE "members" ALTER COLUMN "total_points_earned" DROP NOT NULL;
ALTER TABLE "members" ALTER COLUMN "bean_balance" DROP NOT NULL;
ALTER TABLE "members" ALTER COLUMN "total_recharged" DROP NOT NULL;
ALTER TABLE "members" ALTER COLUMN "recharge_count" DROP NOT NULL;
ALTER TABLE "members" ALTER COLUMN "invited_count" DROP NOT NULL;

-- 注意：
-- - 双向外键关系已建立，但初始数据中两表尚未关联（member_id 和 customer_id 均为 NULL）
-- - 后续需要通过应用层逻辑或数据迁移脚本建立关联（根据 storeId + phone 匹配）
-- - 废弃字段保留了历史数据，应用层代码需改为从 MarketingCustomer 读取运行态数值

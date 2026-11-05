-- 删除「商品性质」：会员卡由卡模板领域与 C 端独立购卡页承载，
-- 营销商品不再区分 nature，也不再单向关联卡模板。

-- DropForeignKey
ALTER TABLE "marketing_products" DROP CONSTRAINT "marketing_products_card_plan_id_fkey";

-- DropIndex
DROP INDEX "marketing_products_store_id_nature_is_active_idx";
DROP INDEX "marketing_products_card_plan_id_idx";

-- AlterTable
ALTER TABLE "marketing_products" DROP COLUMN "nature",
DROP COLUMN "card_plan_id";

-- DropEnum
DROP TYPE "MarketingProductNature";

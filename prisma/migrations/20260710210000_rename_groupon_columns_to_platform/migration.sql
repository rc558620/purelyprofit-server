-- RenameColumns: 团购平台结算字段去掉 groupon_ 前缀，与前端字段命名对齐
ALTER TABLE "sale_orders" RENAME COLUMN "groupon_settlement_status" TO "settlement_status";
ALTER TABLE "sale_orders" RENAME COLUMN "groupon_platform_receivable" TO "platform_receivable";
ALTER TABLE "sale_orders" RENAME COLUMN "groupon_platform_settled_amount" TO "platform_settled_amount";
ALTER TABLE "sale_orders" RENAME COLUMN "groupon_platform_fee" TO "platform_fee";

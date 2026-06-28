-- AlterTable: spaces 表增加 cleaned_at 字段，用于运行态推导脏房 cleaning 状态
ALTER TABLE "spaces" ADD COLUMN "cleaned_at" TIMESTAMP(3);

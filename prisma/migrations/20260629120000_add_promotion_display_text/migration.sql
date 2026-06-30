-- AlterTable: 营销活动增加 display_text 展示文案字段
-- 后端在创建/更新活动时预计算展示文案（如 "打 8 折"、"满 ¥50 减 ¥8"），
-- 前端优先消费此字段而非从 params 推导，保证前后端文案一致。
ALTER TABLE "marketing_promotions" ADD COLUMN "display_text" TEXT;

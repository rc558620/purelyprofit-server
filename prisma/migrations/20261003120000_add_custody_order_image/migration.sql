-- AlterTable
-- 物品图片：存入时由店员上传（前端先传 COS 再带上 URL），用途是取件核销时对着照片比对实物。
-- 该字段是一次写入的快照，后续不随会员 / 商品信息回刷；可空以兼容存量无图存单。
ALTER TABLE "custody_orders" ADD COLUMN "image" VARCHAR(500);

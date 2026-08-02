-- AlterTable: 为 stores 表新增 profile_metadata JSONB 列
-- 门店扩展字段（storeType/region/storeLogo/经纬度/regionLabels）从 Redis 迁移到数据库持久化，
-- 修复 Redis 清空后门店扩展字段丢失的问题。读取时 DB 优先，Redis 仅作为缓存兜底。
ALTER TABLE "stores" ADD COLUMN "profile_metadata" JSONB;

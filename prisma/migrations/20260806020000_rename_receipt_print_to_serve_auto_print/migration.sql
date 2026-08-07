-- 语义修正：小票打印开关 → 出餐自动打印开关。
-- 字段尚未产生任何业务数据依赖，直接重命名列。
-- 保留上一个迁移（20260806010000）历史不变，这里只做 RENAME。

ALTER TABLE "stores"
  RENAME COLUMN "receipt_print_enabled" TO "serve_auto_print_enabled";

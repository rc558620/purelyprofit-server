-- 修复多选规格组“最多选择数量”语义：
-- 数据库约定 null 表示不限选（见 20260801123000_align_scan_ordering_spec_contract）。
-- 历史版本在 sync 落库时用 `maxSelect ?? options.length` 把 null 错误替换为选项数量，
-- 导致“多选不限”的规格组在 C 端被误限制为只能选“选项数量”个。
-- 当前 purelyProfit 商品编辑 UI 已不再暴露“最多选”输入框，多选组统一语义为不限选，
-- 故将 multiple 组的历史显式上限收敛为 NULL；single 组保持 1 不动。
UPDATE "scan_ordering_spec_groups"
SET "max_selections" = NULL
WHERE "selection_type" = 'multiple'
  AND "max_selections" IS NOT NULL;

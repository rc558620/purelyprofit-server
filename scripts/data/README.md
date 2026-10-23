# `fresh-chain-expected-diff.sql` 基线说明

这是 `scripts/verify-fresh-migration-chain.sh` 的差异基线：
**「全新库从零重放全部迁移后的结构」与「schema.prisma」之间已知且有意保留的差异**。

只要每次验证的输出与该文件一致，就说明迁移链健康；出现新行意味着有人改了 schema.prisma
却没有补迁移（或有手写对象没登记），脚本会失败并提示。

## 为什么会有这些差异

Prisma 会用「drop + create」的方式表达它无法 `ALTER` 的结构差异，因此下面三类看似
「要删掉」的语句**不代表要执行**，而是「Prisma 眼中的旧/新定义」：

| 差异 | 来源 | 为什么保留 |
|---|---|---|
| `DROP INDEX products_*_trgm_idx` | 迁移 `20261021090000` 建的 pg_trgm GIN 索引 | 商品 `ILIKE '%kw%'` 搜索加速，schema.prisma 表达不了，只能由迁移维护 |
| `DROP TABLE sale_order_items_archive` | 迁移 `20261016100000` 建的归档表 | 正式业务表，`src/queue/sale-order-items-archive.service.ts` 定期归档在用 |
| `sale_order_items_store_id_order_id_idx` 等 4 组 rebuild | 局部索引谓词写法差异（`IN (...)` vs `= ANY(ARRAY[...])`） | 语义等价，历史对齐迁移遗留，重建收益 < 风险 |

## 什么时候更新基线

```bash
pnpm run db:verify-chain:baseline
```

仅限「确认新差异确实有意保留」时才更新，并在提交说明里写清原因。
若差异来自遗漏的 migration，应该补迁移而不是更新基线。

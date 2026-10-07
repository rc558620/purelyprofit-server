# 上游结论摘要
来源：docs/db-optimization/notes.md →「## S8 模块级优化」中 operations / finance / staff 三节的「缺失索引」条
<I5 上游摘要：粘贴 notes.md 的 S8-operations、S8-finance、S8-staff 三节，或直接读取该文件>

# 本批范围
只做 S8 提出的 3 项新增索引迁移。不碰 S3 的删除与改造（归批 4）。

# 本批任务
逐项落实以下 3 条新增索引（优先读源码核对后再动手）：

1. `sale_order_items`：`[storeId, orderId]` partial，排除条件为
   `product_name NOT IN ('预付抵扣','预付款','续费抵扣')`
   —— 覆盖 aggregateOrderStats 与 business-analysis 的 4 条 raw SQL JOIN + 排除过滤
2. `finance_account_records`：`[storeId, remaining]` partial `WHERE remaining > 0`
   —— 覆盖派生开户状态查询（代码已改为派生状态，不走 DB status 列）
3. `cost_records`：重建被误 DROP 的 partial 索引 `[storeId, sourceType, payrollId]`
   `WHERE payroll_id IS NOT NULL`
   —— 非 unique，唯一性由应用层保证

# 每项必须做到
- **先回源码核对**：确认查询的 WHERE 条件、列名、表名与摘要描述一致；
  摘要中的列名/条件若与源码不符，以源码为准并明确指出差异。
- 确认该索引确实能命中目标查询（给出 EXPLAIN 推演，说明预计走 Index Scan 还是仍会 Seq Scan）。
- 若某项经核实**收益不成立或无法生效**（例如跨字段比较无法用普通索引表达），
  必须明确说明并建议放弃，禁止为凑数而建无用索引。
- 迁移使用 `CREATE INDEX CONCURRENTLY`，附 `DROP INDEX CONCURRENTLY` 回滚。
- 注意第 3 项涉及跨模块（cost_records 由 operations 定义、由 staff 调用路径使用），
  迁移放置位置需符合仓库既有约定，并说明理由。
- 遵循仓库既有迁移的命名与目录约定（先读取 prisma/migrations 下最近几个目录确认格式）。

# 禁止输出
- S3 的索引删除与 partialIndex 改造（归批 4）
- 分区方案
- 业务代码改写

# 交付格式
表 1：3 项索引的源码核对结果（索引 / 摘要描述 / 源码实际条件 / 是否一致 / 目标查询位置）
表 2：每项的 EXPLAIN 推演与预期收益
新增的 migration 文件（实际落地）+ 回滚脚本
若存在建议放弃的项，单独列出并说明理由
校验结果（check-f0rest-rules exit=0）
+ 【I5 摘要】

# 文件操作（本轮结束后执行）
把本轮输出的【I5 摘要】写入 docs/db-optimization/实施/notes.md 中「## I5 索引新增」这一节的正文位置：
- 用「替换」语义覆盖该节原有的「（待填）」占位，禁止追加第二份
- 除该节外，不得改动该文件其它任何内容
- 写完直接结束，不要输出额外说明
若当前环境没有文件写入能力（如网页版对话），忽略本节，仅在对话中输出摘要即可。

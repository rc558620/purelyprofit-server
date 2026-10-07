# 上游结论摘要
来源：docs/db-optimization/notes.md →「## S3 索引结构审计」
<S3 摘要>
来源：docs/db-optimization/notes.md →「## S4 写热点与大表治理」
<S4 摘要>
来源：docs/db-optimization/notes.md →「## S5 退化查询与 N+1」
<S5 摘要>

# 本轮范围
本次只处理模块：<模块名>
其它模块一律不得涉及。
（可填值：operations / member / marketing / finance / goods / staff / stores / club / pulse）

# 本轮任务
1. 该模块在档 A/B/C 下的读写量估算（基于 S1 模型，不要重新推导全局模型）。
2. 引用 S5 中属于本模块的退化查询，逐条给出优化方案。
3. 该模块的缺失索引建议（这是唯一允许提新增索引的轮次）：
   给出 Prisma schema diff + CREATE INDEX CONCURRENTLY 的 SQL + 回滚 SQL。
4. 该模块的缓存策略：哪些查询应进 Redis、TTL、失效策略挂到
   src/redis/cache-invalidator.registry.ts 的哪个 provider，说明与现有预热周期的配合。
5. 该模块的迁移脚本（新增 migration，禁止改动已有迁移）。
6. 上线顺序与灰度建议。

# 禁止输出
- 其它模块的任何内容
- 与 S3/S4/S5 结论冲突的方案（如有冲突必须显式指出并说明理由）

# 交付格式
表 1：本模块读写量估算（档 A/B/C）
表 2：退化查询优化方案（引用 S5 条目编号）
表 3：缺失索引建议（含 schema diff / SQL / 回滚 SQL / 风险）
表 4：缓存策略建议（查询 / 是否入缓存 / TTL / 失效 provider）
表 5：迁移脚本与上线顺序
+ 【S8-<模块名> 摘要】

# 文件操作（本轮结束后执行）
把本轮输出的【S8-<模块名> 摘要】写入 docs/db-optimization/notes.md 中
「## S8 模块级优化」下的「### S8-<模块名>」这一小节的正文位置：
- 用「替换」语义覆盖该小节原有的「（待填）」占位，禁止追加第二份
- 除该小节外，不得改动该文件其它任何内容（尤其不要动其它模块的小节）
- 写完直接结束，不要输出额外说明
若当前环境没有文件写入能力（如网页版对话），忽略本节，仅在对话中输出摘要即可。

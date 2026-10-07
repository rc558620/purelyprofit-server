# 上游结论摘要
来源：docs/db-optimization/notes.md →「## S1 容量建模」
<S1 摘要>

# 本轮任务
只做单机 8 核 16G 的资源分配与 PostgreSQL 参数基线。不做索引、不做查询优化。

1. 给出 CLUSTER_WORKERS / DATABASE_PG_MAX_CONNECTIONS / DATABASE_POOL_MIN 的推荐组合，
   说明依据；并说明若 PG 改为独立部署时这三个值如何调整。
2. 核算 16G 内存分配表：PG(shared_buffers / work_mem / maintenance_work_mem /
   effective_cache_size) + Redis maxmemory + N 个 worker 的 --max-old-space-size + OS，
   逐项给数值并合计，确保不 OOM。给出 Redis 淘汰策略建议。
3. 评估 src/prisma/prisma.service.ts:29-62 池推导逻辑的设计缺陷，
   给出最小改造方案（含改造后的代码片段与回归风险）。
4. 给出 postgresql.conf 调优建议：autovacuum、checkpoint、WAL、
   log_min_duration_statement 设为 80ms 以与 APP_SLOW_QUERY_THRESHOLD_MS 对齐，
   并说明与 80ms 慢 SQL 告警的配合关系。

# 禁止输出
- 索引建议、查询改写、模块级优化
- 与本轮四项无关的任何内容

# 交付格式
表 1：连接池参数推荐表（含 PG 独立部署的对照列）
表 2：16G 内存分配表（项 / 配置值 / 预估占用 / 依据）
表 3：参数变更清单（参数 / 现值 / 建议值 / 影响 / 回滚）
+ 【S2 摘要】

# 文件操作（本轮结束后执行）
把本轮输出的【S2 摘要】写入 docs/db-optimization/notes.md 中「## S2 服务器 / PG 参数基线」这一节的正文位置：
- 用「替换」语义覆盖该节原有的「（待填）」占位，禁止追加第二份
- 除该节外，不得改动该文件其它任何内容
- 写完直接结束，不要输出额外说明
若当前环境没有文件写入能力（如网页版对话），忽略本节，仅在对话中输出摘要即可。

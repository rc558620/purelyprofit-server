# 上游结论摘要
来源：docs/db-optimization/notes.md →「## S2 服务器 / PG 参数基线」（第 18、21、22 行）
<I2 上游摘要：粘贴 notes.md 的 S2 小节，或直接读取该文件>
<I1 摘要：粘贴上一批【I1 摘要】，尤其是最终确定的连接数参数>

# 本批范围
只做服务器侧 PostgreSQL 配置。产出物是「可直接复制的配置片段 + 命令序列」，**不往仓库写文件**。

# 本批任务
按 8 核 16G、应用 + PG + Redis 同机的场景，给出 postgresql.conf 的完整改动清单，至少覆盖：

1. **连接数**：`max_connections` 的最终取值。必须与本批传入的 I1 结论（应用侧 DATABASE_PG_MAX_CONNECTIONS）
   对齐，并留出运维/备份/监控余量。明确说明两者的关系，避免配置了应用侧却忘了服务器侧。
2. **内存**：`shared_buffers`、`work_mem`、`maintenance_work_mem`、`effective_cache_size`。
   必须给出合计占用核算，确保 PG + Redis(1GB) + Node worker 堆 + OS 不超过 16G。
3. **autovacuum**：结合 S4 的热点表结论，给出全局参数与逐表覆盖建议（`ALTER TABLE ... SET (...)`）。
4. **WAL 与 checkpoint**：`max_wal_size`、`min_wal_size`、`wal_buffers`、`checkpoint_completion_target`。
5. **日志**：`log_min_duration_statement=80` 与应用的 `APP_SLOW_QUERY_THRESHOLD_MS=80` 对齐，
   说明双层（PG 全量文本 + 应用业务上下文）如何配合，以及是否需要 `pg_stat_statements`。
6. **时区注意**：数据库会话时区被应用钉死为 UTC（prisma.service.ts:100-109），
   说明这对 `log_timezone` / `timezone` 参数的影响。

# 每项必须给出
- 参数名 / 建议值 / 依据 / 不这么设的后果
- 修改方式：`ALTER SYSTEM SET` 还是编辑 postgresql.conf；是否需要重启（需重启的必须标红）
- 生效与验证命令（如 `SHOW`、`pg_settings` 查询）
- 回滚方式（改回什么值）

# 禁止输出
- 仓库内的代码或文件改动
- 索引与分区方案

# 交付格式
表 1：参数改动总表（参数 / 现值 / 建议值 / 依据 / 是否需重启）
表 2：内存占用核算表（项 / 占用 / 合计 / 余量）
表 3：逐表 autovacuum 覆盖清单（表 / 参数 / 值 / 依据）
代码块：可直接粘贴的 postgresql.conf 片段
代码块：生效 / 验证 / 回滚命令序列
+ 【I2 摘要】

# 文件操作（本轮结束后执行）
把本轮输出的【I2 摘要】写入 docs/db-optimization/实施/notes.md 中「## I2 服务器 PG 配置」这一节的正文位置：
- 用「替换」语义覆盖该节原有的「（待填）」占位，禁止追加第二份
- 除该节外，不得改动该文件其它任何内容
- 写完直接结束，不要输出额外说明
若当前环境没有文件写入能力（如网页版对话），忽略本节，仅在对话中输出摘要即可。

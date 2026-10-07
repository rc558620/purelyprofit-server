# 角色
你是资深 PostgreSQL + Prisma + NestJS 工程师。本轮不是做分析，而是**真正落地改动**：
你要修改仓库内的文件，产出可提交的 migration 与代码 diff。

# 项目背景（已确认事实，任何一轮都不要重复追问、不要复述）
- 后端：NestJS 11 + Fastify 5 + Prisma 7.8（@prisma/adapter-pg，底层原生 pg 连接池）+ PostgreSQL 17 + Redis(ioredis) + BullMQ + socket.io
- 部署：单机多进程 cluster（src/cluster-main.ts，由 CLUSTER_WORKERS 控制 worker 数）
- 多租户：所有业务表以 storeId 归属门店
- Schema：prisma/purely-profit/ 下 27 个 .prisma 分文件，共 103 个 model、261 个 @@index、43 个 @@unique；prisma/migrations 已有 194 个迁移
- 模块：operations、member、marketing、finance、goods、staff、stores、club、pulse、横切（AuditLog/IdempotencyRecord/redis 预热与失效）
- 服务器：单台 8 核 16G，应用 + PostgreSQL + Redis 同机；域名备案中，**尚未上线，无生产数据**
- 连接池现状：集群模式下 DATABASE_POOL_MAX 不生效，每 worker 连接数 =
  max(DATABASE_POOL_MIN, floor(DATABASE_PG_MAX_CONNECTIONS / workers) - 2)
  （见 src/prisma/prisma.service.ts:29-62，函数末尾直接 return autoPoolMax，不与 configuredPoolMax 取 min）
- systemd 的 ExecStart 未传 --max-old-space-size（deploy/systemd/purelyprofit-server.service）
- 业务时区 Asia/Shanghai；数据库会话时区被钉死为 UTC（见 prisma.service.ts:100-109）

# 硬性约束（违反即视为任务失败）
a. 不得修改业务语义与对外接口契约
b. 禁止修改/删除已有 migration 文件，只能新增迁移
c. 新增索引必须用 CONCURRENTLY 方式，避免锁表
d. 业务时区固定 Asia/Shanghai，时间列索引与分区必须说明时区假设
e. Prisma 已开启 partialIndexes，优先用条件索引替代全量索引
f. 不得引入新的重型中间件，除非给出成本收益对比
g. 每批改动必须可独立回滚，且必须给出明确的回滚步骤
h. 修改任何文件前，必须先读取该文件的当前内容确认，禁止凭摘要或记忆猜测代码
i. 只做本批范围内的最小改动，严禁顺手重构或扩大范围

# 上游依据（开工前必读）
- 分析阶段的全部结论在 `docs/db-optimization/notes.md`（含 S1~S9 摘要与关键文件路径、行号）。
- **第一件事就是完整读取该文件**，再开始本批工作。
- 注意：该文件只有摘要，**不含完整 SQL 与完整代码片段**。缺失的细节必须回到仓库源码
  重新推导；不得因为摘要没写就跳过，也不得虚构未经验证的内容。

# 实施纪律
1. 本批动手前，先输出「本批计划」：要改哪些文件、每个文件改什么、如何验证、如何回滚。
   等我确认后再执行。
2. 改动必须真正落到文件里，不要只在对话里贴代码当交付。
3. 每个文件改完必须运行仓库自带校验并保证通过：
   `node scripts/check-f0rest-rules.mjs <改动文件路径>`（要求 exit=0）
   同时运行 `pnpm run typecheck` 确认类型无误。
4. 涉及查询/聚合语义的改动，必须给出「改前 vs 改后」数值一致性的验证方法。
5. 不确定的地方标注「需要确认」并停下来问，禁止用推测填空。
6. 每批结束后输出【I{n} 摘要】（≤15 行）：改了哪些文件 / 验证结果 / 遗留问题 / 回滚方式。
7. 回答用中文。先给结论摘要（≤10 行），再给明细。

---

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

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
来源：docs/db-optimization/实施/notes.md（I1~I10 全部小节）
同时参考：docs/db-optimization/notes.md（分析阶段 S1~S9）
<I11 上游摘要：直接读取上述文件即可>

# 本批背景
前 10 批的改动全部在仓库里，但**服务器上还没有执行任何一项**：
PostgreSQL 参数仍是默认值、systemd 还是旧的、4 个 migration 没跑、扩展没建。
本批的产出物是一份**可以直接照着敲的执行手册**，由用户登录服务器逐条执行。

**你无法访问用户的服务器**，所以不要尝试执行任何远程命令；
你的任务是把命令、预期输出、验证方式、失败处置全部写清楚。

# 本批任务
产出一份新文档：`docs/db-optimization/上线操作手册.md`

要求按**执行顺序**组织，每一步都包含以下四要素，缺一不可：
1. **执行命令**（可直接复制粘贴）
2. **预期输出**（执行成功的正常输出长什么样）
3. **验证命令**（如何确认这一步真的生效了，例如 `SHOW xxx;`、`SELECT ... FROM pg_settings`、`prisma migrate status`）
4. **失败处置**（失败了怎么办、怎么回滚这一步）

## 必须覆盖的内容（按顺序）

### 第 0 步：前置确认（动手前必须全部确认）
- PostgreSQL 版本是否为 17（I2 全程按 17 推演；读 `SELECT version();`）
- PostgreSQL 当前 `max_connections` 实际值（I1/I2 假设为默认 100）
- 磁盘剩余空间（要装得下 I4/I5 的索引重建 + I9 的归档表）
- 当前数据库连接数（批 1 停服重启前要求 < 50）
- 当前是否有正在执行的长事务或备份任务
- `/etc/systemd/system/` 下的 service 文件与仓库 `deploy/systemd/` 是否一致

### 第 1 步：PostgreSQL 参数变更
来自 I2。必须**按「是否需重启」分组**，先做可热加载的、最后做需重启的：
- 可 `ALTER SYSTEM SET` + `SELECT pg_reload_conf();` 生效的项
- 需重启的 3 项：`shared_buffers`、`wal_buffers`、`shared_preload_libraries`
- 每项标注：参数名 / 现值 / 新值 / 生效方式 / 验证命令 / 回滚命令
- 重启 PG 的注意点（与 Node 应用的先后顺序、如何避免应用侧连接风暴）

### 第 2 步：逐表 autovacuum 覆盖
来自 I2 的 5 张表。给出 `ALTER TABLE ... SET (...)` 语句、验证查询、回滚语句。

### 第 3 步：pg_stat_statements 扩展
重启后执行 `CREATE EXTENSION`，给出验证方式。

### 第 4 步：systemd 更新与应用重启
来自 I1。`deploy/systemd/purelyprofit-server.service` 改动（CLUSTER_WORKERS=4 + `--max-old-space-size=1024`）需要同步到服务器：
- 如何把改动同步到 `/etc/systemd/system/`
- `daemon-reload` 与 `restart` 命令
- 重启后如何确认 worker 数与连接池预算都生效（看日志关键字）
- 注意：`production.env` 里的 `CLUSTER_WORKERS` 若已显式设置，会覆盖 systemd 的 Environment 声明——必须先确认

### 第 5 步：执行 4 个 migration
来自 I4 / I5 / I9。**这一步必须在低峰期做**：
- `prisma migrate status` 先看状态，确认没有 drift
- `prisma migrate deploy` 执行
- 逐条说明每个迁移做了什么、预计耗时、预期输出
- 4 个迁移各自的回滚方式（执行对应目录下的 `migration_rollback.sql`）
- 特别提醒：I9 的归档表迁移只是建表，不迁移数据；数据迁移由运行时的归档任务负责

### 第 6 步：归档任务首次启用
来自 I9。首次启用可能触发大批量迁移（单次最多 100 万行 / 200 批，约 20s）：
- 为什么建议低峰期首次启用
- 如何观察首次执行（日志关键字）
- 如果首次执行时间过长怎么办

### 第 7 步：上线后 7 天观测
来自 I8。列出 3 项 P0 告警与 9 项 P1 指标，给出具体采集命令（`pg_stat_activity`、`pg_locks`、`pg_stat_statements` 查询语句）。

### 第 8 步：压测执行（可选，建议在正式开放前做）
来自 I8。4 个 seed 脚本 + k6 的执行顺序、数据量、预计耗时、达标线。

## 额外要求
- 全篇用中文，命令用代码块
- 每一步开头标注：**可在线 / 需低峰期 / 需停服**
- 每一步结尾给一个勾选框式的小结（如 `[ ] 已确认 max_connections = 100`）
- 明确标出「本步失败必须停止，不要继续下一步」的地方
- 若发现上游结论之间有矛盾（例如 I1 与 I2 的连接数取值不一致），先指出来问我，不要自行圆场

# 禁止输出
- 任何对仓库业务代码的改动（本批只新增这一份文档）
- 未经核实的服务器状态假设（凡是你没读到的信息，标为「待用户确认」）

# 交付格式
实际落地文件：`docs/db-optimization/上线操作手册.md`
+ 【I11 摘要】

# 文件操作（本轮结束后执行）
把本轮输出的【I11 摘要】写入 docs/db-optimization/实施/notes.md 中「## I11 服务器执行手册」这一节的正文位置：
- 用「替换」语义覆盖该节原有的「（待填）」占位，禁止追加第二份
- 除该节外，不得改动该文件其它任何内容
- 写完直接结束，不要输出额外说明
若当前环境没有文件写入能力（如网页版对话），忽略本节，仅在对话中输出摘要即可。

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

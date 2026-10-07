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
来源：docs/db-optimization/notes.md →「## S9 验证与上线」（第 136~145 行）
<I8 上游摘要：粘贴 notes.md 的 S9 小节
同时粘贴 I1~I7 摘要，或直接读取 docs/db-optimization/实施/notes.md 全文>

# 本批范围
上线前的压测准备与上线执行清单。不改业务逻辑。

# 任务一：压测数据构造
S9 指出需要新建 4 个 seed 脚本（stores / members / orders / finance）。
按仓库既有 seed 脚本风格实现（先读 scripts/ 下现有的 seed-*.mjs 与 .tmp-backup 相关脚本确认约定）：
- 目标数据量对齐档 B：500 门店，`sale_order_items` 约 600 万行覆盖 30 天
- 必须支持幂等重跑与清理（能清掉自己造的数据）
- 禁止在生产库执行，脚本内要有环境检查保护

# 任务二：压测方案
1. 用 k6 或 autocannon 编写场景，覆盖 S9 列出的 8 个场景（含混合峰值）
2. 明确并发模型：阶跃加压到峰值 QPS（档 A ~25 / 档 B ~115），并说明如何模拟 C 端与 B 端比例
3. 达标线：P95 ≤ 300ms / P99 ≤ 500ms / 错误率 < 0.1%
4. 观测口径：应用侧（慢 SQL 80ms 告警、慢请求 800ms、PoolTimeout）、
   数据库侧（pg_stat_activity active、pg_locks not granted、IOPS await、缓存命中率）
5. 给出压测前必须确认的环境前提（否则结果无意义）

# 任务三：上线执行清单
把 I1~I7 的所有改动汇总成可执行的清单，按 S9 的四批分组，
并回答：
1. 每批的**前置条件**是什么（例如：批 1 停服重启前必须确认当前 PG 连接数 < 50）
2. 每批的**验证方式**（EXPLAIN 前后对比、DB 往返计数、数值一致性抽样）
3. 每批的**回滚步骤**（必须具体到命令或文件改动）
4. 执行顺序与窗口（可在线 / 需低峰 / 需停服），以及与 PG 参数变更的先后关系
5. 上线后 7 天的观测指标与告警阈值（S9 提到 12 项指标、3 项 P0 告警，逐条落实）

**特别注意**：S9 原文的变更分类存在重复计数（V03 同时出现在"参数配置"与"代码改写"），
请以 I1~I7 的实际落地内容为准重新编号，不要沿用 S9 的编号而不核对。

# 禁止输出
- 任何新的优化建议
- 未在 I1~I7 中落地的改动

# 交付格式
4 个 seed 脚本（实际落地到 scripts/）
k6 场景脚本（实际落地）
表 1：上线执行清单（批次 / 变更项 / 前置条件 / 执行窗口 / 验证方式 / 回滚步骤）
表 2：上线后 7 天观测指标与告警阈值（指标 / 阈值 / 采集方式 / 处置动作）
校验结果（check-f0rest-rules exit=0）
+ 【I8 摘要】

# 文件操作（本轮结束后执行）
把本轮输出的【I8 摘要】写入 docs/db-optimization/实施/notes.md 中「## I8 压测与上线」这一节的正文位置：
- 用「替换」语义覆盖该节原有的「（待填）」占位，禁止追加第二份
- 除该节外，不得改动该文件其它任何内容
- 写完直接结束，不要输出额外说明
若当前环境没有文件写入能力（如网页版对话），忽略本节，仅在对话中输出摘要即可。

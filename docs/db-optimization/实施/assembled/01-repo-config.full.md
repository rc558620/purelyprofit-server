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
来源：docs/db-optimization/notes.md →「## S2 服务器 / PG 参数基线」（第 15~23 行）
<I1 上游摘要：粘贴 notes.md 的 S2 小节，或直接读取该文件>

# 本批范围
只做仓库内的进程参数与连接池配置。不碰索引、不碰分区、不碰业务代码。

# 必做前置校验（最重要，先做这个）
S2 给出的 `DATABASE_PG_MAX_CONNECTIONS=120` 推导出总连接 112。
但该变量的语义是「PostgreSQL 侧 max_connections 配置值」，PrismaService 会据此自动调整每 worker 池大小
（见 src/prisma/prisma.service.ts:29-62 与 207-222 的 warnIfPoolExceedsPostgresLimit）。

**因此必须先核实并回答：**
1. PostgreSQL 当前 `max_connections` 实际是多少？（默认 100）
2. 若设为 120，应用侧总连接 112 是否超过 PG 实际可接受值？是否给运维、备份、监控留了余量？
3. 8 核机器上 112 条连接是否合理？（PostgreSQL 实践建议活跃连接数为 CPU 核数的 2~4 倍，即 16~32）
   如果结论是「不应吃满」，请给出你推荐的组合并说明理由，**不要盲目沿用 S2 的 120**。
4. 该变量只是应用侧自设预算，还是必须与 PG 实际 max_connections 一致？请说清楚，避免运维误解。

把结论明确写出来，再进入改动。

# 本批任务
1. 修复 src/prisma/prisma.service.ts 的池推导缺陷：
   函数 resolveEffectivePoolMax 末尾直接 `return autoPoolMax`，不与 configuredPoolMax 取 min，
   导致 pgMax 调大时每 worker 池远超 DATABASE_POOL_MAX 的配置意图。
   给出最小改动（使其尊重配置上限），并说明对现有部署行为的影响。
2. 修改 deploy/systemd/purelyprofit-server.service：
   ExecStart 补上 `--max-old-space-size=1024`（当前未传，worker 堆上限走 Node 默认值）。
3. 更新 .env.example 与生产环境配置模板中与本批相关的键：
   CLUSTER_WORKERS / DATABASE_PG_MAX_CONNECTIONS / DATABASE_POOL_MIN / DATABASE_POOL_MAX，
   并补上必要的中文注释说明各值的含义与相互关系。

# 禁止输出
- 任何索引建议或迁移
- 任何分区方案
- 任何业务代码改写（业务代码归批 6）

# 交付格式
1. 前置校验结论（4 个问题的答案 + 推荐参数组合表）
2. 本批计划（文件 / 改动内容 / 验证方式 / 回滚方式）——等我确认
3. 实际文件改动（用编辑工具落地）
4. 校验结果（check-f0rest-rules exit=0 + typecheck 通过）
5. 【I1 摘要】

# 文件操作（本轮结束后执行）
把本轮输出的【I1 摘要】写入 docs/db-optimization/实施/notes.md 中「## I1 仓库参数与进程配置」这一节的正文位置：
- 用「替换」语义覆盖该节原有的「（待填）」占位，禁止追加第二份
- 除该节外，不得改动该文件其它任何内容
- 写完直接结束，不要输出额外说明
若当前环境没有文件写入能力（如网页版对话），忽略本节，仅在对话中输出摘要即可。

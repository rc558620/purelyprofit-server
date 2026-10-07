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
来源：docs/db-optimization/notes.md →「## S9 验证与上线」第 137~145 行、「## S5 退化查询与 N+1」、「## S8 模块级优化」
<I6 上游摘要：粘贴 notes.md 的 S5 与 S9 小节，或直接读取该文件>

# 本批输入：本次要改写的项
<本次改写的项：从 S9 的代码改写清单中挑，一次不超过 3 项；粘贴对应条目>

# 本批范围
只做上面指定的代码改写。**不要一次性把 8 项全做了**，按我给的批次来。
本批不碰索引、不碰分区、不碰配置。

# 背景（哪些是可做的、哪些明确不做）
S8 已经逐项评估过，其中**有多项结论是「暂不改动」**（已命中缓存、表规模可控、改写成本高于收益）。
你必须先读 S8 对应模块的结论，**只改那些明确判定为"应改/可改"的项**，
对判定为"暂不动"的项不要擅自改，如果认为结论有误可以提出，但要先说明依据再等我确认。

# 每项必须做到
1. 先 Read 目标文件确认当前实现（禁止凭摘要猜代码），指出摘要描述与源码的差异。
2. 给出改动前后的对比：行为是否等价、结果值是否等价、DB 往返次数变化。
3. **数值一致性验证方法**：凡是涉及金额、统计、聚合的改写
   （如 `SUM(DISTINCT)` 改子查询预聚合、逐条 update 改批量 UPDATE），
   必须给出可执行的验证方式：如何抽样比对改前改后结果完全一致。
   金额相关改写在仓库规范里是红线（后端为金额唯一权威来源）。
4. 改动要落到文件里，并给出该文件的完整 diff。
5. 改完运行 `node scripts/check-f0rest-rules.mjs <文件路径>`（要求 exit=0）与 `pnpm run typecheck`。
6. 指出该改动是否需要配套测试（仓库用 jest，测试文件与被测文件同目录 `.spec.ts`），
   需要就一并补测试；若仓库规范要求 TDD，则先补测试再改实现。

# 禁止输出
- 本批未指定的其它改写项
- 索引与分区方案
- 顺手重构、格式化、改注释等扩大范围的改动

# 交付格式
表 1：本批各项的可做性确认（项 / S8 判定 / 源码实际情况 / 是否实施 / 理由）
逐项：改动前代码 → 改动后代码 → diff → 行为与数值等价性说明
数值一致性验证步骤（可执行的具体命令或脚本）
校验结果（check-f0rest-rules exit=0 + typecheck 通过）
+ 【I6 摘要】

# 文件操作（本轮结束后执行）
把本轮输出的【I6 摘要】追加到 docs/db-optimization/实施/notes.md 中「## I6 代码改写」这一节的正文位置：
- 本批可能跑多轮，每轮追加一条要点，不要覆盖上一轮的内容
- 除该节外，不得改动该文件其它任何内容
- 写完直接结束，不要输出额外说明
若当前环境没有文件写入能力（如网页版对话），忽略本节，仅在对话中输出摘要即可。

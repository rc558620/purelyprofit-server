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
来源：docs/db-optimization/notes.md →「## S8 模块级优化」中 S8-club 的缓存条、「## S7 幂等与审计表增长」
<I7 上游摘要：粘贴 notes.md 的 S7 与 S8-club 小节，或直接读取该文件>

# 本批范围
只做两件事：club 端读缓存接入 + 无界增长表的清理任务。不碰索引、分区、其它模块。

# 任务一：club 端读缓存
1. `getMenu` 入缓存 30s，key = `club:menu:{storeId}:{menuVersion}`（版本不变即命中）
2. `getSnapshotByStoreIdentity` 入缓存 15s，key = `club:member-snapshot:{storeId}:{userId}`
3. `loadActivePromotions` 入缓存 60s，key = `club:promotions:{storeId}`

要求：
- 统一复用 `src/redis/redis.service.ts`，禁止在业务文件里 `new Redis()`（仓库规范红线）
- 缓存 key 必须挂到既有 key 管理约定（先读 src/redis/keys/ 与 cache-keys.ts 确认写法）
- 失效策略复用既有 invalidator：
  `invalidateMarketingCustomerDerived`（checkout.service.ts:267-269 已调用）与 `invalidateMarketingOverview`
  —— 先读 src/redis/cache-invalidator.registry.ts 确认这两个 provider 的现有语义，
  确认挂载点是否合适；若需要新增 provider，说明理由
- 这三个 key 均为短 TTL、用户/门店级粒度，**不要**注册到 prewarm-cycle
- 说明缓存穿透与击穿的处理（空值缓存？并发重建？），若不做要说明为什么可以不做

# 任务二：无界增长表清理任务
按 S7 结论实现 retention-cleanup：
1. `idempotency_records`：保留 7 天（`expires_at` + 1 天安全余量），每 6h 执行一次
2. `audit_logs`：保留 90 天，每 24h 执行一次**分批** DELETE（禁止单条大 DELETE 长事务）

要求：
- 集成到既有队列体系：读取 src/queue/queue.module.ts、queue-scheduler.service.ts、
  以及现有 processor 的写法（如 cache-prewarm.processor.ts）后再动手，保持风格一致
- 新增 `retention-cleanup` 队列 + processor + repeatable job 注册
- 分批删除的 batch size 与 sleep 策略要明确，并说明如何避免长事务与膨胀
- 说明在集群多 worker 下如何保证同一时刻只有一个实例执行（参考现有 processor 的处理方式）
- 给出该任务的观测方式（日志关键字、删除行数指标）

# 禁止输出
- 索引与分区方案
- 其它模块的缓存改动
- 顺手重构既有 processor

# 交付格式
表 1：3 个缓存的接入点对照（查询 / 现有实现位置 / 接入方式 / TTL / 失效 provider / 穿透处理）
表 2：清理任务的参数表（表 / 保留期 / 频率 / 批大小 / 依据）
实际文件改动（缓存接入 + 队列模块 + processor + scheduler 注册）
校验结果（check-f0rest-rules exit=0 + typecheck 通过）
【I7 摘要】

# 文件操作（本轮结束后执行）
把本轮输出的【I7 摘要】写入 docs/db-optimization/实施/notes.md 中「## I7 缓存与清理」这一节的正文位置：
- 用「替换」语义覆盖该节原有的「（待填）」占位，禁止追加第二份
- 除该节外，不得改动该文件其它任何内容
- 写完直接结束，不要输出额外说明
若当前环境没有文件写入能力（如网页版对话），忽略本节，仅在对话中输出摘要即可。

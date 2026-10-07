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
来源：docs/db-optimization/实施/notes.md →「## I3 分区决策」
同时参考：docs/db-optimization/notes.md →「## S4 写热点与大表治理」「## S7 幂等与审计表增长」
<I9 上游摘要：粘贴 I3 的结论，或直接读取上述文件>

# 本批背景
I3 已拍板走**路线 B：归档冷热分离**（不做声明式分区），本批把它真正落地。
没有本批，I3 的结论就是一纸空文：`sale_order_items` 仍会按 S4 推演的速度（档 B 年增 1.1 亿行）无限膨胀。

# 本批范围
只做归档机制。不碰索引、不改业务查询、不动 I6 的代码改写项。

# 本批任务
1. **归档表设计**
   - 新建 `sale_order_items` 的归档表（同库同 schema），结构与源表一致
   - 明确命名、是否需要索引、是否复用原表索引结构（归档表通常只需要极少的索引）
   - 给出新增 migration（含 `migration_rollback.sql`），遵循仓库既有迁移的命名与目录约定
     （先读 prisma/migrations 下最近几个目录确认格式，例如 20261015100000_add_indexes_for_s8）

2. **归档任务**
   - 用 BullMQ repeatable job 分批迁移超过保留窗口的数据，**5000 行/批/事务**
   - 保留窗口默认取 I3 的建议值（6 个月），并做成可配置（走 ConfigService，禁止业务代码直接读 process.env）
   - 必须保证：
     · **幂等**：重复执行不会重复迁移或丢数据
     · **断点续传**：任务中途失败后能继续，不会卡死
     · **集群安全**：多 worker 下同一时刻只有一个实例执行（参考 src/queue/ 下现有 processor 的做法）
     · **不产生长事务**：单批事务要有明确边界与 sleep 间隔
   - 迁移顺序必须保证不丢数据：**先 INSERT 到归档表 → 校验行数 → 再 DELETE 源表**，
     两步之间的失败处理策略要写清楚

3. **与 I7 的关系（必须明确回答）**
   I7 会实现 `retention-cleanup` 队列（`idempotency_records` 保留 7 天、`audit_logs` 保留 90 天）。
   本批的归档任务与它是同一个队列加 job，还是独立队列？给出结论与理由。
   若 I7 尚未实施，说明你本批新建了什么，避免两者重复建队列。

4. **Prisma 模型处理**
   - 归档表是否需要声明为 Prisma model？说明理由。
   - 若不需要（推荐用 raw SQL 写入），明确说明如何避免污染 Prisma Client 与 `migrate diff` 产生 drift。
   - 若需要，说明对 Prisma Client API 的影响面。

5. **验证方式**
   - 数据一致性：迁移前后 `COUNT` 与关键聚合值对比（给出可执行 SQL）
   - 性能：归档前 vs 归档后 `EXPLAIN ANALYZE` 对比（针对 S5 中退化的 `sale_order_items` 查询）
   - 回滚：具体到命令

6. **I3 遗留的 4 个待拍板项**
   （① 热表保留窗口 6 vs 12 个月 ② 归档表存储位置 ③ 是否需要历史查询路由 ④ 档C前是否重新评估分区）
   请为每一项给出你的推荐值 + 理由，并明确标注「需要用户确认」。
   保留窗口给出默认值后，配置项按该默认值实现，不要因为待确认就停下来不做。

# 禁止输出
- 索引增删建议（已归 I4/I5）
- 业务查询改写（归 I6）
- 声明式分区方案（I3 已否决）

# 交付格式
表 1：归档表设计（表名 / 结构 / 索引 / 与源表的差异 / 依据）
表 2：归档任务参数（保留窗口 / 批次大小 / 执行频率 / sleep / 断点续传策略 / 依据）
表 3：与 I7 retention-cleanup 的关系结论
表 4：I3 四个待拍板项的推荐值
实际落地文件（migration.sql + migration_rollback.sql + processor + 队列注册 + 配置项）
验证 SQL 与回滚步骤
校验结果（check-f0rest-rules exit=0 + pnpm run typecheck 通过 + pnpm run test 通过）
+ 【I9 摘要】

# 文件操作（本轮结束后执行）
把本轮输出的【I9 摘要】写入 docs/db-optimization/实施/notes.md 中「## I9 归档任务」这一节的正文位置：
- 用「替换」语义覆盖该节原有的「（待填）」占位，禁止追加第二份
- 除该节外，不得改动该文件其它任何内容
- 写完直接结束，不要输出额外说明
若当前环境没有文件写入能力（如网页版对话），忽略本节，仅在对话中输出摘要即可。

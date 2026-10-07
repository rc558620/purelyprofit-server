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
来源：docs/db-optimization/notes.md →「## S4 写热点与大表治理」第 39 行、「## S1 容量建模」第 13 行
<I3 上游摘要：粘贴 notes.md 的 S4 小节要点，或直接读取该文件>

# 本批范围
本批**只做可行性评估与方案决策，不写任何迁移**。等我拍板后再进入实施。

# 背景：一个必须先解决的技术冲突
S4 判定 `sale_order_items` 与 `audit_logs` 在档 B 就必须分区（RANGE created_at 按月）。
但存在一个已知障碍，必须先核实：

> PostgreSQL 规定：分区表的主键与唯一约束**必须包含分区键**。
> 若这两张表当前主键是单列 `id`，按 `created_at` 分区就意味着主键要变成 `(id, created_at)`。
> 而 Prisma 模型的 `@id` 一旦改为 `@@id([id, createdAt])`，
> **Prisma Client 的 API 会随之改变**（`findUnique({ where: { id } })` 将不再合法），
> 这可能直接违反硬性约束 a「不得修改业务语义与对外接口契约」。

# 本批任务
1. 先读仓库确认事实：`sale_order_items` 与 `audit_logs`（以及审计表的实际表名）当前的
   主键、唯一约束、外键引用情况。给出文件路径与行号。
   （重点：哪些代码用 `findUnique({ where: { id } })` 或依赖 `id` 唯一性？数量级是多少？）
2. 评估三条路线的真实可行性，逐条给出对 Prisma 客户端与业务代码的**实际影响面**：
   - 路线 A：声明式分区（RANGE by created_at），主键改为复合
   - 路线 B：归档冷热分离（不分区，热表保留 N 个月，历史行定期迁移到归档表/归档库）
   - 路线 C：维持现状，仅靠清理任务（见 S7 的 retention-cleanup）控制增长
3. 给出明确推荐方案 + 依据 + 不选另外两条的理由。
4. 说明**当前时机窗口**：项目尚未上线、零数据，若走分区路线现在是成本最低的时刻；
   但若分区会破坏 Prisma 客户端契约，则应明确说"不做分区"并说明替代方案能达到多少效果。
5. 给出该方案的验证方式与回滚方式。

# 禁止输出
- 任何 migration 文件
- 任何 schema.prisma 改动
- 任何代码改动
本批只出决策文档。

# 交付格式
表 1：两张表的当前主键与唯一约束现状（表 / 主键 / 唯一约束 / 依赖 id 唯一性的代码位置与处数）
表 2：三条路线对比（路线 / 可行性 / 对 Prisma 客户端的影响 / 对业务代码的改动量 / 风险 / 收益）
结论：推荐路线 + 依据
+ 下一步需要我拍板的问题清单
+ 【I3 摘要】

# 文件操作（本轮结束后执行）
把本轮输出的【I3 摘要】写入 docs/db-optimization/实施/notes.md 中「## I3 分区决策」这一节的正文位置：
- 用「替换」语义覆盖该节原有的「（待填）」占位，禁止追加第二份
- 该节需要保留「推荐路线」与「待拍板问题」两项，不要只写结论
- 除该节外，不得改动该文件其它任何内容
- 写完直接结束，不要输出额外说明
若当前环境没有文件写入能力（如网页版对话），忽略本节，仅在对话中输出摘要即可。

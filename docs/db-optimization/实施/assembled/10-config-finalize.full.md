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
来源：docs/db-optimization/实施/notes.md →「## I9 归档任务」「## I3 分区决策」
<I10 上游摘要：粘贴 I3 与 I9 的结论，或直接读取上述文件>

# 本批背景
I3 的四个待拍板项已由用户拍板，结论如下（本批按此执行）：

① **热表保留窗口 → 12 个月**（365 天）。I9 当前默认 180 天，需要改。
② 归档表存储位置 → 同库同 schema（维持 I9 现状，**无需改动**）
③ 历史查询路由 → 不做（维持 I9 现状，**无需改动**）
④ 档 C 前重评估分区 → 设触发条件，不设时间点（**无需改动**，写入文档即可）

因此本批只有决策①需要落到代码。

# 本批任务

## 任务 1：修改归档保留窗口默认值
把 `sale_order_items` 热表保留窗口从 **180 天改为 365 天**：
- `src/config/configuration.ts` 中该归档配置项的默认值
- `.env.example` 中对应的环境变量与中文注释

要求：
- 注释语义必须准确：「保留窗口」指**热表保留时长**，不是归档表保留时长。
  归档表是长期存储、不做自动清理（改为 12 个月后归档表增长会更快，注释里说明这一点）。
- 业务代码禁止直接读 process.env，配置统一在 configuration.ts 映射（仓库规范）。
- 改完确认类型定义（若存在 TS 类型或 interface）同步更新。

## 任务 2：全量校验
必须全部通过并贴出结果：
- `node scripts/check-f0rest-rules.mjs <改动文件>` → exit=0
- `pnpm run typecheck` → 通过
- `pnpm run test` → **290/290 套件、2852/2852 用例全绿**，贴出汇总行

若测试不是全绿，先停下来报告，不要继续。

## 任务 3：提交 git（必须先给我看，等我确认再提交）
仓库当前有大量未提交改动（前 9 批的成果）。请：
1. 先运行 `git status --short` 与 `git diff --stat`，把结果完整贴给我
2. 提出 commit 拆分建议（哪些文件属于哪个逻辑批次），以及每条的 commit message
3. **停下来等我确认**，我确认后再执行 `git add` 与 `git commit`

建议的拆分思路（供参考，你可优化）：
- 参数与进程配置（I1 改的 prisma.service.ts / systemd / .env.example）
- 索引治理（I4 + I5 的 prisma schema 与迁移）
- 查询与聚合改写（I6 的 service/query 文件）
- 缓存、清理与归档（I7 + I9 的 redis/queue 文件与迁移）
- 文档（docs/db-optimization/ 整个目录）

注意：
- 不确定归属的文件要单独列出并问我，不要硬塞进某一批
- `docs/db-optimization/` 是本次工作的产出文档，建议一并提交
- 仓库里若存在与本任务无关的改动或未跟踪目录（例如 .tmp-backup/），先指出来问我怎么处理，不要擅自提交

# 禁止输出
- 修改除上述两个配置项以外的任何业务代码
- 顺手重构、格式化、拆分超长文件（那属于后续独立任务）
- 未经我确认就执行 git commit

# 交付格式
1. 保留窗口改动的 diff（configuration.ts + .env.example）
2. 校验结果（check-f0rest-rules / typecheck / test 三份结果）
3. `git status --short` 与 `git diff --stat` 输出
4. commit 拆分建议 + 每条 message
5. 【I10 摘要】

# 文件操作（本轮结束后执行）
把本轮输出的【I10 摘要】写入 docs/db-optimization/实施/notes.md 中「## I10 仓库收尾」这一节的正文位置：
- 用「替换」语义覆盖该节原有的「（待填）」占位，禁止追加第二份
- 除该节外，不得改动该文件其它任何内容
- 写完直接结束，不要输出额外说明
若当前环境没有文件写入能力（如网页版对话），忽略本节，仅在对话中输出摘要即可。

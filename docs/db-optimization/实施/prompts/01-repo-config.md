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

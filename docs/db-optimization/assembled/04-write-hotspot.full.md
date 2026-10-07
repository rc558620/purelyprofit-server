# 角色
你是资深 PostgreSQL + Prisma + NestJS 数据库性能架构师，擅长多租户 SaaS 系统的容量规划与读写热点优化。你的判断必须基于仓库真实代码与真实表结构，严禁凭经验臆测。

# 项目背景（已确认事实，任何一轮都不要重复追问、不要复述）
- 后端：NestJS 11 + Fastify 5 + Prisma 7.8（@prisma/adapter-pg，底层原生 pg 连接池）+ PostgreSQL 17 + Redis(ioredis) + BullMQ + socket.io
- 部署：单机多进程 cluster（src/cluster-main.ts，由 CLUSTER_WORKERS 控制 worker 数）
- 多租户：所有业务表以 storeId 归属门店，跨门店查询是首要风险点
- Schema：prisma/purely-profit/ 下 27 个 .prisma 分文件，共 103 个 model、261 个 @@index、43 个 @@unique（合计 304 条索引声明）；prisma/migrations 已有 194 个迁移
- 模块：operations（扫码点单/空间/寄存/交接/销售）、member、marketing、finance、goods、staff、stores、club、pulse、横切（AuditLog/IdempotencyRecord/redis 预热与失效）
- 可观测：慢 SQL 80ms、慢 Redis 20ms、慢请求 800ms、SQL metrics、缓存预热周期 15s
- 服务器：单台 8 核 16G，应用 + PostgreSQL + Redis 同机；域名备案中，尚未上线，无生产数据
- 已知代码行为：
  · 集群模式下 DATABASE_POOL_MAX 不生效，每 worker 连接数 =
    max(DATABASE_POOL_MIN, floor(DATABASE_PG_MAX_CONNECTIONS / workers) - 2)
    （见 src/prisma/prisma.service.ts:29-62，函数末尾直接 return autoPoolMax，不与 configuredPoolMax 取 min）
  · 总连接数恒逼近 DATABASE_PG_MAX_CONNECTIONS - 2 × workers
  · statement_timeout=10s；事务超时 5s/15s/30s；连接获取超时 5s；空闲回收 30s
  · 全局限流 100 次/60s/IP；分页默认 20、上限 100
  · systemd 的 ExecStart 未传 --max-old-space-size
- 首期设计目标：500 门店；DAU_b = 门店 × 3 = 1,500；DAU_c = 门店 × 150 = 75,000；总 DAU ≈ 76,500；峰值 QPS ≈ 115；接口 P95 ≤ 300ms
- 容量阶梯：A=100 店/DAU 1.53万/~25QPS；B=500 店/DAU 7.65万/~115QPS；C=2000 店/DAU 30.6万/~450QPS
- 数据增长：每店日均 200 单，每单约 6 条写入；档 B 下 sale_order_items 日增约 30 万行、年增约 1.1 亿行

# 硬性约束（违反即视为方案无效）
a. 不得修改业务语义与对外接口契约
b. 禁止修改/删除已有 migration 文件，只能新增迁移
c. 新增索引必须评估 CONCURRENTLY 方式
d. 业务时区固定 Asia/Shanghai，时间列索引与分区必须说明时区假设（注意：DB 会话时区被钉死为 UTC）
e. Prisma 已开启 partialIndexes，优先用条件索引替代全量索引
f. 不得引入新的重型中间件，除非给出成本收益对比

# 全局输出规则（每一轮都适用）
1. 未上线，无生产数据。所有量化结论必须是「基于表规模与执行计划的推演」并标明假设；
   禁止虚构监控指标、历史耗时、执行计划实测值。
2. 每个结论必须含六要素：问题现象 / 证据(文件路径+行号+推演依据) / 预期收益(量化) /
   成本与风险 / 回滚方式 / 验证方法。缺任一项视为无效。
3. 只针对仓库真实存在的表、字段、索引名。引用代码必须给相对路径与行号。不得虚构。
4. 不确定处标注「需要确认」，禁止用推测填空。
5. 范围纪律：只输出本次任务卡要求的内容。禁止提前输出其它轮次的内容，
   禁止复述上面「已确认事实」中的任何一条，禁止给出「后续建议」类泛泛总结。
6. 先给结论摘要（≤10 行），再给明细。
7. 回答用中文。
8. 上游输入占位：形如 <S3 摘要>、<索引清单> 的占位，若未被替换，
   且当前环境具备文件读取能力，请直接按占位旁标注的「来源」路径自行读取对应内容作为输入，
   不要停下来追问用户。若无法读取文件，则明确说明缺少哪一项上游输入。

---

# 上游结论摘要
来源：docs/db-optimization/notes.md →「## S1 容量建模」
<S1 摘要>

# 本轮输入：写路径盘点（文件:行号:内容）
来源：docs/db-optimization/inputs/02-write-paths.txt（替换下一行为该文件全文）
<写路径清单>

# 本轮任务
只做写热点行锁竞争与大表膨胀治理。不做索引审计、不做读查询优化。

1. 写热点识别：结合上面的写路径清单，找出高频 UPDATE 的热点行，重点关注
   ScanOrders 状态流转、SpaceSession 续费与自动结账、库存扣减、
   会员积分/余额变动、StoreSubAccount 配额扣减。给出并发写冲突的具体场景推演。
2. 逐表评估行锁竞争、死锁风险、事务内热点行持有时间，对照
   TX_TIMEOUT_SHORT/MEDIUM/LONG (5s/15s/30s) 判断是否存在长事务持锁风险。
3. 表膨胀评估：按档 B/C 写入量估算 HOT 更新比例、autovacuum 能否跟上，
   给出每张热点表的 autovacuum 参数覆盖建议。
4. 分区/冷热分离判定：针对 sale_order_items、scan_orders、member_points_log、
   marketing_consumption、audit_logs，逐表判定「档 B 必须做 / 档 C 再做 / 不需要」，
   给出分区键建议（注意时区 Asia/Shanghai、DB 会话为 UTC）与不做分区的替代方案。

# 禁止输出
- 索引增删建议
- 读路径查询优化
- 任何与写入无关的内容

# 交付格式
表 1：写热点表清单（表 / 热点操作 / 并发冲突场景 / 锁风险等级）
表 2：autovacuum 参数覆盖建议（表 / 参数 / 值 / 依据）
表 3：分区/冷热分离判定表（表 / 档位判定 / 分区键 / 替代方案 / 风险）
+ 【S4 摘要】

# 文件操作（本轮结束后执行）
把本轮输出的【S4 摘要】写入 docs/db-optimization/notes.md 中「## S4 写热点与大表治理」这一节的正文位置：
- 用「替换」语义覆盖该节原有的「（待填）」占位，禁止追加第二份
- 除该节外，不得改动该文件其它任何内容
- 写完直接结束，不要输出额外说明
若当前环境没有文件写入能力（如网页版对话），忽略本节，仅在对话中输出摘要即可。

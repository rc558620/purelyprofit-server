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

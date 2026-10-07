# DB 优化实施阶段交接摘要

> 用途：每轮 AI 输出末尾的【Ix 摘要】落到对应小节，下一轮只粘贴对应摘要，不粘贴完整报告。
> 写入方式：IDE Agent 会自动替换写入本文件（见各任务卡的「文件操作」指令）；网页版 AI 需手动复制粘贴。
> 纪律：每节只保留一份（I6 除外，按其卡内说明追加）；不要堆重复内容。
> 上游：分析阶段结论见 ../notes.md（S1~S9）。

## I1 仓库参数与进程配置
- 改动 3 文件：prisma.service.ts（池推导取 min 修复）、systemd service（CLUSTER_WORKERS=4 + --max-old-space-size=1024）、.env.example（参数注释与推荐值）。
- 前置校验结论：不沿用 S2 的 pgMax=120；推荐 pgMax=100（PG 默认值，无需改 postgresql.conf），workers=4，poolMax=20，poolMin=2；修复取 min 后每 worker poolMax=min(23,20)=20，总连接 4×20=80 < 100，余量 20 条。
- 池推导修复：resolveEffectivePoolMax 末尾 return autoPoolMax → return Math.min(autoPoolMax, configuredPoolMax)，warn 日志同步改用 effectivePoolMax。修复前 workers=2/pgMax=100 时每 worker 实际 48 连接（远超 poolMax=20 配置意图），修复后 min(48,20)=20。
- systemd：CLUSTER_WORKERS 2→4，ExecStart 加 --max-old-space-size=1024（4 worker × 1GB=4GB，配合 PG 3GB + Redis 1GB + OS 2GB ≈ 10GB < 16GB）。
- 校验：check-f0rest-rules 三文件 exit=0，pnpm run typecheck 通过。
- 回滚：git revert 三个文件；systemd 回滚后需 systemctl daemon-reload + restart。
- 遗留：实际 PG max_connections 需在上线前确认 postgresql.conf 未被改过（仍为默认 100）；CLUSTER_WORKERS=4 需在 production.env 中同步覆盖。

## I2 服务器 PG 配置
- 产出物为 postgresql.conf 片段 + ALTER SYSTEM 命令序列 + 逐表 autovacuum 覆盖，不往仓库写文件。
- `max_connections` 保持默认 100，与应用侧 `DATABASE_PG_MAX_CONNECTIONS=100` 对齐；应用 4×20=80 连接，余 20 给运维。
- 内存分配：`shared_buffers=3GB`（需重启）、`work_mem=8MB`、`maintenance_work_mem=512MB`、`effective_cache_size=10GB`；合计 PG 稳态 ~4G + Redis 1G + Node 4G + OS 2G = ~11G < 16G，峰值 ~12.5G，富余 ≥3.5G。
- autovacuum 全局：`max_workers=4`、`naptime=30s`、`vacuum_scale_factor=0.05`、`analyze_scale_factor=0.02`；逐表覆盖 5 张表（scan_orders 0.02/0.01/15s、marketing_customers 0.03/0.01/15s、space_sessions/audit_logs/idempotency_records 0.05/0.02）。
- WAL：`max_wal_size=4GB`、`min_wal_size=512MB`、`wal_buffers=16MB`（需重启）、`checkpoint_completion_target=0.9`。
- 日志：`log_min_duration_statement=80` 与应用 `APP_SLOW_QUERY_THRESHOLD_MS=80` 对齐，双层覆盖（PG 完整 SQL 文本 + 应用业务上下文）。
- 时区：`log_timezone=UTC`、`timezone=UTC`，与应用会话时区钉死 UTC（prisma.service.ts:100-109）保持一致。
- 观测：`shared_preload_libraries=pg_stat_statements`（需重启）、`track_io_timing=on`；部署后执行 `CREATE EXTENSION pg_stat_statements`。
- 需重启参数 3 项：`shared_buffers`、`wal_buffers`、`shared_preload_libraries`；其余均可 `ALTER SYSTEM` + `pg_reload_conf()` 生效。
- 回滚：逐项 `ALTER SYSTEM RESET <param>` + `ALTER TABLE ... RESET (...)` + 重启 PG。
- 遗留：实际上线前需确认 postgresql.conf 未被改过（仍为默认 100）；pg_stat_statements 扩展需重启后手动 CREATE EXTENSION。

## I3 分区决策
推荐路线 B（归档冷热分离），不选路线 A（分区）也不选路线 C（仅清理）。
- 依据：Prisma 7.8 不支持原生声明式分区，`@id`→`@@id([id,createdAt])` 会破坏 Prisma Client 类型且 `migrate diff` 持续 drift；两张表均为纯追加叶子表（0 处 findUnique/update/delete、无 FK 被引用），归档零代码改动零 Prisma 风险；DELETE 不回收物理空间故路线 C 对 sale_order_items 不可行。
- sale_order_items 保留 6 个月热数据（~5500 万行档B），audit_logs 保留 90 天（S7 已定）。
- 实施方式：新建 _archive 归档表 + BullMQ repeatable job 分批迁移（5000 行/批/事务），同库同 schema。
- 验证：COUNT 前后一致性 + EXPLAIN ANALYZE 性能对比。回滚：DROP 归档表 + 移除 BullMQ job。
- 待拍板：①热表保留窗口（6 vs 12 个月）；②归档表存储位置（同库同 schema 建议）；③是否需要历史查询路由；④档C前是否重新评估分区（跟踪 Prisma 对 PG 分区表支持进展）。

## I4 索引处置
- 冲突裁决：StorePartner [status,updatedAt] 和 StoreMembershipOrder [status,createdAt] 均裁决删除——跨门店查询（dashboard-home.query.ts:198-258, dashboard-revenue-detail.service.ts:93-124, membership-ledger.service.ts:161, growth-admin.query.ts:123）表规模档B <1.5k/<12k 行，[storeId,status,...] 复合索引覆盖带 storeId 路径，裸跨门店索引选择度极低写放大无收益。
- 冗余删除 11 条（S3 的 9 条 + 冲突裁决 2 条）：ScanOrderingArea/Type [storeId] 被 @@unique 覆盖；ScanOrderingTable [storeId] 被 [storeId,status] 覆盖；ScanOrders [storeId] 被多条覆盖；SelfOrder/PrintAgent [storeId] 被 @@unique 覆盖；ScanOrderingPickupSequence [storeId,businessDate] 与 @@unique 完全重复；ScanOrders [paymentExpiresAt] 全量被 partial idx_scan_orders_payment_expiry 覆盖（查询恒带 paymentStatus=unpaid+deletedAt=null，scan-ordering-payment-expiration.service.ts:57-66）；ScanOrderingTableQrCode [tokenHash] 全量被 partial idx_qr_token_hash_active 覆盖（查询恒带 status=active，club-scan-ordering.service.ts:64-68）。
- partialIndex 改造 22 条：Member 3、MarketingCustomer 5、Product 3、ProductCategory 2、Space 4、Employee 4、CommissionService 1，全部加 WHERE deleted_at IS NULL 条件。每条 = CREATE partial CONCURRENTLY + DROP 全量 CONCURRENTLY 两步迁移。
- 改动文件：8 个 prisma schema + 2 个 migration 目录（20261014100000_dispose_redundant_indexes + 20261014110000_convert_partial_indexes），每个附 migration_rollback.sql。
- 校验：check-f0rest-rules 全部 exit=0，pnpm run typecheck 通过。
- 回滚：migration 回滚执行 migration_rollback.sql（反向 CREATE/DROP）；schema 回滚 git revert 8 个 prisma 文件。
- 遗留：上线需低峰期执行（CONCURRENTLY 不锁表但消耗 I/O）；S3 标记的 6 条低效索引中 Member [phone]、PartnerWithdrawal [status,appliedAt]、Store [name]/[contactName]、StoreSubscription [status] 不在本批范围。

## I5 索引新增
- 新增 3 条 partial 索引，来源 S8-operations/finance/staff 三节缺失索引条。
- ① sale_order_items [storeId, orderId] partial WHERE product_name NOT IN ('预付抵扣','预付款','续费抵扣')——覆盖 business-analysis 4 条 raw SQL 从 soi 侧 store_id + product_name NOT IN 过滤路径（business-analysis.query.ts:169-221）；aggregateOrderStats 驱动表为 sale_orders 走 [orderId, createdAt] 索引，本索引为补充覆盖。
- ② finance_account_records [storeId, remaining] partial WHERE remaining > 0——覆盖派生开户状态查询 overdue/partial/pending（finance-account.query.ts:53-95），代码已改为派生状态不走 DB status 列。
- ③ cost_records [storeId, sourceType, payrollId] partial WHERE payroll_id IS NOT NULL——重建 20261007100000 被 DROP 的 cost_records_store_source_payroll_unique，非 unique（唯一性由应用层 upsertPayrollCostRecord 保证），覆盖 costs-write.service.ts:294-300 findFirst 查询。
- 改动文件：3 个 prisma schema（sales-records.prisma / accounts.prisma / costs.prisma）+ 1 个 migration 目录（20261015100000_add_indexes_for_s8 含 migration.sql + migration_rollback.sql）。
- 源码核对差异：索引①摘要描述为覆盖 aggregateOrderStats + business-analysis，实际核对发现 aggregateOrderStats 驱动表为 sale_orders、items 侧走 [orderId, createdAt] 索引，本索引主要覆盖 business-analysis 4 条从 soi 侧过滤的查询；索引③原被 DROP 名为 cost_records_store_source_payroll_unique（unique），重建为非 unique 普通索引。
- 校验：check-f0rest-rules 5 文件全 exit=0，pnpm run typecheck 通过。
- 回滚：执行 migration_rollback.sql（3 条 DROP INDEX CONCURRENTLY）；schema 回滚 git revert 3 个 prisma 文件。
- 遗留：上线需低峰期执行（CONCURRENTLY 不锁表但消耗 I/O）；无代码改写、无数据变更、无灰度需求。

## I6 代码改写
### I6-Round1（A 组：低风险，不涉金额）
- 改动 3 文件 + 补充 2 spec：handover-records-revenue.service.ts（合并重复 findMany + 新增 countRecordRevenueBatch）、handover-records-detail.service.ts（buildRecordSummaryBatch 改批量调用）、employees-snapshot-sync.service.ts（syncPayrollCostTitles 改 $executeRaw 批量 UPDATE...CASE WHEN）。
- 项① handover buildRecordRevenueDetail：两次 saleOrderItem.findMany（where/select 完全相同，仅 orderBy/take 不同）合并为一次带 orderBy 全量查询 + 内存 slice(0, ORDER_ITEMS_LIMIT)，DB 往返 2→1。paymentOrderItems=全量做支付聚合，orderItems=前 999 条做展示，语义完全等价。
- 项② handover buildRecordSummaryBatch：原 mapConcurrent 逐条调 countRecordRevenue（3N 次 Prisma aggregate），改为新增 countRecordRevenueBatch 方法用 3 次 raw SQL（UNNEST + LEFT JOIN LATERAL）一次性下推 N 个 shiftRange，DB 往返 3N→3。口径与 countRecordRevenue 完全一致：additionalRevenue + spaceRevenue(timeCost+itemsCost) + scanOrderingRevenue，退款不扣减。
- 项③ staff syncPayrollCostTitles：原 Promise.all(N 次 costRecord.update) 改为单条 $executeRaw UPDATE...CASE WHEN...END WHERE id IN (...)，用 Prisma.sql + Prisma.join 参数化防注入，DB 往返 N→1。内存计算 title 替换逻辑不变。
- 校验：check-f0rest-rules 5 文件全 exit=0（仅 handover-records-revenue.service.ts 469 行超 400 提醒），pnpm run typecheck 通过，jest 44 passed（原 40 + 新增 4）。
- 数值一致性验证方法：①项①选 3 门店 × 2 交班记录对比改前改后 revenueSummary + paymentItems JSON 完全一致；②项②选 3 门店 × 5+ 条交班记录列表页对比每条 totalRevenue 完全一致，重点验证含扫码点餐+空间会话的班次；③项③选 2 有工资单员工变更 name 对比 cost_records.title 替换结果完全一致，重点验证含正则特殊字符的名字。
- 回滚：git revert 5 个文件；countRecordRevenueBatch 为纯新增方法回滚安全。
- 遗留：handover-records-revenue.service.ts 469 行超 400 行建议，后续可拆分 countRecordRevenueBatch 到独立 service；raw SQL 中 SpaceSessionStatus.settled 用 ::text 强转需确认 PG enum 类型映射。

### I6-Round2（B 组：含金额聚合改写）
- 改动 7 文件：sales-record.query.ts（aggregateOrderStats 改 CTE 预聚合）、finance-cash-flow.query.ts（queryCashFlowStatsRows 改 groupBy）、finance-cash-flow.domain.ts（buildCashFlowBaseStats 改聚合入参）、finance-cash-flow.service.ts（无代码改动，类型自动适配）、finance-cash-flow.service.spec.ts（mock 从 findMany 改 groupBy）、finance.spec-helpers.ts（prisma mock 加 groupBy）、marketing.query.ts（queryCustomerRowById 改 LATERAL 子查询）。
- 项① aggregateOrderStats（P0）：原三表 JOIN + SUM(DISTINCT sor.amount/profit) 改为 WITH soi_agg（按 order_id 聚合 sale_order_items）+ sor_agg（按 sale_order_id 聚合 sale_order_refunds）CTE 预聚合，消除 DISTINCT 语义风险（相同金额退款行被错误去重）+ 消除三表笛卡尔积。product_name NOT IN 过滤从主查询移入 soi_agg CTE。order_count 从 COUNT(DISTINCT so.id) FILTER 改为 COUNT(*) FILTER（CTE 预聚合后每 order 最多 1 行 sor_agg，不再需要 DISTINCT）。DB 往返不变（1 次），但消除 SUM(DISTINCT) 排序开销。被 3 处调用（SalesRecordStatsService、SalesRecordListService、SpaceDashboardSummaryService）。
- 项② queryCashFlowStatsRows（P1，涉金额）：原 findMany 全量拉取 direction+amount 到内存遍历累加，改为 groupBy({ by: ['direction'], _sum: { amount }, _count: { _all } })，只返回 ≤2 行聚合结果。新增 FinanceCashFlowStatsAggregate 类型（direction/totalAmount/rowCount），buildCashFlowBaseStats 从 aggregates 取 totalAmount 累加 + rowCount 求和。DB→App 传输量从 N 行降到 ≤2 行。
- 项③ queryCustomerRowById（P1）：原 LEFT JOIN users ON (3 路 OR + 字符串拼接) 无法走 users @unique 索引，改为 LEFT JOIN LATERAL 子查询（WHERE + ORDER BY CASE + LIMIT 1），PG 优化器可对 OR 分支独立走索引扫描 + 早期终止。avatar 优先级不变：wechat_phone > club email > legacy email。
- 校验：check-f0rest-rules 7 文件全 exit=0（marketing.query.ts 414 行超 400 仅提醒），pnpm run typecheck 通过，pnpm run test 2847 passed / 5 failed（3 suite 失败均为 I6-Round1/I7 遗留：handover $queryRaw mock 缺失 + cache-invalidator I7 扩展，非本批引入），本批涉及的 finance-cash-flow.service.spec 8 passed + sales-record/space-dashboard 85 passed。
- 数值一致性验证方法：①项①选 3 门店 × 3 周期（日/周/月）对比改前改后 totalRevenue/totalProfit/orderCount 完全一致，重点验证含退款的门店/周期；②项②选 3 门店 × 2 周期（month/year）对比改前改后 totalIncome/totalExpense/netFlow/recordCount 完全一致，重点验证 income/expense 仅一侧有数据时 groupBy 返回 1 行的正确处理；③项③选 5 顾客（含 wechat_phone 匹配 / club email 匹配 / legacy email 匹配 / 无匹配 / 多路径匹配）对比改前改后 avatar 选择结果完全一致。
- 回滚：git revert 7 个文件；无 schema 变更无 migration 无数据变更。
- 遗留：aggregateOrderStats CTE 中 sale_order_refunds 当前为 1:1（saleOrderId @unique），若未来改 1:N 则 sor_agg 的 SUM 聚合天然兼容；queryCustomerRowById LATERAL 子查询仍含 OR，依赖 PG 优化器对 LATERAL + LIMIT 1 的索引扫描优化，若 users 表超 30 万行仍退化则需拆 UNION ALL 三段。

## I7 缓存与清理
- 改动 14 文件：club-cache-keys.ts（新增）+ keys/index.ts + cache-keys.ts（导出）+ club-scan-ordering-menu-query.service.ts（getMenu 30s）+ club-member-profile.service.ts（getSnapshotByStoreIdentity 15s）+ club-promotion.repository.ts（loadActivePromotions 60s）+ cache-invalidator-marketing-customer.provider.ts（扩展 delByPattern club:member-snapshot）+ cache-invalidator-marketing-overview.provider.ts（扩展 del club:promotions）+ club-member.module.ts（加 RedisModule）+ retention-cleanup.service.ts（新增）+ retention-cleanup.processor.ts（新增）+ queue.module.ts（注册队列+provider）+ queue-scheduler.service.ts（注册 repeatable job）+ club-member.service.spec.ts（补 RedisService mock）。
- 缓存接入：getMenu key=club:menu:store:{storeId}:v:{menuVersion}（轻量查 id+version 算 hash → 查缓存 → 未命中查完整 categories），30s TTL，不挂 invalidator（menuVersion 变更自动换 key）；getSnapshotByStoreIdentity key=club:member-snapshot:store:{storeId}:user:{userId}，15s TTL，null 缓存 5s 防穿透（getJson+exists 二次确认区分 null 哨兵与 miss）；loadActivePromotions key=club:promotions:store:{storeId}，60s TTL，空数组同 TTL。失效复用 invalidateMarketingCustomerDerived（+delByPattern club:member-snapshot）与 invalidateMarketingOverview（+del club:promotions），不新增 provider。三个 key 均不进 prewarm-cycle。穿透/击穿：menuVersion content-hash 无穿透风险；snapshot null 短 TTL 防穿透；promotions 空数组同 TTL；均不做并发重建（TTL 短、单次查询 <10ms）。
- 清理任务：retention-cleanup 队列 + processor（concurrency=1），idempotency_records 每 6h 单条 DELETE WHERE expires_at < NOW() - INTERVAL '7 days'；audit_logs 每 24h 分批 DELETE（batchSize=5000、sleep 100ms、id 游标推进），保留 90 天。多 worker 由 BullMQ BLPOP 抢占保证单实例执行。观测日志关键字 [retention-cleanup]。
- 校验：check-f0rest-rules 14 文件全 exit=0（spec 文件仅行数提醒），pnpm run typecheck 通过。
- 回滚：git revert 14 文件；BullMQ repeatable job 需手动 queue.removeRepeatableByKey('retention-cleanup-idempotency') 与 ('retention-cleanup-audit-logs') 清除 Redis 调度元数据；缓存 key 自然过期无残留。
- 遗留：getMenu 缓存命中时仍有一次轻量 versionRows 查询（select id+version），档B <1ms 可接受；audit_logs 分批 DELETE 不回收物理空间（需 VACUUM），档B 表规模小可接受。

## I8 压测与上线
- 产出 5 文件：scripts/seed-loadtest-stores.mjs（500 门店+商品+员工）、seed-loadtest-members.mjs（25 万会员）、seed-loadtest-orders.mjs（600 万 sale_order_items/30 天）、seed-loadtest-finance.mjs（45 万 finance_cash_flow_records/30 天）、scripts/loadtest-k6.js（8 场景 k6 脚本）。
- seed 脚本统一风格：NODE_ENV=production 保护、dry-run（--yes 确认）、--cleanup 清理、幂等标记（name 前缀/phone 前缀/note='loadtest'）、分批 raw SQL INSERT、进度输出。与仓库既有 seed-*.mjs 风格一致（loadEnvFile + PrismaPg + pg.Pool）。
- k6 脚本覆盖 S9 的 8 场景：S1 销售记录列表(B ~8)、S2 经营分析(B ~5)、S3 利润详情(B ~5)、S4 扫码菜单(C ~15)、S5 会员快照(C ~15)、S6 订单列表(C ~10)、S7 Pulse dashboard(B ~1)、S8 混合峰值(~115，C 70%/B 30%)；档位 A/B 可切换（LOADTEST_TIER）；达标线 P95≤300ms / P99≤500ms / 错误率<0.1%；thresholds 内嵌。
- 上线 4 批执行清单（以 I1~I7/I9 实际落地为准重新编号）：批1 参数(I1 池推导取 min+systemd workers=4+max-old-space-size=1024 / I2 PG 参数 shared_buffers=3GB 等 3 项重启+autovacuum 逐表覆盖)→批2 索引(I4 冗余删除 11 条+partial 改造 22 条 / I5 新增 3 条 / I9 归档表建表)→批3 代码(I6-R1 handover 批量化+staff 批量 UPDATE / I6-R2 CTE 预聚合+groupBy 聚合+LATERAL 子查询)→批4 缓存+清理+归档(I7 club 3 key+retention-cleanup 队列 / I9 sale_order_items 归档队列)。
- 前置条件：批1 停服前确认 PG 连接<50；批2 低峰 IOPS await<20ms；批3 逐项数值一致性抽样（handover totalRevenue / aggregateOrderStats totalRevenue+totalProfit+orderCount / cashFlow totalIncome+totalExpense+netFlow / marketing avatar 选择）；批4 workers=1 灰度 1 周后全量。
- 回滚：批1 git revert 3 文件+systemctl daemon-reload+PG ALTER SYSTEM RESET；批2 执行 4 个 migration_rollback.sql+git revert prisma schema；批3 git revert 代码文件无 schema 变更；批4 git revert 14 文件+queue.removeRepeatableByKey 清 Redis 调度元数据+归档表 DROP。
- 上线后 7 天观测：3 项 P0 告警（PG 连接>100 / PoolTimeout / 慢 SQL P95>300ms 立即处置）+9 项 P1 指标（慢请求 800ms / 锁等待>5 / IOPS await>20ms / 缓存命中率<80% / Redis 内存>900MB / Node 内存>800MB/worker / retention-cleanup 未按期 / 归档未按期 / autovacuum 死元组>5000）。
- 校验：check-f0rest-rules 5 文件结果与仓库既有 scripts/seed-*.mjs 一致（Rule 6 process.env + Rule 7 .catch() 对所有 scripts/*.mjs 均报，非本批引入）；pnpm run typecheck 通过。
- 遗留：压测需在 I1~I7/I9 全部部署后执行；k6 需用户自行安装（不引入为项目依赖）；seed 脚本造数据耗时较长（600 万行约 30~60min），建议在 CI 或独立环境执行。

## I9 归档任务
- 改动 8 文件：migration.sql + migration_rollback.sql（新建归档表）+ configuration.ts（4 配置项）+ .env.example（4 环境变量）+ sale-order-items-archive.service.ts（归档逻辑）+ sale-order-items-archive.processor.ts（BullMQ processor）+ queue.module.ts（注册队列+provider）+ queue-scheduler.service.ts（注册 repeatable job）。
- 与 I7 关系：**独立队列** `sale-order-items-archive`，不复用 `retention-cleanup`。理由：语义不同（归档保留数据 vs cleanup 丢弃）、频率/故障隔离、BullMQ 各自独立 worker。I7 已建 retention-cleanup（idempotency 每 6h / audit_logs 每 24h），本批新建 sale-order-items-archive（每 24h），无重复。
- 归档表 `sale_order_items_archive`：结构与源表完全一致，无 FK 无 unique，仅 1 条索引 [store_id, created_at]。不声明为 Prisma model，通过 raw SQL 读写，避免 Prisma Client 污染与 migrate diff drift。
- 归档策略：每 24h 分批迁移（5000 行/批/事务），按 id 升序游标推进，INSERT→SELECT + DELETE 同一事务保证原子性；幂等（事务回滚则重跑）、断点续传（id 游标）、集群安全（BullMQ concurrency=1）；批间 sleep 100ms，单次任务最多 200 批（100 万行）。保留窗口默认 180 天（6 个月），走 ConfigService 可配置。
- I3 四项待拍板推荐值：①保留 6 个月（需确认）②同库同 schema（需确认）③不需要历史查询路由（需确认）④档C前重新评估分区（需确认）。
- 校验：check-f0rest-rules 8 文件全 exit=0（configuration.ts 仅行数提醒），pnpm run typecheck 通过。pnpm run test：2847 passed / 5 failed（3 suite 失败均为 I6/I7 前序轮次遗留，非本批引入）。
- 回滚：①queue.removeRepeatableByKey('sale-order-items-archive-cycle') 清 Redis 调度 → ②执行 migration_rollback.sql DROP 归档表 → ③git revert 代码文件。归档表中数据会随 DROP TABLE 丢失，回滚前需确认或备份。
- 遗留：上线需先执行 migration 建归档表；首次执行时若已有 6 个月以上数据会触发大批量迁移（单次最多 100 万行/200 批，约需 20s），建议低峰期首次启用；后续每 24h 增量迁移。

## I10 仓库收尾
- 改动 2 文件：configuration.ts（保留窗口默认值 180→365 + 注释补充归档表长期存储说明）、.env.example（RETENTION_DAYS=365 + 注释补充保留窗口语义与归档表增长提醒）。
- I3 四项拍板结果落地：①热表保留窗口 12 个月（365 天）→ 已改；②归档表同库同 schema → 无需改动；③历史查询路由不做 → 无需改动；④档C前重新评估分区 → 设触发条件不设时间点，写入文档无需改动。
- 校验：check-f0rest-rules 2 文件 exit=0（configuration.ts 仅行数提醒），pnpm run typecheck 通过，pnpm run test 290 套件 / 2852 用例全绿（19.584s）。
- Git 提交 6 个 commit：①I1 参数与进程配置（4 文件）→ ②I4+I5 索引治理（18 文件含 3 迁移）→ ③I6 代码改写（13 文件）→ ④I7+I9+I10 缓存清理归档（19 文件含 1 迁移）→ ⑤I8 压测脚本（6 文件）→ ⑥文档（56 文件）。
- 未跟踪目录 .tmp-backup/（含 1.1MB 数据库 dump）未提交，建议加入 .gitignore。
- 回滚：git revert 6 个 commit；configuration.ts 与 .env.example 可手动将 365 改回 180。
- 遗留：无。本批为 I 系列收尾，后续按 I11 服务器执行手册上线。

## I11 服务器执行手册
- 产出物为 `docs/db-optimization/上线操作手册.md`（1470 行），覆盖第 0~8 步 + 附录 A 全量回滚 + 附录 B 速查表，不含业务代码改动。
- 第 0 步前置确认 8 项（PG 版本/max_connections/磁盘/连接数/长事务/systemd 文件/production.env CLUSTER_WORKERS/migrate status），全部标为待用户确认。
- 第 1 步 PG 参数：1.1 热加载 14 项（work_mem/maintenance_work_mem/effective_cache_size/autovacuum 4 项/WAL 3 项/log/timezone/track_io_timing）→ 1.2 写入需重启 3 项（shared_buffers=3GB/wal_buffers=16MB/shared_preload_libraries=pg_stat_statements）→ 1.3 停应用→重启 PG→验证 pending_restart=f。
- 第 2 步逐表 autovacuum 覆盖 5 张表（scan_orders 0.02/0.01/0.05、marketing_customers 0.03/0.01/0.05、space_sessions 0.05/0.02、audit_logs 0.05/0.02/0.05、idempotency_records 0.05/0.02/0.05），ALTER TABLE SET 生效。
- 第 3 步 CREATE EXTENSION pg_stat_statements，验证 installed_version 有值。
- 第 4 步 systemd 同步（CLUSTER_WORKERS=4 + --max-old-space-size=1024）→ daemon-reload → 启动应用，验证日志 `[cluster] spawning 4 worker(s)` + `[prisma] workers=4 × poolMax=20 = 80` + 3 队列 registered。
- 第 5 步 prisma migrate deploy 执行 4 个迁移（20261014100000/20261014110000/20261015100000/20261016100000），验证冗余索引 0 行/partial 22 行/S8 索引 3 行/归档表 1 行；附逐个回滚方法。
- 第 6 步归档任务首次启用观察日志 `[sale-order-items-archive] completed totalArchived=X`，无生产数据首次迁移量=0；附超时处置与回滚。
- 第 7 步 7 天观测 3 项 P0（连接>100/PoolTimeout/慢SQL P95>300ms）+ 9 项 P1（慢请求800ms/锁等待>5/IOPS await>20ms/缓存命中率<80%/Redis>900MB/Node>800MB/worker/retention-cleanup未按期/归档未按期/dead tuple>5000），每项含采集命令。
- 第 8 步压测 4 seed 脚本 + k6 执行顺序、数据量、耗时、达标线 P95≤300ms/P99≤500ms/错误率<0.1%。
- 上游矛盾：I9 代码默认保留 365 天 vs I3 推荐 180 天，手册以代码默认值 365 天为准，标注待用户确认。

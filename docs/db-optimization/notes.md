# DB 优化交接摘要

> 用途：每轮 AI 输出末尾的 `【S{n} 摘要】` 落到对应小节，下一轮只粘贴对应摘要，不粘贴完整报告。
> 写入方式：IDE Agent 会自动替换写入本文件（见各任务卡的「文件操作」指令）；网页版 AI 需手动复制粘贴。
> 纪律：摘要不超过 15 行，只保留新增结论与对下游的硬约束；每节只保留一份，不要追加重复内容。

## S1 容量建模
- A 档（100 店/25 QPS）[H1,H3,H8]：全部维度充裕，无瓶颈。总连接 96 < PG max 100（现状 workers=2），连接需求 ≤ 3 [H7]。
- B 档（500 店/115 QPS）[H1,H3]：连接池安全（需求 12 < 96 [H7]）；sale_order_items 年增 1.095 亿行（~33GB 含索引 [H4,H9]），大表膨胀 6 个月内显现；缓存预热 batchSize=30/concurrency=4 对 500 店 5,000 key/周期 [H12] 满载无余量。
- C 档（2000 店/450 QPS）[H1,H3]：8 核 16G 单机首要瓶颈为 CPU/内存共占 [H6,H14,H15]；连接池临界（需求 45 vs 单 worker poolMax=48 [H7,H8]）；定时任务堆积（预热 20,000 key 需 60s > 15s 周期 [H12]）。需拆分 PG 独立部署。
- 池公式（prisma.service.ts:48-61）在 workers=2/pgMax=100 下不超额（96<100 [H8]），但函数不与 configuredPoolMax 取 min——pgMax 调大时 autoPoolMax 会远超 DATABASE_POOL_MAX=20 配置意图。
- 缺失信息 8 项影响下游：PG 参数→S2/S4；读写比→S1/S4/S5；SQL/请求→S1/S5/S6；Node 内存→S2；Redis maxmemory→S1/S2；磁盘 IOPS→S4/S9；C 端请求模式→S1 全量；架构规划→S1/S2。
- 下游硬约束：B 档起 sale_order_items 和 audit_logs 需分区或归档策略；C 档起需拆分 PG 独立机器 + PgBouncer；缓存预热 batchSize 和 concurrency 需随门店数线性扩展。

## S2 服务器 / PG 参数基线
- 推荐组合（同机）：CLUSTER_WORKERS=4、DATABASE_PG_MAX_CONNECTIONS=120、DATABASE_POOL_MIN=2；推导后每 worker poolMax=28，总连接 112，余量 8 条给运维/迁移。
- PG 独立部署对照：CLUSTER_WORKERS=6~8、DATABASE_PG_MAX_CONNECTIONS=200、DATABASE_POOL_MIN=2；每 worker poolMax=23，总连接 184。
- 16G 内存分配：PG shared_buffers=3GB / work_mem=8MB / maintenance_work_mem=512MB / effective_cache_size=10GB；Redis maxmemory=1GB + allkeys-lru；4 workers × --max-old-space-size=1024=4GB；OS+Nginx≈2GB；稳态≈10.6G，峰值≈12.5G，富余≥3.5G。
- systemd ExecStart 需加 --max-old-space-size=1024（现值未传，deploy/systemd/purelyprofit-server.service:18）。
- 池推导缺陷（prisma.service.ts:61 直接 return autoPoolMax 不取 min）：pgMax 调大时每 worker 池远超 DATABASE_POOL_MAX 配置意图。最小改造：return Math.min(autoPoolMax, configuredPoolMax)。
- PG 参数：log_min_duration_statement=80 与 APP_SLOW_QUERY_THRESHOLD_MS=80 对齐，PG 层兜底（完整 SQL 文本）+ 应用层主通道（业务上下文）；双层覆盖。
- autovacuum：max_workers=4、naptime=30s、vacuum_scale_factor=0.05、analyze_scale_factor=0.02；WAL：max_wal_size=4GB、min_wal_size=512MB、wal_buffers=16MB。
- 下游硬约束：CLUSTER_WORKERS 从 2 改 4 后总连接 112 < 120，S6 连接边界核算以此为准；Redis maxmemory=1GB 限制缓存预热 key 上限，S5/S8 需据此评估缓存命中率。

## S3 索引结构审计
- 冗余索引 9 条：ScanOrderingArea/Type `[storeId]` 被 `@@unique([storeId,name])` 覆盖；ScanOrderingTable `[storeId]` 被 `[storeId,status]` 覆盖；ScanOrders `[storeId]` 被 `[storeId,status]`/`[storeId,createdAt]` 覆盖；SelfOrder `[storeId]` 被 `@@unique([storeId,orderNo])` 覆盖；PrintAgent `[storeId]` 被 `@@unique([storeId,deviceId])` 覆盖；ScanOrderingPickupSequence `[storeId,businessDate]` 与 `@@unique([storeId,businessDate])` 完全重复；ScanOrders `[paymentExpiresAt]` 全量与 partial `idx_scan_orders_payment_expiry` 高度重叠（保留全量删 partial 或反之需确认查询是否含已删除行）；ScanOrderingTableQrCode `[tokenHash]` 全量与 partial `idx_qr_token_hash_active` 同理。
- 低效索引 6 条：Member `@@index([phone])` 裸单列跨门店查询（members.prisma:56，代码中 phone 查询均带 storeId 或 storeId IN，此索引选择度极低）；StorePartner `@@index([status,updatedAt])` 裸跨门店（partners.prisma:75，Pulse 管理端跨门店 approved 查询走 store 关联过滤，非此索引）；PartnerWithdrawal `@@index([status,appliedAt])` 裸跨门店（partners.prisma:84）；StoreMembershipOrder `@@index([status,createdAt])` 裸跨门店（platform-membership.prisma:89，查询均带 storeId）；Store `@@index([name])`/`@@index([contactName])` 全表无门店隔离（store-accounts.prisma:290-291，仅管理端搜索用，选择度差）；StoreSubscription `@@index([status])` 单列低选择度（store-accounts.prisma:292，status 仅 3 枚举值）。
- 可改 partialIndex 22 条（查询恒带 deletedAt IS NULL 的全量索引→partialIndex）：Member 3 条（members.prisma:53-55）、MarketingCustomer 5 条（customers.prisma:43-47，含 `[storeId,lastVisitAt]`）、Product 3 条（catalog.prisma:45-47）、ProductCategory 2 条（catalog.prisma:13-14）、Space 4 条（spaces.prisma:52-55）、Employee 4 条（employees.prisma:67-70）、CommissionService 1 条（commission.prisma:21，已有 deletedAt）。
- 写放大（档B）：sale_order_items 日增 30 万行 × 4 索引 = 日增 120 万次索引维护；scan_orders 日增 10 万行 × 14 索引 = 日增 140 万次；audit_logs 日增约 5 万行 × 3 索引。高写放大低收益索引：SaleOrderItem `[categoryName,createdAt]`、ScanOrders `[storeId,manualEntry]`。
- 处置汇总：建议保留 278 条 / 建议删除 9 条 / 建议改造 partialIndex 22 条。
- 下游硬约束：删除冗余索引需新增迁移（CONCURRENTLY DROP INDEX）；改造 partialIndex 需新建 partial + DROP 旧全量两步迁移；所有改造在档 B 写入量下可节省约 8% 索引维护开销。

## S4 写热点与大表治理
- 写热点 5 张表：ScanOrderingPickupSequence（单行 UPDATE...RETURNING 串行取餐号，门店级热点）、MarketingCustomer（余额扣减原子更新，同一顾客并发串行化）、ScanOrders（version 乐观锁无行锁等待）、ScanOrderingMenuProduct/SpecOption（version 乐观锁库存预留可重试）、SpaceSession（FOR UPDATE + Redis 双重互斥）。
- 死锁风险：退款事务（refund-balance.service.ts:40-236）先 scan_orders 后 marketing_customers；空间结算（settlement.service.ts:68-328）先 space_sessions 后 spaces 后 sale_orders。两路径锁序无直接交叉但共用 sale_orders 外键，需确认跨事务锁序反转。Stock 扣减无 FOR UPDATE，死锁风险低。
- 长事务持锁：SpaceSessionSettlementService TX_TIMEOUT_LONG=30s + 双 FOR UPDATE + 6 张表 15+ 往返，持锁可能逼近 30s；SpaceSessionRenewService TX_TIMEOUT_MEDIUM=15s 可控。
- 表膨胀：scan_orders 日增 10 万行，version +1 致 HOT 更新失败（14 索引多数不含 version），单行 3-5 次 UPDATE 产生 dead tuple；marketing_customers balance/points/totalSpent 高频 UPDATE + 14 索引致 HOT 率低；sale_order_items 纯 INSERT 无 UPDATE 膨胀低但年增 1.1 亿行需分区。
- autovacuum 覆盖：scan_orders 0.02/0.01、marketing_customers 0.03/0.01、space_sessions 0.05/0.02、audit_logs/idempotency_records 0.05/0.02。
- 分区判定：sale_order_items 档B必须（RANGE created_at 按月，DB 会话 UTC，查询层 AT TIME ZONE 转换）；audit_logs 档B必须（同上 + 保留 90 天归档）；scan_orders/marketing_consumption/marketing_points_records 档C再做。
- 下游硬约束：sale_order_items 分区后需 PG 17 分区裁剪 + storeId 前缀过滤；SpaceSessionSettlementService 长事务需评估拆分；ScanOrderingPickupSequence 档C仍安全（每店独立行）。

## S5 退化查询与 N+1
- P0 退化 7 条：business-analysis 4 条 raw SQL 对 sale_order_items 全表扫描（档B ~150万行/查询，date_trunc 对 so.date 做运算致索引失效）；profit-detail 翻页拉取 sale_order_items（年增1.1亿行，大 offset + 跨表 orderBy）；sales-record aggregateOrderStats 三表 JOIN + SUM(DISTINCT) 去重；handover buildRecordSummaryBatch 逐条 countRecordRevenue（20条×3查询=60次DB往返）。
- P1 退化 17 条：Pulse dashboard 5 条跨门店无 storeId 查询（user.count/findMany、storePartner.count 嵌套关联、storeMembershipOrder 全表 findMany/aggregate/groupBy）；marketing 4 条（queryCustomerRowById OR+拼接致 users 全表扫描、recharge/pointsRecord OFFSET 大分页+COUNT(*) OVER()、queryCustomerGiftBalanceCents 无 LIMIT 全量拉取）；operations 3 条（querySaleOrders 4层 include N+1 回表、handover buildRecordRevenueDetail 重复 findMany+5层 include、spaceDashboard 三重 _count 关联）；finance 1 条（findMany take:5000 无分页全量拉取）；staff 2 条（mapConcurrent 逐条 update + 逐条 costRecord.update N+1 写）；pulse 1 条（membership-admin 10次 raw SQL 全量聚合）。
- P2 退化 10 条：date_trunc 对 time 列做运算致索引失效 4 处（marketing-overview、finance daily/monthly trend）；DISTINCT ON 无匹配索引 1 处（space-dashboard lastSettled）；跨门店 customer_id 查询无 storeId 1 处；其余为无 LIMIT 全量拉取与低选择度扫描。
- 退化根因集中在三类：① sale_order_items 大表（年增1.1亿行）上的全量扫描与 date_trunc 函数运算致索引失效；② Pulse 平台端查询无 storeId 约束跨门店全表扫描；③ 交班页/利润详情逐条或翻页拉取全量数据在内存聚合。
- 下游硬约束：S6 需评估 sale_order_items 分区后 business-analysis/profit-detail 的 raw SQL 是否需改写分区裁剪条件；handover N+1 需评估批量 aggregate 可行性；Pulse 跨门店查询需评估是否加 storeId IN (...) 约束。

## S6 连接与事务边界
- 128 处 $transaction 全量审查：无事务内网络请求（微信支付/退款均在事务外调用），无 TX_TIMEOUT 超档位场景。
- 最高风险：`space-session-settlement.service.ts:68`（TX_TIMEOUT_LONG=30s，2×FOR UPDATE + 6 张表 15+ 次 DB 往返），档B正常 3-8s，极端并发逼近 30s。
- 次高风险：`scan-ordering-order-refund-balance.service.ts:40`（12+ 串行写，无显式 TX_TIMEOUT，默认 5s 可能不足）、`club-scan-ordering-checkout.service.ts:176`（10+ 串行写，无显式 TX_TIMEOUT，默认 5s 可能不足）。
- TX_TIMEOUT 覆盖率不足：128 处仅 ~20 处显式设定 timeout，其余用 Prisma 默认 5s；5+ 表写操作应显式设定 TX_TIMEOUT_MEDIUM。
- 连接池饥饿推演（S2 参数 4×28=112）：档B 115 QPS 稳态占用 ~29 连接无风险；极端 4 并发结算 + 3 退款 + 正常约 42 连接仍安全。真正风险在 prisma.service.ts:61 poolMax 不取 min 缺陷。
- 可合并串行查询 7 处：退款事务内 findUnique 可与开头并行（-2~3 往返）、空间结算 FOR UPDATE+findUnique 合并（-2 往返）、sessionItems/renewRecords 可 Promise.all（-1 往返）。
- 预警信号 10 项：核心 3 个为 `PoolTimeout`/`connection timeout` 日志、`pg_stat_activity` active > 80、`pg_locks` NOT granted > 5。

## S7 幂等与审计表增长
- IdempotencyRecord 三写入点：profit:manual-entry:create（商家录入）、club:scan-order:create（C端扫码点餐）、club:self-order:create（C端自助下单），TTL=24h，写入频率上限=订单创建 QPS；读取频率=每次写入前 1 次 findUnique + 撞键回放 1 次 findUnique。
- AuditLog 七写入点：password.change/reset（低频）、login.fail.lock（低频）、custody 存入/取出/作废/配置更新（中频）、club.custody 同类（中频），fire-and-forget 模式，写入频率上限远低于订单 QPS。
- 年增长推演（档B）：idempotency_records ~365万行/~1.1GB、audit_logs ~73万行/~511MB；档C：idempotency_records ~1460万行/~4.4GB、audit_logs ~292万行/~2GB。纯追加无 UPDATE，膨胀风险低但索引持续增长。
- 清理策略：idempotency_records 保留 7 天（expiresAt+1天安全余量），BullMQ repeatable job 每 6h 执行 DELETE WHERE expires_at < NOW()；audit_logs 保留 90 天，同 BullMQ 每 24h 执行分批 DELETE WHERE created_at < NOW() - INTERVAL '90 days'。集成点：src/queue/queue.module.ts 新增 'retention-cleanup' 队列 + queue-scheduler.service.ts 注册 repeatable job。
- 档B需清理策略的无界增长表（共12张）：idempotency_records、audit_logs、scan_order_status_histories、scan_order_balance_transactions、scan_order_payment_attempts、self_order_balance_transactions、self_order_payment_attempts、member_points_logs、member_bean_logs、store_partner_bean_logs、store_membership_points_logs、marketing_points_records；档C追加：sale_order_items、scan_orders、marketing_consumptions、marketing_recharges、finance_cash_flow_records、inventory_adjustment_logs、commission_records、space_session_items。

## S8 模块级优化
### S8-operations
- 读写量（档B）：sale_order_items 日增 3万行/年增 1.1亿行、scan_orders 日增 4千行、space_sessions 日增 1.2千行、cost_records 日增 1.2千行。读峰值 ~8 QPS、写峰值 ~35 QPS。档C sale_order_items 年增 4.4亿行需分区（S4 已标记）。
- 退化查询 7 条（S5-P0×4 + P1×3）：①business-analysis 4 条 raw SQL 全表扫描 + date_trunc 致索引失效（business-analysis.query.ts:138-264），已命中缓存 TTL 120s/refresh 30s，暂不改写 SQL；②profit-detail 翻页拉取 sale_order_items（profit-detail.query.ts:70-96），已命中缓存 TTL 120s/refresh 30s，暂不改；③aggregateOrderStats SUM(DISTINCT) 三表 JOIN（sales-record.query.ts:44-57），改写为子查询预聚合消除 DISTINCT 语义错误；④querySaleOrders 4 层 include（sales-record.query.ts:91-154），Prisma include 不产生 N+1，深层 include 不可拆除，暂不动；⑤handover buildRecordRevenueDetail 重复 findMany + 5 层 include（handover-records-revenue.service.ts:99-116），合并重复查询 -1 往返；⑥handover buildRecordSummaryBatch 20×3=60 次 DB 往返（handover-records-detail.service.ts:82-108），改为批量 aggregate 降至 3 次；⑦spaceDashboard DISTINCT ON 无匹配索引（space-dashboard.service.ts:203-210），档B <10ms 暂不动，档C前评估新增 [spaceId, endTime] partial 索引。
- 缺失索引 1 条：sale_order_items [storeId, orderId] partial WHERE product_name NOT IN ('预付抵扣','预付款','续费抵扣')——覆盖 aggregateOrderStats + business-analysis 4 条 raw SQL 的 JOIN + 排除条件过滤。CONCURRENTLY 创建无锁表。回滚 DROP INDEX CONCURRENTLY。
- 缓存策略：sales-stats 60s/15s、sales-report 60s/15s、business-analysis 120s/30s、profit-detail 120s/30s、costs 60-120s/15-30s 均已入缓存。business-analysis/profit-detail/costs 已注册 prewarm-cycle 随 15s 周期续期。spaceDashboard/handover 不入缓存（实时性 + 单店数据量小）。无新增缓存需求。失效挂 invalidateSalesReadCaches/invalidateBusinessAnalysis/invalidateProfitDetail/invalidateCostsCaches（cache-invalidator-profit-read.providers.ts:29-37）。
- 迁移脚本 1 个：sale_order_items partial index [storeId, orderId] WHERE product_name NOT IN (...)。上线顺序：①迁移（CONCURRENTLY 无锁）→ ②aggregateOrderStats 改子查询预聚合（验证数值一致）→ ③handover 合并重复 findMany + 批量化 countRecordRevenue（验证交班数值一致）→ ④date_trunc/DISTINCT ON 暂不动档C前评估。
- 与S3/S4/S5无冲突。S3标记 sale_order_items [categoryName, createdAt] 低效索引属S3改造范围；S4 sale_order_items 分区需求不受本轮 partial 索引影响；S5 "querySaleOrders 4层 include N+1" 经核实 Prisma include 不产生 N+1，修正为深层 include 序列化开销。
### S8-member
- 读写量（档B）：members 稳态 ~25万行（500店×500会员）、member_points_logs 年增 ~183万行（500店×10条/日）、member_bean_logs 年增 ~91万行（500店×5条/日）、member_recharge_logs 年增 ~12万行（500店×0.67条/日）、store_partners ~1500行、store_membership_orders ~12.2k行、store_membership_promo_records ~6.1万行、store_partner_bean_logs 年增 ~3万行。读峰值 ~3 QPS、写峰值 ~23 QPS。档C最大表 member_points_logs 年增 ~730万行，档C前评估分区。
- 退化查询 1 条（S5-P1）：Pulse dashboard loadPulseHomeRawData 中 7 个 member 表跨门店无 storeId 查询（dashboard-home.query.ts:198-259，storePartner.count ×3 + storePartnerApplication.count + storeMembershipOrder.findMany + storeMembershipPromoRecord.aggregate + storeMembershipOrder.groupBy），已被 Pulse dashboard 缓存 TTL 30s 覆盖，档B表规模 <6.1万行全表 count/aggregate <10ms，暂不改动。S5-P1 "pulse 1条 membership-admin 10次 raw SQL" 对应 membership-admin-sales-stats.service.ts 查询 sale_orders 表，属 operations 模块不在本轮范围。
- 缺失索引：本轮不新增。S3 标记 Member 3 条 partialIndex 改造（members.prisma:53-55）属 S3 范围。与 S3 冲突点：StoreMembershipOrder @@index([status, createdAt])（platform-membership.prisma:63）被 S3 标记低效但 Pulse dashboard findMany/groupBy 依赖此索引做范围扫描，删除前需确认替代方案。StorePartner @@index([status, updatedAt])（partners.prisma:29）同理被 Pulse dashboard storePartner.count 依赖。
- 缓存策略：商家端 5 类查询已入缓存（list 90s/20s、meta 300s/60s、overview 120s/30s、snapshots 120s/30s），prewarm 已注册 membersMetaCachePrewarmProvider + membersOverviewCachePrewarmProvider 随 15s 周期续期。详情/流水/overview 未入缓存（单门店查询 <5ms）。失效挂 invalidateMembersDerived（cache-invalidator-members.provider.ts:17-24）→ delByPattern list + del meta + del overview + delByPattern snapshots。无新增缓存需求。
- 迁移脚本：无新增。上线顺序：无代码改动无灰度。档C前评估 Pulse dashboard 跨门店 aggregate 性能 + member_points_logs/member_bean_logs 分区。
### S8-marketing
- 读写量（档B）：marketing_customers 稳态 ~25万行（500店×500顾客）、marketing_consumptions 日增 ~6万行（500店×120消费/日）、年增 ~2190万行；marketing_recharges 日增 ~1万行（500店×20充值/日）、年增 ~365万行；marketing_points_records 日增 ~3万行（含消费扣减+充值赠送+后台调整）、年增 ~1095万行；marketing_promotions 稳态 ~5000行（500店×10活动）、marketing_products ~5万行（500店×100商品）、marketing_product_categories ~5000行。读QPS：overview ~5次/日/店×500=2500次/日、顾客列表 ~10次/日/店×500=5000次/日、顾客详情 ~8次/日/店×500=4000次/日、充值/消费/积分流水列表 ~5次/日/店×500=2500次/日、活动列表 ~3次/日/店×500=1500次/日、商品列表 ~5次/日/店×500=2500次/日；峰值读 ~2 QPS。写QPS：随订单创建（消费+积分流水）约 115 QPS×30%=35 QPS，充值/退款/后台调整低频。
- 退化查询 4 条（S5-P1×3 + S5-P2×1）：①S5-P1 queryCustomerRowById LEFT JOIN users OR+拼接致 users 全表扫描（marketing.query.ts:139-143，3路OR含字符串拼接 u.wechat_phone=c.phone OR u.email=prefix||c.phone||suffix，无法走 users.wechat_phone @unique 或 email @unique 索引，档B users 表增长后退化）；②S5-P1 recharge/pointsRecord OFFSET 大分页+COUNT(*) OVER()（marketing.query.ts:187-201,252-274，raw SQL LIMIT/OFFSET+窗口函数 COUNT(*) OVER() 全量扫描，档B单店年数据量 marketing_recharges ~3650行/marketing_points_records ~2190行可控但 deep offset 退化）；③S5-P1 queryCustomerGiftBalanceCents 无 LIMIT 全量拉取（marketing.query.ts:86-98，SELECT * FROM marketing_recharges WHERE customer_id=X ORDER BY created_at 全量拉取到内存遍历，档B单顾客历史充值~50-200行可控但高频调用路径每次拉全量）；④S5-P2 queryOverviewDailyTrend/MonthlyTrend date_trunc/EXTRACT 对 created_at 做运算（marketing-overview.query.ts:21-29,43-53，DATE_TRUNC('day', created_at) 与 EXTRACT(YEAR/MONTH FROM created_at) 致 [storeId,createdAt] 索引在 GROUP BY 阶段无法直接用于排序，需 Sort+Aggregate）。
- 优化方案：①queryCustomerRowById 拆 OR 为 UNION ALL 三段独立走索引（wechat_phone @unique / email @unique / email @unique），或改用 Prisma findFirst 按 wechatPhone + email IN (...) 分两次查询后合并取优先级最高者，消除 users 全表扫描；②recharge/pointsRecord deep offset 暂不改（档B单店年数据量 <5000 行，offset 退化在 deep page >100 页才显现，商家端流水列表实际翻页深度罕见超过 10 页），档C前评估改游标分页；③queryCustomerGiftBalanceCents 加 LIMIT 安全阀或改用 SQL 递归 CTE 在 DB 侧完成赠送余额计算（当前内存遍历算法简单，档B单顾客 ≤200 行可控，改写成本高于收益，档C前评估）；④daily/monthly trend 已命中 overview 缓存（TTL 120s/refresh 30s），实际 DB 查询频率低，暂不改写 SQL（改写需生成表达式索引 DATE_TRUNC('day', created_at)，成本高于收益），档C前评估。
- 缺失索引 1 条：marketing_customers [storeId, lastVisitAt] partial WHERE deleted_at IS NULL——S3 标记此索引为可改 partialIndex（customers.prisma:47），当前为全量索引 marketing_customers_store_id_last_visit_at_idx，buildCustomerWhere 中 status=dormant/lost 查询恒带 deletedAt: null + lastVisitAt 范围过滤，partial 索引缩小扫描集。但因 marketing_customers 档B仅 ~25万行、单店 ~500行，全量索引已足够快，改造收益极低。**本轮不新增索引。** S3 标记的 5 条 MarketingCustomer 可改 partialIndex 属 S3 索引改造轮次范围，不在本轮新增。queryCustomerRowById 的 users 表 OR 拼接问题通过代码改写解决（拆 UNION ALL 走已有 @unique 索引），不需要新增索引。
- 缓存策略：overview（TTL 120s/refresh 30s，已入缓存，已注册 prewarm-cycle marketingOverviewCachePrewarmProvider，随 15s 周期扫描热 key 自动续期）、顾客列表（TTL 60s/refresh 20s，已入缓存，不进 prewarm-cycle 因用户/门店级 key 粒度细）、顾客详情（TTL 15s，已入缓存，不进 prewarm）、活动列表 status=all（TTL 60s/refresh 20s，已入缓存，status≠all 不走缓存保证实时）、商品列表/分类列表（未入缓存，单店 ~100 商品 / ~10 分类，直接查 DB 即可）。失效统一挂 invalidateMarketingCustomerDerived（cache-invalidator-marketing-customer.provider.ts:22-35）→ 3 个 key/pattern（overview del + customers list delByPattern + customer detail delByPattern），由充值/消费/积分调整/顾客 CRUD 路径调用。活动列表失效挂 invalidateDashboardCaches（marketing-promotions.service.ts:362-369）→ delByPattern(buildMarketingPromotionsListPattern)。无新增缓存需求。
- 迁移脚本：无新增迁移。S3 标记的 MarketingCustomer 5 条可改 partialIndex 属 S3 索引改造轮次范围，不在本轮新增。
- 上线顺序：①queryCustomerRowById 拆 OR 为 UNION 三段（随常规发版，消除 users 全表扫描，无 schema 变更）→ ②daily/monthly trend + recharge/pointsRecord offset + giftBalance 暂不动，档C前评估 → ③无灰度需求（代码级改写，无数据变更）。
- 与S3/S4/S5无冲突。S3标记 MarketingCustomer 5条索引可改partialIndex，属S3改造范围；S4将 MarketingCustomer 列为写热点（balance/points/totalSpent 高频 UPDATE），本轮未改写路径仅评估读侧优化，不影响写热点结论；S5标记的4条退化查询均在本轮给出方案（3条暂不动+1条代码改写）。
### S8-finance
- 读写量（档B）：finance_cash_flow_records 日增 ~1.5万行（500店×30条/日，含销售自动+手动）、年增 ~547万行；finance_account_records 稳态 ~1万行（低频追加，结清后仍保留）；finance_reconciliation_records 稳态 ~5000行。读QPS：overview/report ~15次/日/店×500=7500次/日，cash-flow/accounts/reconciliation 列表 ~10次/日/店×500=5000次/日；峰值读 ~3 QPS。
- 退化查询 3 条（S5-P1×1 + S5-P2×2）：①S5-P1 queryFinanceReportData findMany take:5000 无分页全量拉取 cash-flow + accounts（finance-overview-report.query.ts:141-146,169-176），档B单店年数据量 ~3万行时触发截断、汇总走SQL聚合不受影响但明细行被cap；②S5-P2 queryOverviewDailyTrend raw SQL date_trunc('day', date + interval '8 hours') 对 date 列做运算致 [storeId,date DESC,createdAt DESC,id DESC] 索引失效（finance-overview-report.query.ts:281-292），走全量扫描+排序；③S5-P2 queryOverviewMonthlyTrend 同理（finance-overview-report.query.ts:320-331）。另：queryCashFlowStatsRows findMany 无 LIMIT 全量拉取区间内全部流水行做内存聚合（finance-cash-flow.query.ts:64-71），档B月周期单店 ~1500行可控但year周期 ~1.5万行有退化风险。
- 优化方案：①report take:5000 改为分页游标拉取或加 storeId+date 范围限制后分批 stream（保留汇总走 SQL groupBy 不变）；②daily/monthly trend raw SQL 已命中缓存（TTL 120s refreshAfter 30s），实际 DB 查询频率低，暂不改写 SQL（改写需生成表达式索引或物化视图，成本高于收益），档C前评估；③stats 查询改用 SQL aggregate（SUM+GROUP BY direction）替代全量 findMany 内存聚合。
- 缺失索引 1 条：finance_account_records [storeId, remaining] partial WHERE remaining > 0——覆盖 buildDerivedOpenAccountWhere 和 buildDerivedFinanceAccountStatusWhere 的 overdue/partial/pending 查询（现 [storeId,status,updatedAt] 索引命中 DB status 快照列，但代码已改为派生状态查询不走 DB status），需新建迁移。SQL：CREATE INDEX CONCURRENTLY idx_finance_account_records_store_remaining_open ON finance_account_records (store_id, remaining) WHERE remaining > 0; 回滚：DROP INDEX CONCURRENTLY idx_finance_account_records_store_remaining_open;
- 缓存策略：overview（TTL 120s/refresh 30s，已入缓存）、report（TTL 120s/refresh 30s，已入缓存，export 路径不走缓存）、cash-flow list+stats（TTL 60s/refresh 15s，已入缓存）、accounts list+stats（TTL 60s/refresh 15s，已入缓存）、reconciliation list+stats（TTL 60s/refresh 15s，已入缓存）。失效统一挂 invalidateFinanceDerived（cache-invalidator.service.ts:127-136）→ 5 个 sub-provider（overview/cashFlow/accounts/reconciliations/report）。预热：overview+report 已注册 prewarm-cycle（financeOverviewCachePrewarmProvider + financeReportCachePrewarmProvider），随 15s 周期扫描热 key 自动续期。无新增缓存需求。
- 迁移脚本：新增 1 个迁移（finance_account_records partial index [storeId, remaining] WHERE remaining > 0），CONCURRENTLY 方式，无数据变更。
- 上线顺序：①迁移脚本（CONCURRENTLY 加索引，无锁表）→ ②stats 查询改 SQL aggregate（随常规发版）→ ③report take:5000 改分批 stream（随常规发版，需验证 CSV 导出完整性）→ ④daily/monthly trend 暂不动，档C前评估。
- 与S3/S4/S5无冲突。S3 未标记 finance 索引为冗余或低效；S4 未将 finance 表列为写热点；S5 标记的 3 条退化查询均在本轮给出方案。
### S8-goods
- 读写量（档B）：products 稳态 ~10万行（500店×200 SKU）、product_categories ~5000行（500店×10分类）、inventory_adjustment_logs 日增 ~10万行（500店×200单/日×1条/单，含sale/restock/manual/custody）、年增 ~3650万行。读QPS：商品列表 ~3次/日/店×500=1500次/日、商品选项 ~5次/日/店×500=2500次/日、库存盘点列表 ~3次/日/店×500=1500次/日、库存统计 ~2次/日/店×500=1000次/日；峰值读 ~1 QPS。写QPS：库存扣减随订单创建（档B 115 QPS中约60%含商品扣减≈70 QPS峰值），但写目标为 products.stock UPDATE + inventory_adjustment_logs INSERT，每订单 ~3-5 条商品行。
- 退化查询 0 条：S5 清单中无 goods 模块条目。goods 表均为单门店 storeId 过滤 + 分页查询，表规模小（products 档B ~10万行、单店 ~200行），无退化风险。queryInventoryStatsRows（inventory.query.ts:195-211）全量 findMany 无 LIMIT 但按 storeId 过滤，单次 ~200行安全；queryAllProducts（products.query.ts:143-152）同理；getReport（inventory-read.service.ts:114-151）全量拉取做内存聚合，单店 ~200行安全。档C前无需改写。
- 缺失索引 1 条：products [storeId, stock] partial WHERE stock <= alert_threshold AND deleted_at IS NULL AND is_active = true——覆盖库存预警查询（alertLevel=warning 时跨字段比较无法下推 DB，当前走全量内存过滤，inventory.query.ts:96-106）。但 Prisma 无法表达 stock <= alert_threshold 跨字段比较，该索引需用表达式索引（CREATE INDEX ... ON products (store_id) WHERE stock <= alert_threshold AND deleted_at IS NULL AND is_active = true），仅缩小扫描集不消除内存过滤。收益有限（单店200行→预警行~20行），档C前评估。本轮不新增。
- 缓存策略：goods 模块当前无 Redis 缓存。商品/分类/库存数据低频读（峰值 ~1 QPS），单店数据量小（~200行），直接查 DB 即可，无需引入缓存。scanordering:menu:{storeId} 缓存属 operations/club 域非 goods 域。档C若读量上升可评估商品列表入缓存（TTL 30s），但当前不推荐。
- 迁移脚本：无新增迁移。S3 标记的 Product 3 条 + ProductCategory 2 条可改 partialIndex，属 S3 索引改造轮次范围，不在本轮新增。
- 上线顺序：无代码改动，无迁移，无灰度需求。档C前评估：①products 表年增可控（纯配置表无追加写入），无需分区；②inventory_adjustment_logs 档C年增 ~1.46亿行需按 createdAt 月分区（同 sale_order_items 分区策略）；③库存预警表达式索引。
- 与S3/S4/S5无冲突。S3标记 Product/ProductCategory 5条索引可改partialIndex，属S3改造范围；S4未将 goods 表列为写热点（products.stock UPDATE 虽高频但单行原子 increment 无行锁等待，HOT 更新受限于 4 索引但单店并发低）；S5无 goods 模块退化查询。
### S8-staff
- 读写量（档B）：employees 稳态 ~5000行、employee_shifts 日增 ~500行（月增 ~1.5万行）、employee_payrolls 年增 ~6万行、staffs ~1500行、store_sub_accounts ~1500行、cost_records（staff触发部分）年增 ~18万行。读峰值 <0.5 QPS、写峰值 <0.1 QPS。档C最大表 employee_payrolls 年增 24万行无需分区。
- 退化查询 2 条（S5-P1×2）：①employees-snapshot-sync.service.ts:94-143 mapConcurrent 逐条 payroll.update + 逐条 syncPayrollCosts（每工资单 3×findFirst+3×upsert=6 次 DB 往返），底薪变更触发 4N 次往返（N=历史工资单数），档B N≤12 → 84 次往返 <84ms 在事务超时内安全，暂不动；②employees-snapshot-sync.service.ts:210-217 syncPayrollCostTitles 逐条 costRecord.update（Promise.all N 次 update），改写为单条 raw SQL UPDATE...CASE WHEN...END WHERE id=ANY(...) 消除 N+1 写。
- 缺失索引 1 条：cost_records [storeId, sourceType, payrollId] partial WHERE payroll_id IS NOT NULL——原 `cost_records_store_source_payroll_unique` 于 20261007100000 被误 DROP 未重建，upsertPayrollCostRecord.findFirst 和 syncPayrollCostTitles 子查询退化为全表扫描。重建为普通 partial index（非 unique，唯一性由应用层保证）。**需确认**：cost_records 表属 operations 模块 Prisma 定义，本索引跨模块影响 staff 调用路径。
- 缓存策略：staff 模块无独立缓存，所有查询单店 <200 行直接 DB <5ms。写操作已挂接 invalidateProfitDashboardHome（employees-profile-write.service.ts:100,168,209,248）和 invalidateDashboardAndPulseSession（employees-leave.service.ts:171-174）。无 prewarm 需求。无新增缓存需求。
- 迁移脚本 1 个：重建 cost_records partial index（CONCURRENTLY 无锁表）。上线顺序：①迁移（CONCURRENTLY 加索引）→ ②syncPayrollCostTitles 改单条 SQL 批量更新（随常规发版）→ ③mapConcurrent 路径暂不动档C前评估 → ④无灰度需求。
- 与S3/S4/S5无冲突。S3标记 Employee 4条索引可改partialIndex（employees.prisma:67-70）属S3范围；S4未将staff表列为写热点；S5标记的2条退化查询均给出方案（①暂不动+②代码改写+索引重建）。
### S8-stores
- 读写量（档B）：stores 稳态 ~500行、store_subscriptions ~500行（1:1）、store_invite_codes ~500-1000行（每店1-2码）、store_invite_qr_issues ~2500行（500店×5渠道码）、store_wechat_pay_configs ~250行（~50%配置率）。读峰值 <0.5 QPS（门店信息低频读、扩展字段 DB+Redis 双写），写频率极低（门店创建/更新/邀请码轮换/微信配置变更）。档C stores ~2000行、store_wechat_pay_configs ~1000行仍为微型配置表，无分区需求。
- 退化查询 0 条：S5 清单中无 stores 模块条目。stores 模块所有查询均走 PK 或 @unique 约束（store.findUnique by id、storeSubscription.findUnique by storeId、storeWechatPayConfig.findUnique by storeId、storeInviteCode.findUnique by code）。listAllApiV3Keys（stores-wechat-pay.service.ts:164-168）跨门店 findMany 无 storeId 过滤，但表规模档B ~250行/档C ~1000行，且仅在微信支付回调时触发（低频），推演 <1ms，不构成退化。
- 缺失索引 0 条新增：S3 标记 Store @@index([name])/@@index([contactName])（store-accounts.prisma:157-158）和 StoreSubscription @@index([status])（store-accounts.prisma:176）为低效索引，属 S3 改造范围。stores_owner_id_updated_at_id_partial_idx 于 20261007100000 迁移被 DROP 未重建，但 stores 表档B仅500行、ownerId 有 @unique 约束（stores_owner_id_key）保证 findBoundStoreRecord 的 ownerId 查询走唯一索引，重建 partial 收益极低。本轮不新增索引。
- 缓存策略：stores:profile:{storeId} 已入缓存（TTL 7天/604800s，stores-profile.service.ts:16），DB 优先 + Redis 兜底双写模式，门店更新时 persistStoreProfileMetadata 同步刷新 DB+Redis。club:invite-code-map 全局映射已入缓存（TTL 3600s，club-invite-code-map.service.ts:11），邀请码轮换/停用时主动 del（store-invite-code.service.ts:196-201）。StoreBusinessCapabilityService.resolveStoreBusinessMode（store-business-capability.service.ts:134-155）每次 findUnique by PK 查 businessMode，档B单行 <1ms 不入缓存。storeWechatPayConfig.findUnique by storeId 同理不入缓存。无新增缓存需求，无 prewarm 需求（低频读 + 已有 TTL 缓存），无新增 invalidator provider 需求。
- 迁移脚本：无新增迁移。上线顺序：无代码改动无灰度。档C前评估：①stores 表年增可控（纯配置表无追加写入），无需分区；②listAllApiV3Keys 跨门店 findMany 档C ~1000行仍安全（<1ms），若微信支付回调频率上升可评估 Redis 缓存 apiV3Key 列表 60s；③S3 标记的 3 条低效索引（name/contactName/status）属 S3 改造范围，删除前需确认 Pulse 管理端 store.findMany where name contains 查询（membership-admin-member-records.service.ts:431-434）的替代方案。
- 与S3/S4/S5无冲突。S3标记 Store 3条低效索引属S3改造范围；S4未将stores表列为写热点（纯配置表低频写）；S5无stores模块退化查询。
### S8-club
- 读写量（档B）：scan_orders 日增 ~48万行（12k单×8行/单）、self_orders ~5万行、club_voucher_orders ~5千行、菜单查询 ~15万次/日、订单列表 ~4.5万次/日、会员账户查询 ~7.5万次/日。
- 退化查询 2 条：①listOrders/listOrderHistory 6层 include N+1（session→orders→items→specs + paymentAttempts/refundTasks/balanceTransactions + menuProduct.findMany 补图），同构 S5-P1 operations querySaleOrders 4层 include；②getSnapshotByStoreIdentity 3次DB查询+1次 marketingRecharge.aggregate 全表扫描（member-profile.service.ts:63-73,211-214）。
- 优化方案：①将 listOrders 的 menuProduct.findMany 与 session findMany 改为 Promise.all 并行（-3次串行往返）；②会员账户快照入 Redis 缓存 15s TTL，复用已有 invalidateMarketingCustomerDerived 失效（checkout.service.ts:267-269 已调用），档B下 aggregate 执行次数从 75k/日降至 ~3.75k/日。
- 缺失索引：本轮无新增。club_voucher_orders 现有 [userId,status,createdAt] 已覆盖列表查询；voucherCode @unique 已覆盖 findByVoucherCode；scan_ordering_sessions [clubUserId,status,lastActiveAt] 已覆盖活跃会话查询。档C前需将 listVoucherOrders 的 offset 分页改为游标分页（年增1.8M行后 offset 退化）。
- 缓存策略：getMenu 入缓存 30s（key=club:menu:{storeId}:{menuVersion}，版本不变即命中）；getSnapshotByStoreIdentity 入缓存 15s（key=club:member-snapshot:{storeId}:{userId}）；loadActivePromotions 入缓存 60s（key=club:promotions:{storeId}）。均不进 prewarm-cycle 预热周期（短TTL用户/门店级 key），失效复用已有 invalidateMarketingCustomerDerived/invalidateMarketingOverview。
- 迁移脚本：无新增迁移。
- 上线顺序：①代码级重构 listOrders 并行查询（随常规发版）→ ②灰度缓存 getMenu+getSnapshotByStoreIdentity（CLUSTER_WORKERS=1 验证1周）→ ③监控 pg_stat_statements P95>50ms 则回头评估。
- 与S3/S4/S5无冲突。S4 写热点 ScanOrderingPickupSequence/MarketingCustomer/ScanOrders 属 club 写路径核心表，本轮未改写路径仅加读缓存，不影响写热点结论。
### S8-pulse
- 读写量（档B）：读主体为极少数开发者（DAU_b=3），峰值读 ≤1 QPS。涉及表：users ~7.65万行（跨门店 count/findMany 在线统计）、store_partners ~1500行、store_partner_applications ~500行、store_membership_orders ~1.22万行、store_membership_promo_records ~6.1万行、store_partner_bean_logs 年增~3万行、partner_withdrawals ~500行、sale_orders 日增~10万行（membership-admin-sales-stats 单店查询带 storeId+date 走索引）。写频率极低（合伙人审批/提现/套餐变更），无写热点。
- 退化查询 2 类（S5-P1×2）：①dashboard-home loadPulseHomeRawData 5 类跨门店无 storeId 查询（dashboard-home.query.ts:198-259，storePartner.count×3 + storePartnerApplication.count + storeMembershipOrder.findMany/aggregate/groupBy + user.count/findMany），已被缓存 TTL 30s/refreshAfter 10s 覆盖（dashboard-home.service.ts:25-26），档B表规模 <7.65万行全表 count/aggregate 推演 <10ms，暂不改动；②membership-admin-sales-stats 10 次 raw SQL date_trunc 聚合 sale_orders（membership-admin-sales-stats.service.ts:121-172，5 周期×current+previous），每条 SQL 带 storeId+date 范围走 [storeId,date DESC,id DESC] 索引，单店年数据量 ~2万行/周期扫描可控，推演 <10ms，暂不改动。需确认：S5 将此条归入 Pulse 但查询目标 sale_orders 属 operations 表，此处按 S5 归属处理。
- 缺失索引：本轮不新增。Pulse 查询的表均有覆盖索引（store_partners [storeId,status,updatedAt]、store_membership_orders [status,createdAt]+[storeId,status,createdAt]、store_membership_promo_records [storeId,hasCharged,registeredAt]、sale_orders [storeId,date DESC,id DESC]、partner_withdrawals [storeId,appliedAt]）。users.lastActiveAt 无索引但全表 count 档B ~7.65万行 <10ms 可接受。与 S3 冲突点：S3 标记 StorePartner [status,updatedAt] 和 StoreMembershipOrder [status,createdAt] 为低效索引，但 Pulse dashboard 依赖这两条索引做跨门店 status 过滤，改造属 S3 范围，删除前需确认替代方案。
- 缓存策略：10 个 cache-invalidator provider 已全覆盖（cache-invalidator-pulse.providers.ts:32-46）。dashboard-home 30s/10s、overview 20s/10s、revenue-detail 20s/8s、session-bootstrap 15s/5s、notification 15s/5s、onboarding-status 20s/8s、growth-earnings 20s、growth-admin 30s/10s。Pulse 无 prewarm-provider（开发者低频读 + key 粒度细），无新增缓存需求。membership-admin-sales-stats 不入缓存（开发者 ~50次/日 + 单店带索引 <10ms）。
- 迁移脚本：无新增。上线顺序：无代码改动无灰度。档C前评估：①users.last_active_at partial 索引（需评估鉴权写放大）；②sale_orders date_trunc 表达式索引（需评估与 S4 分区兼容）；③sales-stats 加 Redis 30s 缓存；④dashboard 跨门店 aggregate 性能（users >30万行后退化）。
- 与S3/S4/S5无冲突。S3标记的2条低效索引属S3改造范围；S4未将Pulse表列为写热点；S5标记的2类退化查询均给出方案（暂不改动，理由：缓存覆盖+表规模可控+开发者低频读）。

## S9 验证与上线
- 变更 18 项：参数配置 5 项（V01-V05）/ 索引迁移 3 项（V06-V08 CONCURRENTLY）/ 代码改写 8 项（V03,V09-V16）/ 缓存 1 项（V17）/ 清理任务 1 项（V18）。
- 执行分类：可在线 12 项 / 需低峰期 4 项（V04-V08）/ 需停服 2 项（V01-V02 systemd 重启）。
- 上线 4 批独立回滚：批1参数→批2索引→批3代码→批4缓存+清理。
- 压测 k6 复用档 A/B，8 场景含混合峰值，达标线 P95≤300ms / P99≤500ms / 错误率<0.1%。
- 验证方法：每项变更 EXPLAIN 前后对比 + DB 往返计数 + 数值一致性校验。
- 上线后 7 天观测 12 项指标，3 项 P0 告警（连接>100 / PoolTimeout / 慢SQL P95>300ms）。
- 数据构造需新建 4 个 seed 脚本（stores/members/orders/finance），档 B sale_order_items 600 万行覆盖 30 天。
- 下游硬约束：V01 停服重启前必须确认 PG 连接 <50；V06-V08 建索引需低峰 IOPS await<20ms；V09/V10/V14 金额数值一致性必须逐门店抽样验证。

# 2026-10-20 purelyprofit-server 优化记录

> 范围：当日工作区未提交改动（102 个文件，+3493 / -1123），只记**性能优化与重构优化**，不含 bug 修复；
> 亦不含 10-19 22:03 已提交的 `620a4a7`（扫码点单/积分/代金券与交接班服务优化）。
> 所有改动均配套更新了单测；本文档成文时未执行构建与测试验证。

## 一、数据库索引（3 个新迁移，均为 partial index）

- `custody_orders` 新增 `(store_id, created_at DESC) WHERE deleted_at IS NULL`（`idx_custody_orders_store_created`）：默认 Tab 为 `status=all`、不带 status 谓词，既有 `idx_custody_orders_store_status_created` 前导列是 status，PG 无 skip scan 只能 Seq Scan + Sort；新索引直接支撑默认分页路径。迁移：`prisma/migrations/20261020120000_add_custody_orders_store_created_idx`。
- `scan_orders` 新增 `(session_id, created_at DESC) WHERE session_id IS NOT NULL AND deleted_at IS NULL`：PG 不为外键自动建索引，此前 4 条高频「按会话查订单」路径（C 端 listOrders include、`getCurrentSession` some 子查询、商家端 dashboard 计数、会话自动归档）全部 Seq Scan。迁移：`20261020130000_add_scan_orders_session_idx`。
- `scan_orders` 新增 `(status, paid_at)` 与 `(status, accepted_at)`（均 `WHERE deleted_at IS NULL`）：支撑支付超时扫描任务（`scan-ordering-acceptance-expiration.service.ts` 的 `findCandidates`，每 60s 扫 `status + paidAt ≤ now-30min` / `status + acceptedAt ≤ now-2h`），此前每轮全表扫描。迁移：`20261020140000_add_scan_orders_timeout_idx`。
- ⚠️ 三个迁移文件均注明：生产存量表应改 `CREATE INDEX CONCURRENTLY` 在事务外执行（Prisma migrate 会把迁移包在事务里，CONCURRENTLY 无法在其中运行）。

## 二、客存 custody（profit 端 + club 端）

**缓存体系收口**
- `src/shared/custody/custody-code.service.ts` 扩展为客存模块唯一 Redis 出口：门店统计、列表总数、门店快照、门店配置、会员汇总统一经其读写；`custody-code.constants.ts` 新增门店快照 key 前缀与 TTL。
- `src/shared/custody/custody-store-snapshot.ts`（新）：`resolveCustodyStoreSnapshot()` 把门店快照（ownerId + name）收在一处，读链路（角色判定）与推送链路（门店名）共用同一份缓存，避免每个请求都读一遍门店行；**回写整份快照**而非分字段写，防推送侧只写 name、角色侧只写 ownerId 导致另一字段被写空。
- 门店统计聚合单飞（single-flight）：缓存失效瞬间同门店并发请求只聚合一次，防缓存击穿（`custody-read.service.ts`）。
- 列表总条数按筛选组合（状态 Tab / 到期预警 / 关键字）分字段缓存：FNV-1a 32 位指纹做 hash 字段键，一次 HGETALL 取回全部组合（`custody-read.service.ts` + `custody.domain.ts` + `redis.service.ts hgetAllJson`）。
- 会员汇总缓存带「口径有效截止时间」：汇总随时间漂移（存单到期 / 进入临期窗口），越过即重算，避免「汇显示在存 2 件、列表只有 1 条」对不上账（`club-custody-read.service.ts`）。

**查询与事务优化**
- `custody-pickup.service.ts`：签发令牌 + 清除失败计数合并为一次 pipeline 往返（核销是高频热路径）；取件码失效 + 门店级缓存 + 会员汇总失效合并为一次往返。
- `custody-write.service.ts`：幂等查询与会员查询并行发出；事务后不再回读同一行，直接由事务内状态流转结果拼映射入参。
- `custody-stock.guard.ts`：冻结校验把物理库存带出，供同一事务内台账复用，不再重读商品行。
- `custody.query.ts`：拆出 `buildCountWhere`——总条数不带游标条件（翻页时总数不再随游标一路变小），且因此可按筛选组合缓存。
- 缓存失效纪律：配置变更同时失效统计/总数/配置缓存（`custody-settings.service.ts`）；草稿单/存单量变化同时失效会员汇总与门店缓存（`club-custody-write.service.ts`）。

## 三、扫码点单与营销定价（purely-club）

- 价格版本快照复用：`scan-ordering-pricing-version.service.ts` 的 `computePricingVersion` 支持传入调用方已加载的购物车/商品快照；新增 `priceCartWithPricingVersion`（`club-scan-ordering-cart-pricing.service.ts`）一次取数同时产定价结果与快照，preview / create 各少 2 次查询（原先定价与版本各查一遍规格组/规格项）。hash 输入维度不变，缓存 key 兼容。
- 门店定价上下文预加载：`club-order-promotions.service.ts` 新增 `preloadPricingContext`（活动列表 + 消费次数并行拉取），多行定价从「每行 2 次查询」降为「每请求 2 次」；`club-marketing-preview.service.ts` 多行预览前预加载一次并透传。
- 营销顾客解析去事务化：`club-scan-ordering-marketing-customer.service.ts` 只读路径摘出 `$transaction`（preview/create/余额支付每次少 BEGIN + COMMIT 两次往返），绑定档案与 user 查询并行；仅归并/建档写路径保留事务。
- 菜单版本计算改单条扁平 JOIN：`club-scan-ordering-menu-query.service.ts` 的 `computeMenuVersion` 由 Prisma 四层嵌套 select（4 条查询）改为 `$queryRaw` 一条 JOIN，归组后 hash 与嵌套写法逐字节一致，缓存 key 兼容。
- 下单会话合并桌台信息：`club-scan-ordering-order.service.ts` 的 `requireSession` include table（name/area/type），实时通知随会话一次查出，省提交后补查一次。

## 四、库存与商品（goods）

**库存写路径批量读 / 批量写**
- `inventory-stock.query.ts` + `inventory-stock.write.ts`：`loadInventoryWriteContext` 一次读出全部商品行与冻结量（`Promise.all` 并行，固定 2 次读、与商品数无关）；多条调整流水合并为一次 `createMany`；写仍逐条原子 `increment`。5 个商品的订单从事务内 20 次往返降到 8 次（2 读 + 5 更新 + 1 流水）。
- 行锁与读合并：`SELECT ... FOR UPDATE` 一次往返既加锁又读当前库存（原「先 FOR UPDATE 再 findFirst」两次往返）。
- 抽离 `mergeInventoryItemsByProductId`：restock / sale / bestEffort / applyDeductions 四个入口共用按 productId 合并逻辑。

**库存读路径下推**
- `inventory-read.service.ts`：无域层筛选时 skip/take 下推 DB，只加载当前页 + COUNT；预警筛选改调 `queryInventoryAlertProducts` raw SQL；`getStats` 改库内聚合；CSV 导出只查报表 5 列。
- `inventory.query.ts`：`queryInventoryStatsAggregate` 一条 SQL 用 `COUNT(*) FILTER (...)` + `SUM(stock::bigint * cost_price)` 算齐预警档位与库存总值；`queryInventoryAlertProducts` 把 `stock <= alert_threshold` 跨字段比较下推（Prisma 无法表达）并做 ILIKE 通配符转义；items/count `Promise.all` 并行。
- 读写域三层分离：`buildInventoryManualAdjustmentPlan` / `buildInventoryStockChangePlan` / `buildInventoryRevertStockPlan` 等纯计算函数抽至 domain 层；`matchesInventoryFilters` / `sortInventoryProducts` 参数收窄为 `Pick<...>`，CSV 轻量行复用同一筛选/排序口径。

**商品**
- `products.service.ts`：create/update 中分类补全与编号唯一性校验（两张表、互不依赖）改 `Promise.all` 并行；规格未变更时免重查三层嵌套商品。
- 新增 `listOptions` 全量选择器接口（`queryAllProducts`）：避免客户端 `ceil(total/pageSize)` 次分页请求（1000 商品 ≈ 100 次 → 1 次）。
- `products-scan-ordering-sync.service.ts`：`hasSameSpecifications` 内容比对，规格无变更不重建（避免选项 ID 漂移与无谓写）；规格组/选项 `createMany` 批量插入 + 按 sort 升序保序；重建后按 `[sortOrder, id]` 双级排序防脏数据取错组；缓存失效同时清商家端固定 key 与顾客端 `club:menu:*` pattern。
- 抽离公共逻辑：`productSelect` 统一 select、`products-command.utils.ts`（DTO→Prisma data）、`products.domain.ts`（Decimal 利润推导）、`products.mapper.ts`（规格组装）、`product-spec-pricing.service.ts`（追加点单/自助下单共用权威定价）。

## 五、销售记录 sales-record

- `sales-record-list.service.ts`：分页 orders / count / stats / 扫码与空间会话两个批量详情全部提前发出再 `Promise.all` 汇总，避免总查询耗时串行累加。
- `sales-record-stats.service.ts` 抽出 `getCachedStats` 统一出口：列表 summary 复用 stats 接口缓存（周期解析、clampHistoryRange、子账号作用域同源），常态命中缓存不再每次对全店范围重做 items/refunds 聚合；明确禁止列表侧另开平行缓存键（防两侧互写缺字段的值）。
- `sales-record.query.ts` 订单号生成下推 SQL：`queryMaxSerial` 用 `MAX((regexp_match(order_no, '-([0-9]+)$'))[1]::integer)` 在库内求当日最大序号，替代拉取当日全部 order_no 到 Node 侧正则求 MAX——网络/内存从 O(当日单据数) 降为 1 行，并缩短 `pg_advisory_xact_lock` 持锁时间；必须按数值求 MAX（零填充序号超 999 后字典序会倒退回已占用序号）。

## 六、空间管理 spaces

**读侧缓存（本轮新增）**
- `space-dashboard.service.ts` 接入 `RefreshableCacheService`：TTL 15s + 5s 软刷新（与 sales-stats 同模式）；看板单次 ~8 条 SQL（含当日销售三表聚合），命中缓存降为 1 次 Redis GET。
- 看板 `_count` 瘦身：`findSpacesByStore` 只保留 `_count`（过滤条件与原嵌套数组一致），省 2 条嵌套关系加载 SQL。
- 缓存 key/失效基础设施：新增 `src/redis/keys/spaces.cache-keys.ts`（列表按 store + status/type/zone 分键、看板单门店一份）与 `src/redis/cache-invalidator-spaces.provider.ts`（`Promise.all` 并行失效看板 + 列表两个 pattern）；经 `cache-invalidator-profit-read.providers.ts` / `.service.ts` 注册，顶层 `cacheInvalidatorService.invalidateSpacesReadCaches(storeId)` 统一入口。
- 8 个写路径写后主动失效：开台、结账、续费、换房、追加商品、标记可用、预约变更、空间增删改（TTL 仅兜底）。

**查询与调度优化**
- `space-session-auto-checkout.service.ts`：预付费/台位费标量条件与「有续费记录」半连接原塞在同一个 OR，计划器难以同时利用复合索引与半连接；拆为两条形态简单的查询 `Promise.all` 并发、门店维度取并集，命中 `(status, autoCheckout, billingMode, endTime)` 复合索引，匹配范围与旧 OR 完全一致。
- `space-session-read.service.ts`：空间存在性校验与会话查询合并为一次 `findFirst`（relation filter 保证只命中未删除空间上的 active 会话），查不到再补一次轻量空间校验区分「空间不存在 404」与「无活跃会话」，且保持先鉴权再返回。
- `spaces-status.service.ts`：复用 update 返回的最新 cleanedAt 与已加载关系数据，不再 `findUniqueOrThrow` 重读同一行。
- `space-qr-code.service.ts`：读路径不再写库——原 `upsert(update: {})` 行已存在仍执行 SELECT + UPDATE 并推 `updated_at`（预览/下载这类高频读操作的写放大）；改 find-or-create，并发补建用 P2002 唯一约束兜底回读。
- `space-reservations.shared.ts`：`Intl.DateTimeFormat` 模块级复用（构造开销 ~百微秒级，每请求被调用 2-4 次）。

## 七、Redis 基础设施 src/redis

- `redis.service.ts` 新增原子操作原语：
  - `executePipeline`：一组互不依赖的命令合并为一次网络往返（需原子性用 multi）；
  - `hsetJson`：HSET + EXPIRE 走同一条 pipeline，分开执行是两次往返；
  - `hgetAllJson`：一个键按维度分字段缓存时一次取回全部字段（客存门店各筛选组合的列表总数即此模式）；
  - `hgetJson`：hash 字段 JSON 读取（字段不存在返回 null）。
- 失效底层复用既有 `delByPattern`（SCAN + pipeline UNLINK，非阻塞 KEYS），新 spaces provider 直接复用，无 KEYS 阻塞风险。
- `cache-keys.ts` 主桶新增 spaces 看板/列表 4 个键与 pattern 构造函数。

## 八、会员等级 club-member-levels

- `club-member-levels.service.ts` 的 `loadLevelSettings` 并发去重：同一门店在途请求共用一个 Promise，会员等级页并发请求的 account / level-status / levels 三个接口一次页面加载只查一次配置表；不做时间缓存，后台改配置后仍立即生效。

## 遗留 / 待确认

- 空间**列表**读侧缓存：key 与失效 pattern 已定义、失效已接线，但 `spaces-read.service.ts` 的 `listSpaces` 尚未接入缓存（其 spec 已 mock `RefreshableCacheService`，疑似漏接线或 WIP），需确认是否补上。
- 客存关键字搜索（会员姓名/手机号/商品名/存放位置）：代码注释建议后续在这些列上补 `pg_trgm` GIN 索引（Prisma 不表达，需手写迁移）。
- 三个新索引迁移在生产执行时需改 `CREATE INDEX CONCURRENTLY`（事务外）。
- 本次改动未执行构建与测试验证，建议合入前跑一遍测试与构建。

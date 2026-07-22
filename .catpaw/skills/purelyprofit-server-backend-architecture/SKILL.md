---
name: purelyprofit-server-backend-architecture
description: purelyprofit-server 是 purelyProfit 业务主仓的后端接口仓库，同时承载 purely-profit、purely-pulse、purely-club 三条产品线语义。该 skill 说明三条产品线的视角边界、会员配置层与运行态边界、`src/bootstrap/*` 启动链路、Config/Prisma/Redis/BullMQ 基础设施、JWT 鉴权与 capability 快照、auth 账号查询/会籍协同拆分、marketing 多 controller 与 facade 分层、finance DTO/response 拆分、Pulse membership admin 读写拆分、空间域 request/response DTO 与 session 子 service 拆分、交班班次页的本人排班与全店可见性边界、全局限流与 Cache-Control 响应缓存约定、`shared` 金额/并发/密码策略工具，以及 runtime-metrics summary 观测聚合。适用于理解仓库结构、开发或修改 purelyProfit / purelyPulse / purelyClub 接口、接入数据库或缓存、处理会员权益限制、扩展营销/财务/空间/员工/交班/会员能力，并保持代码风格与目录约定一致时使用。
---

# purelyprofit-server 后端架构指南

## 什么时候用
遇到下面场景时优先使用：

- 在 `purelyprofit-server` 中新增、修改、排查 `purely-profit` / `purely-pulse` / `purely-club` 接口
- 需要判断代码该放在哪个模块、目录或 service
- 需要沿用现有 DTO、Swagger、JWT、Prisma、Redis 约定
- 需要处理会员套餐配置、运行态权益限制、目标门店上下文
- 需要接入缓存失效、缓存预热、运行态观测
- 需要扩展 `operations/spaces` 这类已拆分的复杂业务域

## 默认工作假设
默认把 `purelyprofit-server` 视为纯利业务主仓的后端集合，而不是只服务老板端。

除非用户明确说明是在调整脚手架、基础设施或工程配置，否则优先按下面方式理解需求：

- 目标通常是新增、修改或排查 `purely-profit` / `purely-pulse` / `purely-club` 相关接口
- 先判断当前需求属于老板端、平台端还是个人端，再决定模块归属与接口语义
- 优先关注 DTO 校验、鉴权、数据库读写、缓存协作、响应字段
- 涉及字段、状态、筛选项、展示结构、业务流程时，先对齐前端页面、请求层、types、表单与交互
- 做新模块、做大改、第一次落表、明显会影响列表查询或聚合链路时，先做数据库设计检查：实体边界、字段语义、软删除、唯一约束/外键、筛选/排序/分页索引、审计字段、历史数据兼容与迁移成本都要先想清楚，不要等后期优化或重构时再补
- 新需求优先落到现有业务模块，不要写成一次性脚本或临时逻辑
- 输出与实现都保持“后端接口开发”语境，避免误偏到前端实现
- 如果字段含义、业务语义或交互意图不明确，先确认再继续

## 产品线与业务语义
### 1. 产品线与目录

- `src/purely-profit/*`：老板/商家自己使用系统，关注门店、员工、会员、营销、财务、空间、经营数据
- `src/purely-pulse/*`：开发者/平台运营观察商家，关注目标商家、门店、区域、入驻、会员、推广、收益、分析
- `src/purely-club/*`：个人端/消费者/会员自己使用系统，关注个人账户、资料、会员权益、储值、消费记录、预约、空间使用、个人中心等能力
- 处理需求前，先判断当前链路属于 `purely-profit`、`purely-pulse` 还是 `purely-club`

### 2. 默认业务视角

- `purely-profit`：默认按商家/老板使用自己系统的视角理解，不要误写成平台/开发者审查商家的后台接口
- `purely-pulse`：默认按开发者/平台运营观察商家的视角理解，不要误写成老板端自助接口
- `purely-club`：默认按个人用户操作自己数据与权益的视角理解，不要误写成商家后台或平台运营接口

### 3. 资金归属默认语义

- `purely-profit`：商家充值、开通会员、续费、购买平台能力等，默认进入开发者/平台侧账户与账单体系
- `purely-club`：用户充值/储值，默认进入目标商家名下的个人会员/顾客储值账户
- 设计接口与字段时，要同时考虑账户归属、余额变更、退款、赠送金额与账务一致性

### 4. 页面联调与目标对象

- 页面联调或 `page-check` 场景里，前端可能是 `purelyProfit` 或 `purelyClub`，后端仍要先判断链路属于 `purely-profit`、`purely-pulse` 还是 `purely-club`
- `purely-pulse` 默认要先确认“目标商家/目标门店/目标区域”，不要默认绑定当前商家自己
- `purely-club` 默认要先确认“当前登录个人用户自己的数据范围”，不要把老板态、门店管理态或平台运营态字段直接暴露给个人端
- 除非用户明确要求走后台代运营/人工协助链路，否则不要把 `purely-club` 写成商家后台接口

### 5. `member` 与 `marketing` 边界

- `member`：商家老板向平台购买的会员服务，属于“平台 ↔ 商家老板”关系
- `marketing`：商家运营自己的顾客，属于“商家 ↔ 顾客”关系
- `member` 里的商家充值/续费/购买套餐，默认理解为资金进入开发者/平台侧账户与账单体系
- `purely-club` 里的会员、储值、积分、消费记录、预约记录等概念，默认按“个人用户查看自己的运行态数据”理解
- `purely-club` 的“充值/储值”不是给平台钱包充值，而是给商家侧顾客余额体系充值
- 前端 `pages/main/member` 默认理解为“商家老板自己的平台会员中心”
- 前端 `marketing` 默认理解为“商家自己的客人/顾客运营”
- “老板开通会员、续费、平台积分、推广返利、合伙人、纯利豆、提现”优先按平台会员中心 / 订阅 / 账单语义设计
- “顾客资料、等级、标签、储值、消费记录、顾客积分、营销人群”优先归到 `marketing` / `customers` / 顾客会员语义

### 会员配置层与运行态边界

平台会员中心已拆成配置层与运行态，开发时不要混用：

- `membership_plan_settings`：套餐配置事实来源，包含 `monthly`、`quarterly`、`yearly`、`lifetime`
- `src/purely-pulse/membership-settings/*`：Pulse 侧维护套餐价格与永久会员有效期配置
- `StoreMembershipProfile.currentPlanId`：运行态档案，当前遵守 `MembershipPlanCycle`，只含 `monthly`、`quarterly`、`yearly`
- “永久会员”不要直接等同于 `currentPlanId = 'lifetime'`，要结合 `startsAt` / `expiresAt` 与访问控制逻辑理解
- 权益限制统一优先看 `src/purely-profit/member/platform-membership/platform-membership-access.service.ts`
- 新增会员权益时，先判断应该改配置表、运行态档案，还是访问控制 service

落位建议：

- Pulse 侧平台配置或开发者管理商家会员档案：优先放 `src/purely-pulse/membership*`
- Profit 侧老板端功能可用性与配额限制：优先通过 `PlatformMembershipAccessService` 接入
- 套餐价格、默认时长、永久会员默认有效期：优先以 `membership_plan_settings` 为事实来源
- 门店当前套餐、是否过期、可用积分/纯利豆：优先以 `store_membership_profiles`、订单、日志等运行态数据为事实来源

## 前后端字段对齐
当需求和现有前端页面、模块、类型定义有关时，默认遵守：

- 写后端接口前先看前端页面、hooks、types、表单字段与展示逻辑，先确认对齐的是 `purelyProfit` 还是 `purelyClub`
- 字段命名、枚举值、可选字段、时间字段、金额单位、状态语义优先对齐前端现状
- 前端已有明确 view model / schema / 列表项结构时，后端尽量直接对齐
- 不要在没有前端依据时随意新增字段、筛选项、状态枚举或业务概念，除非用户明确要求先做预埋
- 如果前端设计不合理，也先兼容现状完成对齐，再额外指出建议
- 字段含义、状态流转、交互意图不确定时，暂停实现并先确认

## 技术栈
- `NestJS 11`
- `Fastify`
- `@nestjs/config`
- `Prisma + PostgreSQL`
- `ioredis`
- `JWT + Passport`
- `Swagger`
- `class-validator + class-transformer`

## 仓库基线

### 目录结构

当前仓库以“基础设施模块 + 多产品线业务模块”组织：

- `src/main.ts`：入口壳；只负责导出 `bootstrap()` 并作为 CLI 启动入口
- `src/bootstrap/*`：真实启动链路，承接 FastifyAdapter、全局校验、请求观测、端口回退、Swagger 过滤、生产配置校验、request id
- `src/app.module.ts`：根模块装配，统一挂载当前启用的产品线模块，并注册全局限流 guard 与 `CacheControlInterceptor`
- `src/config/*`：环境变量映射
- `src/prisma/*`：数据库客户端、连接池、慢 SQL 观测与生命周期管理
- `src/redis/*`：Redis 客户端、缓存失效、缓存预热执行器
- `src/queue/*`：BullMQ 队列处理器与 repeatable job 调度
- `src/shared/*`：跨域共享的金额、并发、密码策略、缓存控制等纯工具与装饰器
- `src/observability/*`：运行态指标、摘要卡片、缓存预热观测上下文
- `src/purely-profit/*`：老板端/商家端业务

### 金额计算全局约束

金额链路统一以 `src/shared/money.utils.ts` 为唯一事实来源，所有业务金额都必须走后端封装方法，禁止在 service / query / mapper / domain / dto 适配链路中直接用裸 `number` 做金额换算、四舍五入、乘除、求和。

硬性规则：

- 前端请求传入的“元”金额，只能用 `Money.fromInputYuan()` 转成后端金额值对象
- 数据库字段、Prisma 聚合、SQL `SUM` / `AVG` / `COALESCE` 返回的“分”金额，只能用 `Money.fromDbCents()` 进入业务链路
- 金额累加统一用 `Money.add()` / `Money.sum()`，禁止直接写 `amountA + amountB`
- 金额扣减统一用 `Money.subtract()`，禁止直接写 `amountA - amountB`
- 金额乘法、折扣、比例换算统一用 `Money.multiply()`
- 金额均摊、反推单价等除法统一用 `Money.divide()`
- 数据库写入金额字段时，只能在落库边界调用 `money.toDbCents()`
- 返回接口响应、页面展示、日志展示金额时，只能在出站边界调用 `money.toOutputYuan()` 或 `money.toFixedOutputYuan()`
- 禁止把数据库里的“分”直接当“元”返回，也禁止把前端传入的“元”直接当“分”入库
- 百分比、占比、环比等非金额结果统一复用 `calcPercentChange()`、`calcPercentOfTotal()`、`calcRatioPercent()`、`calcPercentChangeWithFallback()`，不要手写浮点公式

推荐心智模型：

- 入站：`number(yuan)` -> `Money.fromInputYuan()`
- 域内：全程传递 `Money`
- 聚合：`Money.add()` / `Money.sum()` / `Money.multiply()` / `Money.divide()`
- 落库：`money.toDbCents()`
- 出站：`money.toOutputYuan()`

典型场景：

- 充值、退款、续费、收银、交班、提现、分账、优惠抵扣、储值赠送金额，都必须先转成 `Money` 再计算
- SQL 聚合总额、报表统计、dashboard 卡片、财务 overview、营销 overview、空间结算金额，都必须在读取后立刻包成 `Money`
- 业务比较大小时优先用 `money.greaterThan()`、`money.lessThan()`、`money.compare()`，不要直接比较原始 number
- 需要判断正负、绝对值、取反时复用 `isPositive()` / `isNegative()` / `abs()` / `negate()`

反例：

- `const total = price * count - discount`
- `const amount = Number(row.total_amount ?? 0) / 100`
- `return { amount: cents / 100 }`

正例：

- `const total = Money.fromDbCents(priceCents).multiply(count).subtract(Money.fromDbCents(discountCents))`
- `const amount = Money.fromDbCents(row.total_amount ?? 0)`
- `return { amount: amount.toOutputYuan() }`
- `src/purely-pulse/*`：开发者/平台观察端业务
- `src/purely-club/*`：个人端/消费者端业务；即使当前模块还在持续扩展，也要先按个人端语义理解目录归属
- `prisma/schema.prisma`：数据库模型事实来源
- `.env.example`：环境变量示例

代表性业务域：

- Profit：`access-control`、`auth`、`commerce`、`dashboard`、`finance`、`goods`、`marketing`、`member`、`notifications`、`operations`、`staff`、`stores`、`subscriptions`
- Pulse：`dashboard`、`dev-mode`、`growth`、`membership`、`membership-settings`、`onboarding`、`session`、`pulse-store-context.*`
- Club：个人端能力优先落 `src/purely-club/*`，语义围绕当前登录用户自己的资料、权益、消费、预约、空间会话与个人中心

### 最近新增的项目能力

近期扩展时，把下面这些能力也当成当前事实基线：

- `src/bootstrap/*`：启动层已从 `main.ts` 拆出；当前要沿用 request id、生产配置校验、端口自动清理/偏移、按路由注入微信回调 `rawBody`、BigInt 安全序列化与 HTTP 观测装配
- `src/app.module.ts` + `src/shared/cache-control.*`：全局限流已切到 Redis-backed `ThrottlerGuard`，纯读接口可通过 `@CacheControl()` 返回 `Cache-Control` 头
- `src/queue/*`：缓存预热与空间自动结账已由 BullMQ repeatable job 承接；`CachePrewarmService` 只保留兼容壳
- `src/prisma/prisma.service.ts`：Prisma 已接入 cluster 场景的连接池上限收敛、`statement_timeout`、慢 SQL 观测与连接总量告警
- `src/redis/cache-invalidator.service.ts`：统一承接 dashboard、finance、marketing、members、Pulse session 等衍生缓存失效，并继续向分域 invalidator 下钻
- `src/redis/cache-prewarm-cycle.service.ts` + `src/observability/runtime-metrics*.ts`：缓存预热已拆成 cycle metrics 与 summary 协议；新增预热分类或指标时要同步补诊断面板
- `src/shared/*`：金额链路优先走 `Money` 值对象；大批量异步优先用 `mapConcurrent()`；密码长度校验统一在 RSA 解密后的明文阶段执行
- `src/purely-profit/access-control/*` + `src/purely-profit/auth/auth-capability.service.ts`：老板、员工、子账号三类身份统一走 capability 快照，决定 `allowedHomeModules`、`hiddenHomeModules`、`canAccessHome`、`canUseHandover`
- `src/purely-profit/auth/*`：auth 域已拆成 `account lookup`、`account membership`、`authentication`、`password`、`profile`、`session` 等子 service，并补了 `CurrentUser` / `RequestId` / `RequestAuditContext` 等 decorator
- `src/purely-profit/member/platform-membership/store-sub-account*.ts`：子账号配额、槽位分配、登录账号、交班候选人解析已沉淀在平台会员模块，不要把子账号规则散落到员工或 auth controller
- `src/purely-profit/marketing/*`：营销域已拆成 overview/customers/transactions/promotions/products/categories 多 controller + facade + 子 service
- `src/purely-profit/finance/*`：财务域已按 account/cash-flow/overview/reconciliation/report 拆分 query DTO、response DTO、domain 与工具函数
- `src/purely-profit/staff/employees/*`：员工域已覆盖档案、部门、职位、班次定义、排班、请假、工资单、子账号维护
- `src/purely-profit/operations/handover/*`：交班域已拆成 `page/confirm/records/additional-items/shared`，写操作要基于当前班次可操作性，并拦截重复交班
- `src/purely-profit/operations/handover/handover-page-shift.service.ts`：交班页班次上下文须区分“本人可操作班次”“本人历史/排班班次”与“全店展示班次”；未关联员工且没有任何本人班次的新注册用户应直接视为无有效班次，不能因全店班次而看到其他员工指标；已关联员工即使当前无可操作班次，仍保留合法的全店监控展示语义
- `src/purely-profit/operations/spaces/*`：空间域已拆成 `read/write/dashboard/reservations/sessions` 与多个 `space-session-*` 协作 service
- `src/purely-profit/stores/wechat-pay-encryption.service.ts`：门店微信支付敏感配置已抽成 AES-GCM 加解密 service
- `src/purely-pulse/membership/*`：Pulse 会员域已拆成 admin controller、member/sub-account read、membership/points/beans/sub-account mutation、mutation state 与 query helper

## 核心约定

### 启动层

以 `src/bootstrap/bootstrap.ts` 为准，`src/main.ts` 只保留入口导出与 CLI 启动：

- 全局参数校验使用 `ValidationPipe`
- 当前配置：`whitelist: true`、`forbidNonWhitelisted: true`、`transform: true`、`enableImplicitConversion: true`
- HTTP 适配器使用 `FastifyAdapter`，并统一配置 `logger`、`bodyLimit`、`keepAliveTimeout`、`requestTimeout`、`trustProxy`、`ignoreTrailingSlash`、`connectionTimeout`
- 请求 ID 通过 `createRequestIdGenerator()` 生成，优先复用上游 `X-Request-Id`
- 会按路由给 `/club/payments/wechat/callback` 注入 `rawBody`，只在微信回调验签链路保留原始请求体
- Fastify 回复序列化已统一做 BigInt / Decimal 安全转换，避免 Prisma 聚合结果直接触发 500
- 全局前缀：`api`
- CORS 来源由 `app.corsOrigin` 控制，支持 `*` 或逗号分隔白名单
- HTTP 观测由 `setupHttpObservability()` 挂载，慢请求阈值受 `app.slowRequestThresholdMs` 控制
- Swagger 由 `app.swaggerEnabled` 控制，默认生产关闭、非生产开启，并会按环境过滤手动确认支付等调试接口
- 非生产可按配置自动清理占用端口、自动偏移端口；生产环境会通过 `validateProductionConfiguration()` 拦截不安全配置
- 启动完成后统一启用 `app.enableShutdownHooks()`，确保优雅关闭

经验规则：

- 与所有接口都相关的能力优先放 `bootstrap/*`
- 只影响单一业务域的能力放对应模块内
- 不要在 controller 重复实现全局校验、Swagger、慢日志等能力

### 配置

环境变量统一在 `src/config/configuration.ts` 映射，然后通过 `ConfigService` 读取。

当前常见配置分组：

- `port`、`nodeEnv`
- `app.corsOrigin`、`app.swaggerEnabled`、`app.logEnabled`
- `app.httpKeepAliveTimeoutMs`、`app.httpRequestTimeoutMs`、`app.httpBodyLimitBytes`
- `app.portAutoTerminateEnabled`、`app.portAutoShiftEnabled`、`app.portAutoShiftMaxOffset`
- `app.slowRequestLogEnabled`、`app.slowRequestThresholdMs`、`app.slowQueryLogEnabled`、`app.slowRedisLogEnabled`
- `app.defaultPageSize`、`app.maxPageSize`
- `app.cachePrewarm*`、`app.spaceAutoCheckout*`
- `app.throttleTtlSeconds`、`app.throttleLimit`
- `database.url`、`database.poolMax`、`database.poolMin`、`database.statementTimeoutMs`、`database.pgMaxConnections`
- `redis.host`、`redis.port`、`redis.password`、`redis.db`、`redis.connectTimeoutMs`、`redis.commandTimeoutMs`
- `jwt.secret`、`jwt.expiresIn`
- `auth.passwordResetCodeTtlSeconds`、`auth.registerCodeTtlSeconds`、`auth.smsSendCooldownSeconds`、`auth.adminLoginAlias`、`auth.adminLoginPhone`
- `pulse.devAccountEmails`
- `club.manualConfirmPaidEnabled`
- `wechat.*`

约定：

- 新增配置先补 `configuration.ts`
- 业务代码统一通过 `config.get()` 读取，不直接读 `process.env`
- `.env.example` 同步补示例值
- 与分页、慢请求、环境开关相关的魔法数字优先收敛到配置

### 模块组织

新增业务模块优先沿用当前层级，不要回退到旧的 `src/<module>` 平铺结构。

推荐结构：

```text
src/purely-profit/<domain>/<module>/
  <module>.module.ts
  <module>.controller.ts
  <module>.service.ts
  dto/
  guards/
  strategies/
  *.types.ts
  *.utils.ts
  *.mapper.ts
  *.constants.ts
```

```text
src/purely-pulse/<domain>/
  <domain>.module.ts
  <domain>.controller.ts
  <domain>.service.ts
  dto/
  *.types.ts
  *.utils.ts
```

边界原则：

- `module`：依赖装配
- `controller`：路由、参数接收、guard、swagger 注解
- `service`：业务逻辑、数据库读写、缓存协作
- `dto`：参数类型与校验规则
- `guards`：权限 / 认证入口控制
- `strategies`：Passport 策略实现
- `*.types.ts` / `*.utils.ts` / `*.constants.ts` / `*.mapper.ts`：承接局部类型、纯函数、常量、映射逻辑

实践建议：

- 不要再把新模块放回旧的 `src/auth/*`、`src/member/*`、`src/operations/*` 顶层路径
- `purely-profit` 通常先按业务域再按子模块细分，例如 `member/members`、`operations/spaces`
- `purely-profit/auth` 这类横切域，优先按职责拆 `lookup/membership/authentication/password/profile/session` 等 service，不要让 `AuthService` 回到巨石状态
- `purely-profit/marketing` 优先按 overview/customers/transactions/promotions/products/categories 分 controller 与 facade，`marketing.controller.ts`、`marketing.service.ts` 可仅作为 barrel 导出层
- `purely-profit/finance` 优先按 account/cash-flow/overview/reconciliation/report 拆 DTO、domain、service helper，不要把所有列表查询参数继续塞回一个 query dto
- `purely-pulse` 多模块共享目标门店语义时，优先复用 `pulse-store-context.service.ts`
- `purely-pulse/membership` 新增开发者管理能力时，优先判断属于 read、query、mutation state 还是某个具体 mutation service
- 周期性后台任务不要再直接用 `setInterval` 挂在业务 service；优先放 `src/queue/*`，用 BullMQ processor + scheduler 承接
- `operations/spaces` 这类复杂域继续沿用 `spaces-write`、`space-dashboard`、`space-reservations`、`space-session-*` 这类协作拆分
- 交班页班次解析继续由 `handover-page-shift.service.ts` 统一编排：`operationShiftRecord` 只用于当前用户可操作性与交班完成状态，`shiftRecord` 用于展示；判断“已交班且无后续班次”时，收银员优先以自己的最后班次作为基准，老板/经理按全店查找后续班次，避免把全店当前班次误当作收银员的基准
- 判断交班页是否无有效班次时，若用户没有 `linkedEmployeeId`、没有可操作班次且没有本人精确班次，应立即返回无有效班次；不要把未排班的新注册用户提升为可查看全店班次。该短路不适用于已关联员工的合法监控场景
- 数据库设计不要只围绕当前创建接口思考；第一次设计表结构时就要按未来列表、筛选、排序、聚合、导出、权限隔离、软删除、缓存失效与报表统计的压力反推字段与索引

### Controller 与 DTO

Controller 约定：

- 使用 `@Controller()`、`@Get()`、`@Post()`、`@Patch()`、`@Delete()`
- 参数优先使用 `@Body()`、`@Param()`、`@Query()`、`@Req()`；登录态用户优先通过 `@CurrentUser()` 等 decorator 获取，不要在 controller 手动解 request
- 需要鉴权时用 `@UseGuards(JwtAuthGuard)`，能力校验优先叠加 `PermissionsGuard` / `RequirePermissions`
- Swagger 注解最少补齐 `@ApiTags`、`@ApiOperation`、`@ApiOkResponse()` / `@ApiCreatedResponse()`
- Bearer 接口补 `@ApiBearerAuth()`
- `summary` / `description` 里明确当前接口属于 `purely-profit` 还是 `purely-pulse`
- 当一个业务域 controller 过多时，可保留 barrel 文件统一导出，真实实现落在细分 controller 文件中

DTO 约定：

- DTO 类承担 controller 边界类型声明和校验规则
- 使用 `class-validator` 与 `@ApiProperty()` / `@ApiPropertyOptional()`
- 错误文案直接写中文
- DTO 优先停留在 controller 边界；进入 service 后，如需复杂类型推导、raw SQL 组装或 mapper 流转，优先改用局部 `interface` / `type`
- 列表 query、request body、response view model 已在 finance、marketing、spaces 等域按用途细拆；新增接口优先补专属 DTO，不要复用语义不准的旧 DTO
- 共享常量、联合类型、纯 helper 优先放无装饰器的 `*.utils.ts` / `*.types.ts` / `*.constants.ts`

### Auth 与 Access

Auth 基线：

- 注册主链路：手机号 + 短信验证码 + 密码
- 注册验证码、找回密码验证码存储在 Redis，TTL 由 `auth.*` 配置驱动
- 登录支持 `phone` 与 `account`，其中 `account` 当前兼容 `admin`
- 密码统一使用 `bcryptjs`
- `AuthModule` 当前以 `AuthService` 编排，底下拆分 `AuthAccountLookupService`、`AuthAccountMembershipService`、`AuthAuthenticationService`、`AuthPasswordService`、`AuthProfileService`、`AuthSessionService`
- JWT 在 service 内统一签发
- JWT payload 保持精简，由 `JwtStrategy.validate()` 再查库补齐核心身份信息
- `JwtAuthGuard` 保护登录态接口
- `AuthService.getProfile()` 兼容前端 `me/profile`
- 需要当前登录人、请求编号、审计上下文时，优先复用 `CurrentUser`、`RequestId`、`RequestAuditContext` 等 decorator

Access 基线：

- `src/purely-profit/access-control/*`：权限声明、权限判断、guard 协作
- `src/purely-profit/commerce/commerce-access.service.ts`：老板端可查看 / 可操作门店解析
- `src/purely-profit/member/members-access.service.ts`：会员域可见门店与操作员身份映射
- `src/purely-pulse/pulse-store-context.service.ts`：Pulse 目标门店上下文
- `purely-pulse` 要明确区分“当前登录开发者”和“当前被观察目标门店”

子账号与 capability 快照：

- `JwtStrategy` 会联合 `staffs`、`employees`、`store_sub_accounts` 构建 `currentMembership`，并把身份归一成 `owner` / `staff` / `sub_account`
- `AccessControlService.buildMembershipContext()` 是登录态权限快照入口；子账号权限不要在 controller 或页面专属 service 里手写拼装
- 子账号当前基于 `cashier` / `manager` / `finance` 三种角色发放默认权限，并额外受 `subAccountStatus`、`subAccountAssigned`、`canAccessHome`、`canUseHandover` 约束
- `SubjectCapabilityService.buildSnapshot()` 是首页模块与 capability 字段事实来源；`auth capability`、`profile`、`dashboard-home` 都应复用同一套快照语义
- 若数据库还未完成 `store_sub_accounts` / `can_access_home` / `can_use_handover` 迁移，`JwtStrategy` 会拒绝登录，避免回退到过期权限模型

### Prisma、Redis 与缓存

Prisma：

- 业务 service 直接注入 `PrismaService`
- 所有模型以 `prisma/schema.prisma` 为单一事实来源
- 新增表/字段时，先改 schema，再迁移，再补 service / controller
- 复杂查询可用 Prisma + raw SQL，但要先本地建模 row type
- 事务优先返回命名对象，不要优先返回裸数组元组

Redis：

- 优先复用 `RedisService` 现有封装
- 只有确实需要原生能力时再用 `getClient()`
- key 命名带业务前缀
- TTL 只在业务语义明确时传入
- dashboard、finance、marketing、Pulse session、members、costs 这类衍生缓存优先通过 `CacheInvalidatorService` 失效
- 新增热点缓存时，同时判断是否需要补 `CachePrewarmCycleService`、BullMQ 调度链路与 `observability` 摘要聚合
- 需要客户端侧短缓存的纯读接口，优先评估 `@CacheControl()` 是否比单纯 Redis 更合适
- Redis 是加速层，不是唯一数据源

## 新增接口推荐流程

按下面顺序实现，通常返工最少：

1. 先确认属于 `purely-profit` 还是 `purely-pulse`
2. 再确认落在哪个业务域 / 子模块
3. 没有模块时先补 `<module>.module.ts`
4. 先写 DTO 与校验规则
5. 再写 service 里的业务逻辑与类型建模
6. 再写 controller 路由与 Swagger 注解
7. 需要鉴权时接 `JwtAuthGuard`
8. 需要资源权限或可见门店判断时，优先接入 access / context service
9. 需要持久化时接 Prisma
10. 需要缓存时接 Redis、`CacheInvalidatorService`，必要时补 `CachePrewarmCycleService` / BullMQ 预热调度
11. 新增环境变量时同步更新 `configuration.ts` 与 `.env.example`

## 快速边界判断

遇到代码该放哪时，优先按下面规则：

- 请求入口和注解：放 `controller`
- 业务规则、数据库写入、token 签发：放 `service`
- 参数结构和字段校验：放 `dto`
- service 内部消费类型、raw SQL row、聚合结果类型：放局部 `interface` / `type`
- 共享常量、联合类型、纯 helper：放 `*.utils.ts` / `*.types.ts` / `*.constants.ts`
- 对数据库记录做稳定响应映射：放 `*.mapper.ts`
- 登录态保护：放 `guards` / `strategies`
- 门店访问范围、权限上下文、目标对象解析：优先放 access / context service
- 周期性异步任务：放 `queue` processor / scheduler，不要直接塞进 controller 或普通 service 的 `setInterval`
- 金额换算与聚合：优先放 `shared/money.utils.ts` 的 `Money` 值对象链路
- 大批量异步 fan-out：优先复用 `shared/concurrency.utils.ts`
- 基础设施连接：放 `prisma`、`redis`、`config`
- 全局能力：放 `bootstrap/*`

## 质量基线

新增代码时尽量保持：

- 命名直接，语义明确
- 中文错误文案对用户友好
- DTO 先行，但 DTO 主要用于 controller 边界，不默认承担整条 service 类型链
- 认证、权限、数据库、缓存职责分明
- 不在 controller 堆业务逻辑
- 不直接使用 `process.env`
- 不绕过 `PrismaService` 与 `RedisService` 的现有封装
- raw SQL row、事务返回值、分页聚合结果优先本地建模
- 老板端“当前门店”与 Pulse “目标门店”必须分开建模

## 参考文件

实现新功能时，优先参考这些文件：

- 启动与配置：`src/main.ts`、`src/bootstrap/bootstrap.ts`、`src/bootstrap/production-config.utils.ts`、`src/bootstrap/port.utils.ts`、`src/app.module.ts`、`src/config/configuration.ts`
- 基础设施：`src/prisma/prisma.service.ts`、`src/redis/redis.service.ts`、`src/redis/cache-invalidator.service.ts`、`src/redis/cache-prewarm-cycle.service.ts`、`src/queue/queue.module.ts`、`src/queue/queue-scheduler.service.ts`、`src/queue/cache-prewarm.processor.ts`
- shared：`src/shared/cache-control.decorator.ts`、`src/shared/cache-control.interceptor.ts`、`src/shared/money.utils.ts`、`src/shared/concurrency.utils.ts`、`src/shared/password-policy.utils.ts`
- observability：`src/observability/runtime-metrics.ts`、`src/observability/runtime-metrics.summary.ts`、`src/observability/metrics-summary.protocol.ts`
- auth / access：`src/purely-profit/auth/auth.module.ts`、`src/purely-profit/auth/auth.service.ts`、`src/purely-profit/auth/auth-account-lookup.service.ts`、`src/purely-profit/auth/auth-account-membership.service.ts`、`src/purely-profit/auth/strategies/jwt.strategy.ts`、`src/purely-profit/access-control/access-control.service.ts`、`src/purely-profit/access-control/subject-capability.service.ts`
- membership / dashboard：`src/purely-profit/member/platform-membership/platform-membership.service.ts`、`src/purely-profit/member/platform-membership/platform-membership-access.service.ts`、`src/purely-profit/dashboard/dashboard-home/dashboard-home.service.ts`
- finance / marketing：`src/purely-profit/finance/finance.controller.ts`、`src/purely-profit/finance/finance.service.ts`、`src/purely-profit/marketing/marketing.module.ts`、`src/purely-profit/marketing/marketing-overview.controller.ts`、`src/purely-profit/marketing/marketing-customers.facade.service.ts`
- staff / operations：`src/purely-profit/staff/employees/employees.controller.ts`、`src/purely-profit/staff/employees/employees-shift-definition.service.ts`、`src/purely-profit/operations/handover/handover.shared.ts`、`src/purely-profit/operations/handover/handover-page-shift.service.ts`、`src/purely-profit/operations/handover/handover-page-shift-selector.service.ts`、`src/purely-profit/operations/handover/handover-page-shift-record.service.ts`、`src/purely-profit/operations/spaces/spaces.module.ts`、`src/purely-profit/operations/spaces/space-session-read.service.ts`、`src/purely-profit/operations/spaces/space-session-settlement.service.ts`
- club / pulse：`src/purely-profit/stores/wechat-pay-encryption.service.ts`、`src/purely-pulse/session/session.controller.ts`、`src/purely-pulse/pulse-store-context.service.ts`、`src/purely-pulse/membership/membership-admin.controller.ts`、`src/purely-pulse/membership/membership-admin-query.service.ts`、`src/purely-pulse/membership-settings/membership-settings.service.ts`
- 数据基线：`prisma/schema.prisma`、`.env.example`

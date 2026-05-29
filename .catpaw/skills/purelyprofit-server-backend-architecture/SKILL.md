---
name: purelyprofit-server-backend-architecture
description: purelyprofit-server 是 purelyProfit 业务的后端接口仓库。该 skill 说明 purely-profit 与 purely-pulse 的产品线语义、会员配置层与运行态边界、NestJS + Fastify 启动链路、Config/Prisma/Redis 基础设施、JWT 鉴权、Swagger 与 DTO 规范、缓存失效与预热接入方式、operations/spaces 模块拆分方式，以及新增接口的落位流程。适用于理解仓库结构、开发或修改 purelyProfit / purelyPulse 接口、接入数据库或缓存、处理会员权益限制、扩展空间域能力，并保持代码风格与目录约定一致时使用。
---

# purelyprofit-server 后端架构指南

## 什么时候用

遇到下面场景时优先使用：

- 在 `purelyprofit-server` 中新增、修改、排查 `purely-profit` / `purely-pulse` 接口
- 需要判断代码该放在哪个模块、目录或 service
- 需要沿用现有 DTO、Swagger、JWT、Prisma、Redis 约定
- 需要处理会员套餐配置、运行态权益限制、目标门店上下文
- 需要接入缓存失效、缓存预热、运行态观测
- 需要扩展 `operations/spaces` 这类已拆分的复杂业务域

## 默认工作假设

默认把 `purelyprofit-server` 视为 purelyProfit 业务后端。

除非用户明确说明是在调整脚手架、基础设施或工程配置，否则优先按下面方式理解需求：

- 目标通常是新增、修改或排查 `purely-profit` / `purely-pulse` 相关接口
- 优先关注 DTO 校验、鉴权、数据库读写、缓存协作、响应字段
- 涉及字段、状态、筛选项、展示结构、业务流程时，先对齐前端页面、请求层、types、表单与交互
- 新需求优先落到现有业务模块，不要写成一次性脚本或临时逻辑
- 输出与实现都保持“后端接口开发”语境，避免误偏到前端实现
- 如果字段含义、业务语义或交互意图不明确，先确认再继续

## 产品线与业务语义

### 产品线视角

- `src/purely-profit/*`：老板/商家自己使用系统，关注门店、员工、会员、营销、财务、空间、经营数据
- `src/purely-pulse/*`：开发者/平台运营观察商家，关注目标商家、门店、区域、入驻、会员、推广、收益、分析
- 页面联调或 `page-check` 场景里，前端通常是 `purelyProfit`，但后端仍要先判断链路属于 `purely-profit` 还是 `purely-pulse`
- `purely-pulse` 默认要先确认“目标商家/目标门店/目标区域”，不要默认绑定当前商家自己
- 除非用户明确要求模拟老板视角，否则不要把 `purely-pulse` 写成老板端自助接口

### `member` 与 `marketing` 边界

- `member`：商家老板向平台购买的会员服务，属于“平台 ↔ 商家老板”关系
- `marketing`：商家运营自己的顾客，属于“商家 ↔ 顾客”关系
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

- 写后端接口前先看前端页面、hooks、types、表单字段与展示逻辑
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

当前仓库以“基础设施模块 + 双产品线业务模块”组织：

- `src/main.ts`：应用启动、全局校验、全局前缀、CORS、慢请求日志、Swagger
- `src/app.module.ts`：根模块装配，统一挂载 `purely-profit` 与 `purely-pulse`
- `src/config/*`：环境变量映射
- `src/prisma/*`：数据库客户端与生命周期管理
- `src/redis/*`：Redis 客户端、缓存失效、缓存预热
- `src/observability/*`：运行态指标、摘要卡片、缓存预热观测上下文
- `src/purely-profit/*`：老板端/商家端业务
- `src/purely-pulse/*`：开发者/平台观察端业务
- `prisma/schema.prisma`：数据库模型事实来源
- `.env.example`：环境变量示例

代表性业务域：

- Profit：`access-control`、`auth`、`commerce`、`dashboard`、`finance`、`goods`、`marketing`、`member`、`notifications`、`operations`、`staff`、`stores`、`subscriptions`
- Pulse：`dashboard`、`dev-mode`、`growth`、`membership`、`membership-settings`、`onboarding`、`session`、`pulse-store-context.*`

### 最近新增的项目能力

近期扩展时，把下面这些能力也当成当前事实基线：

- `src/redis/cache-invalidator.service.ts`：统一承接 dashboard、finance、marketing、Pulse session 等衍生缓存失效
- `src/redis/cache-prewarm.service.ts`：定时预热首页、经营分析、财务概览等热点缓存
- `src/observability/*`：已有 cache-prewarm 指标与摘要链路，新增预热类别时要同步考虑观测聚合
- `src/purely-profit/operations/spaces/*`：空间域已拆成 `read/write/dashboard/reservations/sessions` 等协作 service

## 核心约定

### 启动层

以 `src/main.ts` 为准：

- 全局参数校验使用 `ValidationPipe`
- 当前配置：`whitelist: true`、`forbidNonWhitelisted: true`、`transform: true`
- 全局前缀：`api`
- CORS 来源由 `app.corsOrigin` 控制，支持 `*` 或逗号分隔白名单
- 慢请求日志由 `app.slowRequestLogEnabled` 与 `app.slowRequestThresholdMs` 控制
- Swagger 由 `app.swaggerEnabled` 控制，默认生产关闭、非生产开启
- 端口通过 `ConfigService` 读取，默认 `3000`
- HTTP 适配器使用 `FastifyAdapter`
- `FastifyAdapter` logger 开关由 `app.logEnabled` 决定

经验规则：

- 与所有接口都相关的能力优先放 `main.ts`
- 只影响单一业务域的能力放对应模块内
- 不要在 controller 重复实现全局校验、Swagger、慢日志等能力

### 配置

环境变量统一在 `src/config/configuration.ts` 映射，然后通过 `ConfigService` 读取。

当前常见配置分组：

- `port`、`nodeEnv`
- `app.corsOrigin`、`app.swaggerEnabled`、`app.logEnabled`
- `app.slowRequestLogEnabled`、`app.slowRequestThresholdMs`
- `app.defaultPageSize`、`app.maxPageSize`
- `database.url`
- `redis.host`、`redis.port`、`redis.password`、`redis.db`
- `jwt.secret`、`jwt.expiresIn`
- `auth.passwordResetCodeTtlSeconds`、`auth.registerCodeTtlSeconds`
- `pulse.devAccountEmails`

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
- `purely-pulse` 多模块共享目标门店语义时，优先复用 `pulse-store-context.service.ts`
- `operations/spaces` 这类复杂域继续沿用 `spaces-write`、`space-dashboard`、`space-reservations`、`space-sessions` 这类协作拆分

### Controller 与 DTO

Controller 约定：

- 使用 `@Controller()`、`@Get()`、`@Post()`、`@Patch()`、`@Delete()`
- 参数优先使用 `@Body()`、`@Param()`、`@Query()`、`@Req()`
- 需要鉴权时用 `@UseGuards(JwtAuthGuard)`
- Swagger 注解最少补齐 `@ApiTags`、`@ApiOperation`、`@ApiOkResponse()` / `@ApiCreatedResponse()`
- Bearer 接口补 `@ApiBearerAuth()`
- `summary` / `description` 里明确当前接口属于 `purely-profit` 还是 `purely-pulse`

DTO 约定：

- DTO 类承担 controller 边界类型声明和校验规则
- 使用 `class-validator` 与 `@ApiProperty()` / `@ApiPropertyOptional()`
- 错误文案直接写中文
- DTO 优先停留在 controller 边界；进入 service 后，如需复杂类型推导、raw SQL 组装或 mapper 流转，优先改用局部 `interface` / `type`
- 共享常量、联合类型、纯 helper 优先放无装饰器的 `*.utils.ts` / `*.types.ts` / `*.constants.ts`

### Auth 与 Access

Auth 基线：

- 注册主链路：手机号 + 短信验证码 + 密码
- 注册验证码、找回密码验证码存储在 Redis，TTL 由 `auth.*` 配置驱动
- 登录支持 `phone` 与 `account`，其中 `account` 当前兼容 `admin`
- 密码统一使用 `bcryptjs`
- JWT 在 service 内统一签发
- JWT payload 保持精简，由 `JwtStrategy.validate()` 再查库补齐核心身份信息
- `JwtAuthGuard` 保护登录态接口
- `AuthService.getProfile()` 兼容前端 `me/profile`

Access 基线：

- `src/purely-profit/access-control/*`：权限声明、权限判断、guard 协作
- `src/purely-profit/commerce/commerce-access.service.ts`：老板端可查看 / 可操作门店解析
- `src/purely-profit/member/members-access.service.ts`：会员域可见门店与操作员身份映射
- `src/purely-pulse/pulse-store-context.service.ts`：Pulse 目标门店上下文
- `purely-pulse` 要明确区分“当前登录开发者”和“当前被观察目标门店”

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
- dashboard、finance、marketing、Pulse session 这类衍生缓存优先通过 `CacheInvalidatorService` 失效
- 新增热点缓存时，同时判断是否需要补 `CachePrewarmService` 与 `observability` 摘要聚合
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
10. 需要缓存时接 Redis、`CacheInvalidatorService`、必要时接 `CachePrewarmService`
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
- 基础设施连接：放 `prisma`、`redis`、`config`
- 全局能力：放 `main.ts`

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

- `src/main.ts`
- `src/app.module.ts`
- `src/config/configuration.ts`
- `src/prisma/prisma.service.ts`
- `src/redis/redis.service.ts`
- `src/redis/cache-invalidator.service.ts`
- `src/redis/cache-prewarm.service.ts`
- `src/observability/runtime-metrics.ts`
- `src/purely-profit/auth/auth.module.ts`
- `src/purely-profit/auth/auth.controller.ts`
- `src/purely-profit/auth/auth.service.ts`
- `src/purely-profit/auth/strategies/jwt.strategy.ts`
- `src/purely-profit/member/platform-membership/platform-membership.service.ts`
- `src/purely-profit/member/platform-membership/platform-membership-access.service.ts`
- `src/purely-profit/operations/spaces/spaces.service.ts`
- `src/purely-profit/operations/spaces/space-reservations.service.ts`
- `src/purely-profit/operations/spaces/space-sessions.service.ts`
- `src/purely-pulse/session/session.controller.ts`
- `src/purely-pulse/pulse-store-context.service.ts`
- `src/purely-pulse/membership/membership.service.ts`
- `src/purely-pulse/membership-settings/membership-settings.service.ts`
- `prisma/schema.prisma`
- `.env.example`

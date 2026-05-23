---
name: purelyprofit-server-backend-architecture
description: purelyprofit-server 是 purelyProfit 业务的后端接口仓库，默认任务优先按“开发、修改、扩展 purelyProfit / purelyPulse 相关接口”来理解。该 skill 提供 NestJS + Fastify 启动链路、Config 配置读取、Prisma/Redis 基础设施、JWT 认证、Swagger 注解、DTO 校验、双产品线模块组织、会员套餐配置与会员权益接入方式，以及新增接口流程约定。适用于：理解当前后端仓库结构、实现 purelyProfit 或 purelyPulse 业务接口、扩展认证与用户能力、接入数据库与缓存、处理会员套餐配置/权益限制，并保持代码风格与现有目录约定一致时使用。
---

# purelyprofit-server 后端架构指南

## 默认工作假设

默认把 `purelyprofit-server` 视为 purelyProfit 业务的后端接口仓库。

除非用户明确说明是在调整脚手架、基础设施或工程配置，否则优先按下面方式理解需求：

- 主要目标是新增、修改或排查 `purely-profit` / `purely-pulse` 相关接口
- 优先考虑接口入参/出参、DTO 校验、鉴权、数据库读写、缓存协作
- 涉及字段、状态、筛选项、展示结构、业务流程时，默认先对齐前端页面、请求层、types、表单与交互，而不是凭空新造一套模型
- 新需求优先落到现有业务模块，不要写成一次性脚本或临时逻辑
- 输出方案时保持“后端接口开发”语境，避免偏到前端页面实现
- 如果字段含义、业务语义或前端交互意图不明确，先向用户确认，再继续实现

## 产品线视角辨析

当前仓库至少包含两条产品线语义，做接口设计前必须先判断当前任务属于哪一条视角，避免模块写对了、产品视角却写反：

- `src/purely-profit/*`：默认按“商家/老板自己使用系统”的后端视角理解，重点是商家查看和操作自己的门店、会员、员工、营销、财务、空间、经营数据等能力
- `src/purely-pulse/*`：默认按“开发者/平台运营查看商家”的后端视角理解，重点是开发者查看商家、门店、区域、入驻、会员、推广、收益、分析等数据
- 做页面联调、页面验收、接口对接检查或 `page-check` 时，前端默认对应 `purelyProfit`，但后端仍必须先判断链路属于 `src/purely-profit/*` 还是 `src/purely-pulse/*`
- 做前后端联调检查时，必须同时看前端页面/路由/请求层/types/form schema，与本仓库后端 controller/DTO/service/数据库实现，不能只看单侧代码
- 如果任务落在 `purely-pulse`，默认先确认接口是在“查看哪个目标商家/门店/区域”，而不是默认绑定当前商家自己
- 除非用户明确要求做“商家模拟视角”或“开发者专属测试模式”，否则不要把 `purely-pulse` 误写成 `purely-profit` 风格的自助老板端接口

## 关键业务语义辨析

在 purelyProfit 里，`member` 和 `marketing` 不是一类对象，默认按下面语义理解，避免混淆：

- `member`：指商家老板自己向平台购买的会员服务，属于“平台 ↔ 商家老板”关系
- `marketing`：指商家使用系统运营自己的顾客，属于“商家 ↔ 商家顾客”关系
- 前端 `pages/main/member` 里的会员、订单、积分、推广、合伙人、纯利豆、提现，默认理解为“商家老板自己的平台会员中心”
- 前端 `marketing` 里的客户、储值、营销触达、顾客标签、顾客会员，默认理解为“商家自己的客人/顾客运营”

落位判断：

- 如果需求是“商家老板开通月度/季度/年度会员、续费、支付、平台积分、推广返利、合伙人、纯利豆、提现”，不要落到顾客 CRM 式 `members` 档案模型里，应优先按平台会员中心/订阅/账单语义设计
- 如果需求是“商家管理自己的客人资料、等级、标签、储值、消费记录、顾客积分、营销人群”，应优先归到 `marketing` / `customers` / 顾客会员语义，而不是商家老板自己的平台会员语义
- 当用户只说“member”时，先结合前端页面或上下文判断究竟是“商家老板自己的平台会员”还是“商家自己的顾客会员”
- 如果上下文明确提到前端 `pages/main/member`，默认按“商家老板自己的平台会员中心”理解，不要误写成门店顾客会员档案接口

## 会员体系与套餐配置语义

最近这轮迭代里，平台会员中心已经拆成“配置层”和“运行态权益层”两套模型，开发时不要混用：

- `prisma/schema.prisma` 中 `MembershipPlanSettingId` 包含 `monthly`、`quarterly`、`yearly`、`lifetime`，对应 `membership_plan_settings` 表，用来维护 Pulse 后台可编辑的套餐配置
- `src/purely-pulse/membership-settings/*` 是 Pulse 开发者/平台运营维护套餐价格与永久会员有效期的配置模块，不是老板端自助购买入口
- `StoreMembershipProfile.currentPlanId` 使用的是 `MembershipPlanCycle`，当前只包含 `monthly`、`quarterly`、`yearly`，表示门店运行态会员档案
- “永久会员”在运行态不要直接理解成 `currentPlanId = 'lifetime'`；当前实现里更接近“特殊的长期有效会员状态”，需要结合 `startsAt` / `expiresAt` 以及访问控制服务的解析逻辑来理解
- 会员权益判断优先看 `src/purely-profit/member/platform-membership/platform-membership-access.service.ts`，这里统一处理商品数、员工数、空间数、历史数据窗口、财务/营销/导出开关等限制
- 如果新增会员权益门槛、套餐差异或功能开关，先判断应该改“套餐配置表”“运行态档案”还是“权益访问控制 service”，不要只改其中一层

当前会员中心的落位建议：

- Pulse 侧“平台配置/开发者管理商家会员档案”优先落在 `src/purely-pulse/membership*`
- Profit 侧“老板端功能是否可用/配额是否足够”优先通过 `PlatformMembershipAccessService` 接入
- 套餐价格、默认时长、永久会员默认有效期之类的配置，优先以 `membership_plan_settings` 为事实来源
- 门店当前处于什么套餐、是否过期、还剩多少可用积分/纯利豆，优先以 `store_membership_profiles`、订单、积分日志等运行态数据为事实来源

## 前后端字段对齐要求

当需求和现有前端页面、前端模块、前端类型定义有关时，默认遵守下面规则：

- 写后端接口前，先看前端实际页面、hooks、types、表单字段和展示逻辑，再决定 DTO、返回字段和业务语义
- 后端字段命名、枚举值、可选字段、时间字段、金额单位、状态语义，默认优先和前端现有定义保持一致
- 如果前端已有明确类型定义或页面数据结构，例如 `*.types.ts`、页面 view model、表单 schema、列表项结构，后端应尽量按这些结构对齐
- 不要在没有前端依据的情况下随意新增前端暂时不存在的字段、筛选项、状态枚举或业务概念，除非用户明确要求先做后端预埋
- 如果发现前端字段设计明显不合理，也先基于前端现状完成对齐，并在输出中指出差异与建议，而不是直接擅自改成另一套模型
- 当用户让你开发某个接口但没有说明字段时，优先先检查前端对应页面需要什么字段，而不是仅凭后端习惯补全
- 只要前端字段含义、业务流程、页面交互、状态流转存在不确定性，就暂停实现并先向用户确认

## 技术栈

- `NestJS 11`
- `Fastify`
- `@nestjs/config`
- `Prisma + PostgreSQL`
- `ioredis`
- `JWT + Passport`
- `Swagger`
- `class-validator + class-transformer`

## 什么时候用这个 skill

遇到下面场景时优先使用：

- 在 `purelyprofit-server` 中新增或修改 `purely-profit` / `purely-pulse` 业务模块、接口、DTO、Guard、Strategy、Service
- 需要理解当前项目的启动方式、配置结构、数据库接入、缓存接入
- 需要沿用现有登录/注册/JWT 鉴权模式
- 需要决定新代码应该放在哪个目录、保持什么边界
- 需要开发或调整 Pulse 会员套餐配置、商家会员档案、会员权益限制
- 需要为接口补 Swagger 注解、参数校验和统一返回节奏

## 当前目录基线

当前仓库的后端结构以“基础设施模块 + 双产品线业务模块”组织：

- `src/main.ts`：应用启动、全局校验、全局前缀、CORS、慢请求日志、Swagger
- `src/app.module.ts`：根模块装配，统一挂载 `purely-profit` 与 `purely-pulse` 模块
- `src/config/*`：环境变量映射
- `src/prisma/*`：数据库客户端与生命周期管理
- `src/redis/*`：Redis 客户端封装
- `src/purely-profit/*`：老板端/商家端业务
- `src/purely-pulse/*`：开发者/平台观察端业务
- `prisma/schema.prisma`：数据库模型唯一事实来源
- `.env.example`：环境变量示例

当前 `src/purely-profit/*` 已有代表性业务域：

- `access-control`
- `auth`
- `commerce`
- `dashboard`
- `finance`
- `goods`
- `marketing`
- `member`
- `notifications`
- `operations`
- `staff`
- `stores`
- `subscriptions`

当前 `src/purely-pulse/*` 已有代表性业务域：

- `dashboard`
- `dev-mode`
- `growth`
- `membership`
- `membership-settings`
- `onboarding`
- `session`
- `pulse-store-context.*`

## 启动层约定

以 `src/main.ts` 为准，新增全局能力时先判断应该放在启动层还是模块内：

- 全局参数校验使用 `ValidationPipe`
- 当前配置为：`whitelist: true`、`forbidNonWhitelisted: true`、`transform: true`
- 应用统一使用全局前缀 `api`
- CORS 来源由 `app.corsOrigin` 控制，支持 `*` 或逗号分隔白名单
- 慢请求日志由 `app.slowRequestLogEnabled` 与 `app.slowRequestThresholdMs` 控制
- Swagger 是否启用由 `app.swaggerEnabled` 控制，默认生产环境关闭、非生产开启
- 应用通过 `ConfigService` 读取端口，默认 `3000`
- HTTP 适配器使用 `FastifyAdapter`
- `FastifyAdapter` logger 开关由 `app.logEnabled` 决定

经验规则：

- 与所有接口都相关的能力，优先放 `main.ts`
- 只影响单一业务域的能力，放对应模块内
- 不要在 controller 中重复写全局校验逻辑
- 慢日志、全局前缀、Swagger、全局 pipe 这类能力不要散落到业务模块中重复实现

## 配置约定

环境变量统一在 `src/config/configuration.ts` 映射，然后通过 `ConfigService` 读取。

当前配置分组：

- `port`
- `nodeEnv`
- `app.corsOrigin`
- `app.swaggerEnabled`
- `app.logEnabled`
- `app.slowRequestLogEnabled`
- `app.slowRequestThresholdMs`
- `app.defaultPageSize`
- `app.maxPageSize`
- `database.url`
- `redis.host`
- `redis.port`
- `redis.password`
- `redis.db`
- `jwt.secret`
- `jwt.expiresIn`
- `auth.passwordResetCodeTtlSeconds`
- `auth.registerCodeTtlSeconds`
- `pulse.devAccountEmails`

约定：

- 新增配置先补 `configuration.ts`
- 业务代码中优先读取分组后的 key，例如 `config.get<string>('jwt.secret')`
- 除 `configuration.ts` 这类配置入口外，不要在业务代码里直接读取 `process.env`
- `.env.example` 要同步补示例值
- 与分页、慢请求、环境开关相关的魔法数字，优先收敛到 `app.*` 或对应分组配置

## 模块组织规范

新增业务模块优先沿用当前目录层级，而不是回退到旧的 `src/<module>` 平铺结构。

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

或：

```text
src/purely-pulse/<domain>/
  <domain>.module.ts
  <domain>.controller.ts
  <domain>.service.ts
  dto/
  *.types.ts
  *.utils.ts
```

使用原则：

- `module`：只负责依赖装配
- `controller`：只负责路由、参数接收、guard、swagger 注解
- `service`：放业务逻辑、数据库读写、缓存协作
- `dto`：请求参数类型和校验规则
- `guards`：权限/认证入口控制
- `strategies`：Passport 策略实现
- `*.types.ts` / `*.utils.ts` / `*.constants.ts` / `*.mapper.ts`：承接 service 内部类型、纯函数、常量、映射逻辑

实践建议：

- 不要再把新模块放回旧的 `src/auth/*`、`src/member/*`、`src/operations/*` 顶层旧路径
- `purely-profit` 内部通常先按业务域再按子模块细分，例如 `member/members`、`operations/spaces`
- `purely-pulse` 里如果多个模块共享“当前观察目标门店”语义，优先复用 `pulse-store-context.service.ts`，不要各写一套解析逻辑
- 当某模块出现大量计算、聚合、复杂查询时，再考虑拆分子 service / query helper，而不是一开始就过度抽象 repository/domain

## Controller 约定

当前 controller 写法以 `src/purely-profit/auth/auth.controller.ts`、`src/purely-pulse/session/session.controller.ts` 为基线：

- 使用装饰器定义路由：`@Controller()`、`@Get()`、`@Post()`、`@Patch()`、`@Delete()`
- 参数优先使用 `@Body()`、`@Param()`、`@Query()`、`@Req()`
- 需要鉴权的接口用 `@UseGuards(JwtAuthGuard)`
- Swagger 注解优先补齐：`@ApiTags`、`@ApiOperation`、`@ApiOkResponse` / `@ApiCreatedResponse`
- Bearer 接口补 `@ApiBearerAuth()`
- 业务解释写在 `summary` / `description` 时，要明确当前接口属于 `purely-profit` 还是 `purely-pulse` 视角

经验规则：

- controller 不要直接写 Prisma 访问逻辑
- controller 不要堆复杂判断、缓存拼装、密码处理
- controller 可以直接返回 service 结果，但 service 返回值本身要先经过稳定建模；不要把 raw SQL row、DTO class、response DTO 在 controller/service 边界直接混用
- 同一个 controller 同时承担“老板看自己”和“开发者看商家”两套语义时，要优先怀疑模块边界是不是已经跑偏

## DTO 与校验约定

当前 DTO 约定参考 `src/purely-profit/auth/dto/*.dto.ts`、`src/purely-pulse/session/dto/*.dto.ts`：

- DTO 类中同时承担 controller 边界的类型声明和校验规则
- 使用 `class-validator` 注解，例如 `@IsEmail()`、`@IsString()`、`@MinLength()`、`@IsOptional()`、`@Matches()`、`@ValidateIf()`
- Swagger 字段说明使用 `@ApiProperty()` / `@ApiPropertyOptional()`
- 错误文案直接写中文，保持面向业务可读
- DTO class 默认优先停留在 controller 边界；进入 service 后，如果只消费部分字段、需要参与复杂类型推导、raw SQL 组装或 mapper 流转，优先改用 service 内部轻量 `interface` / `type`

建议：

- 新增接口优先先定义 controller 层 DTO，再写 controller/service
- DTO 命名使用 `CreateXxxDto`、`UpdateXxxDto`、`QueryXxxDto`、`LoginDto` 这类明确语义
- 不要把校验写散在 service 里
- 不要把“DTO 先行”误解成“DTO class 一路传到 service 私有方法、raw SQL、response DTO”
- 共享常量、联合类型、纯 helper，优先放到无装饰器的 `*.utils.ts` / `*.types.ts` / `*.constants.ts`

## Auth 约定

当前认证链路以 `src/purely-profit/auth/*` 为核心模板，后续接口优先复用：

- 注册主链路当前按手机号 + 短信验证码 + 密码完成
- 注册验证码、找回密码验证码存储在 Redis，TTL 由 `auth.*` 配置驱动
- 登录支持 `phone` 与 `account` 兼容入参，其中 `account` 目前主要兼容 `admin` 别名登录
- 密码统一使用 `bcryptjs` 哈希与比对
- 发 token：在 service 内统一签发 JWT
- JWT payload 当前最小约定仍是精简字段集，核心识别信息由 `JwtStrategy.validate()` 再查库补齐
- `JwtAuthGuard` 负责保护需要登录态的接口
- `AuthService.getProfile()` 同时返回当前用户、当前门店与权限上下文，兼容前端 `me/profile` 场景

经验规则：

- 不要把明文密码存入数据库
- 登录/注册失败统一抛语义明确的异常，例如 `UnauthorizedException`、`ConflictException`、`BadRequestException`
- JWT payload 保持精简，避免塞大量业务字段
- 需要当前用户时，优先从 guard/strategy 挂载的 user 读取，而不是重新解析 token
- 凡是“当前可查看门店”“当前目标商家”的判断，不要写死在 controller，应交给 access service / context service

## Access / 权限约定

当前仓库已经把“登录认证”和“资源权限”拆成两层：

- `src/purely-profit/auth/*`：解决身份认证与登录态
- `src/purely-profit/access-control/*`：解决权限声明、权限判断与 guard 协作
- `src/purely-profit/commerce/commerce-access.service.ts`：解决老板端业务里的“当前可查看/可操作门店”解析
- `src/purely-profit/member/members-access.service.ts`：解决会员域的可见门店/可操作门店与操作员身份映射
- `src/purely-pulse/pulse-store-context.service.ts`：解决 Pulse 观察态下的目标门店上下文

使用原则：

- 认证 guard、权限 guard、资源访问解析各司其职，不要把三种逻辑揉进一个 service
- 业务 service 里出现 `resolveViewStoreId`、`resolveSingleStoreId`、`findOperatorStaffIdForStore` 这类调用，通常是正常的资源上下文解析，不要强行下沉到 controller
- `purely-pulse` 里优先区分“当前登录开发者”和“当前被观察目标门店”

## Prisma 约定

数据库接入以 `src/prisma/prisma.service.ts` 为基线：

- `PrismaService` 继承 `PrismaClient`
- 使用 `@prisma/adapter-pg` + `pg.Pool`
- 在 `onModuleInit()` 中 `$connect()`
- 在 `onModuleDestroy()` 中 `$disconnect()`
- 连接串来自 `database.url`

使用原则：

- 业务 service 中直接注入 `PrismaService`
- 所有数据库模型以 `prisma/schema.prisma` 为单一事实来源
- 新增表/字段时，先改 schema，再迁移，再补 service/controller
- 表名映射、时间字段命名尽量延续已有风格，如 `created_at`、`updated_at`
- 复杂查询可以使用 Prisma + raw SQL 混合，但要先本地建模 row type，不要直接把 response DTO 当 row type
- 事务优先返回命名对象，而不是裸数组元组

## Redis 约定

缓存接入以 `src/redis/redis.service.ts` 为基线：

- `RedisService` 负责客户端生命周期
- 默认提供 `get`、`set`、`del`、`exists`、`getClient()`
- 配置来自 `redis.*`

使用原则：

- 通用缓存操作优先复用现有封装方法
- 只有确实需要 Redis 原生能力时再使用 `getClient()`
- key 命名建议带业务前缀，如 `auth:token:blacklist:${tokenId}`、`stores:profile:${storeId}`
- TTL 在业务语义明确时再传，不要随意写死
- Redis 通常承担验证码、token version、资料缓存等能力，不要偷偷变成唯一数据源

## Swagger 约定

当前项目已在启动层统一启用 Swagger，所以新增接口时只需要补接口级注解。

建议最少补齐：

- `@ApiTags('<ModuleName>')`
- `@ApiOperation({ summary: '...' })`
- `@ApiOkResponse()` / `@ApiCreatedResponse()`
- 鉴权接口补 `@ApiBearerAuth()`

补充建议：

- 如果接口有明显产品语义差异，在 `description` 中直接写清楚“老板端自助视角”或“开发者观察视角”
- 如果 DTO 已补 `ApiProperty`，Swagger 字段展示会自动更完整
- 对兼容字段、弃用字段、仅开发态字段，要在描述里明确说明，不要让前端靠猜

## 新增接口的推荐流程

按下面顺序实现，减少返工：

1. 先确认功能属于 `purely-profit` 还是 `purely-pulse`
2. 再确认应该落在哪个业务域/子模块
3. 如果没有模块，先补 `<module>.module.ts`
4. 先写 DTO 和校验规则
5. 再写 service 里的业务逻辑与类型建模
6. 再写 controller 路由和 Swagger 注解
7. 需要鉴权时接 `JwtAuthGuard`
8. 需要资源权限或可见门店判断时，优先接入 access/context service
9. 需要持久化时接 Prisma
10. 需要缓存时接 Redis
11. 如果新增环境变量，同步更新 `configuration.ts` 和 `.env.example`

## 新业务模块的落位建议

后续 `purelyprofit-server` 继续扩展时，优先复用当前两层目录：

- `src/purely-profit/<domain>/<module>`：老板端/商家端能力
- `src/purely-pulse/<domain>`：开发者观察端能力

建议：

- 每个业务域先独立成模块，不要继续把逻辑堆进 `auth`
- 模块内先保持 `controller + service + dto + 局部 types/utils/constants/mapper` 的轻量结构
- `operations/spaces` 这类复杂域已经证明：当单 service 过重时，可以拆成多个协作 service 与纯函数常量文件，而不必一下子演化成很重的 DDD 层级
- 新增 `purely-pulse` 功能时，如果核心是“围绕目标门店聚合多个老板端数据”，优先抽公共聚合/上下文服务，而不是直接代理老板端 controller

## 开发时的边界判断

遇到代码该放哪时，优先按下面规则：

- 请求入口和注解：放 `controller`
- 业务规则、数据库写入、token 签发：放 `service`
- 参数结构和字段校验：放 `dto`
- service 内部消费类型、raw SQL row、聚合结果类型：优先放对应 service / mapper 附近的本地 `interface` / `type`
- 共享常量、联合类型、纯 helper：放 `*.utils.ts` / `*.types.ts` / `*.constants.ts`
- 对数据库记录做稳定响应映射：放 `*.mapper.ts`
- 登录态保护：放 `guards` / `strategies`
- 门店访问范围、权限上下文、目标对象解析：优先放 access/context service
- 基础设施连接：放 `prisma`、`redis`、`config`
- 全局能力：放 `main.ts`

## 质量基线

新增代码时尽量保持：

- 命名直接、语义明确
- 中文错误文案对用户友好
- DTO 先行，但 DTO 主要用于 controller 入参边界，不默认承担整条 service 类型链
- 认证、权限、数据库、缓存职责分明
- 不在 controller 堆业务逻辑
- 不直接使用 `process.env`
- 不绕过 `PrismaService` 和 `RedisService` 的现有封装
- raw SQL row、事务返回值、分页聚合结果优先本地建模，不直接借用 response DTO 或被装饰过的 DTO class
- 老板端“当前门店”与 Pulse “目标门店”必须分开建模

## TypeScript / ESLint 总则

和类型、lint 相关的实现，先遵守这几个总则：

- controller DTO 和 service 内部类型分开
- raw SQL row、业务输入、response DTO 分层建模
- 已有泛型时不要重复补同形态 `as`
- 事务优先返回命名对象，不优先返回裸元组
- 遇到 `no-unsafe-*` 先查源头类型污染，不要只在末端补断言
- 共享枚举常量和联合类型不要绑在 decorated DTO 文件里
- 方法如果可以直接 `service.method(...)` 调用，就不要拆实例方法引用

更完整的踩坑记录、症状、排查顺序和推荐写法，查看项目级 skill：`purelyprofit-server-backend-pitfalls`。

遇到下面情况时，不要只参考本 skill，应该同时套用 pitfalls skill：

- service 里要消费 DTO 的部分字段并继续做类型推导
- 要写 `$queryRaw()`、事务、`Promise.all()` 聚合查询
- 要把数据库行映射成接口响应
- lint 已经出现 `no-unsafe-*`、`error typed`、`no-unnecessary-type-assertion`
- 要处理 `purely-pulse` 目标门店语义或跨产品线复用

## 参考文件

实现新功能时，优先参考这些现有文件：

- `src/main.ts`
- `src/app.module.ts`
- `src/config/configuration.ts`
- `src/prisma/prisma.service.ts`
- `src/redis/redis.service.ts`
- `src/purely-profit/auth/auth.module.ts`
- `src/purely-profit/auth/auth.controller.ts`
- `src/purely-profit/auth/auth.service.ts`
- `src/purely-profit/auth/dto/login.dto.ts`
- `src/purely-profit/auth/dto/register.dto.ts`
- `src/purely-profit/auth/strategies/jwt.strategy.ts`
- `src/purely-profit/member/members/members.service.ts`
- `src/purely-profit/member/platform-membership/platform-membership.service.ts`
- `src/purely-profit/member/platform-membership/platform-membership-access.service.ts`
- `src/purely-profit/operations/spaces/spaces.service.ts`
- `src/purely-pulse/session/session.controller.ts`
- `src/purely-pulse/pulse-store-context.service.ts`
- `src/purely-pulse/membership/membership.service.ts`
- `src/purely-pulse/membership-settings/membership-settings.service.ts`
- `prisma/schema.prisma`
- `.env.example`

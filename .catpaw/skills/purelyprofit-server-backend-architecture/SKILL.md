---
name: purelyprofit-server-backend-architecture
description: purelyprofit-server 是 purelyProfit 业务的后端接口仓库，默认任务优先按“开发、修改、扩展 purelyProfit 相关接口”来理解。该 skill 提供 NestJS + Fastify 启动链路、Config 配置读取、Prisma/Redis 基础设施、JWT 认证、Swagger 注解、DTO 校验、模块组织和新增接口流程约定。适用于：理解当前后端仓库结构、实现 purelyProfit 业务接口、扩展认证与用户能力、接入数据库与缓存、保持代码风格与现有目录约定一致时使用。
---

# purelyprofit-server 后端架构指南

## 默认工作假设

默认把 `purelyprofit-server` 视为 purelyProfit 业务的后端接口仓库。

除非用户明确说明是在调整脚手架、基础设施或工程配置，否则优先按下面方式理解需求：

- 主要目标是新增、修改或排查 purelyProfit 相关接口
- 优先考虑接口入参/出参、DTO 校验、鉴权、数据库读写、缓存协作
- 新需求优先落到具体业务模块，而不是写成一次性脚本或临时逻辑
- 输出方案时保持“后端接口开发”语境，避免偏到前端页面实现

## 关键业务语义辨析

在 purelyProfit 里，`member` 和 `marketing` 不是一类对象，默认按下面语义理解，避免混淆：

- `member`：指商家老板自己向平台购买的会员服务，属于“平台 ↔ 商家老板”关系
- `marketing`：指商家使用系统运营自己的顾客，属于“商家 ↔ 商家顾客”关系
- 前端 `pages/main/member` 里的会员、订单、积分、推广、合伙人、纯利豆、提现，默认都理解为“商家老板自己的平台会员中心”
- 前端 `marketing` 里的客户、储值、营销触达、顾客标签、顾客会员，默认理解为“商家自己的客人/顾客运营”

落位判断：

- 如果需求是“商家老板开通月度/季度/年度会员、续费、支付、平台积分、推广返利、合伙人、纯利豆、提现”，不要落到顾客 CRM 式的 `members` 档案模型里，应优先按平台会员中心/订阅/账单语义设计
- 如果需求是“商家管理自己的客人资料、等级、标签、储值、消费记录、顾客积分、营销人群”，应优先归到 `marketing` / `customers` / 顾客会员语义，而不是商家老板自己的平台会员语义
- 当用户只说“member”时，先结合前端页面或上下文判断究竟是“商家老板自己的平台会员”还是“商家自己的顾客会员”
- 如果上下文明确提到前端 `pages/main/member`，默认按“商家老板自己的平台会员中心”理解，不要误写成门店顾客会员档案接口

## 前后端字段对齐要求

当需求和现有前端页面、前端模块、前端类型定义有关时，默认遵守下面规则：

- 写后端接口前，先看前端实际页面、hooks、types、表单字段和展示逻辑，再决定 DTO、返回字段和业务语义
- 后端字段命名、枚举值、可选字段、时间字段、金额单位、状态语义，默认优先和前端现有定义保持一致，避免后端自行发明一套新字段
- 如果前端已有明确的类型定义或页面数据结构，例如 `*.types.ts`、页面 view model、表单 schema、列表项结构，后端应尽量按这些结构对齐
- 不要在没有前端依据的情况下随意新增前端暂时不存在的字段、筛选项、状态枚举或业务概念，除非用户明确要求先做后端预埋
- 如果发现前端字段设计明显不合理，也先基于前端现状完成对齐，并在输出中明确指出差异与建议，而不是直接擅自改成另一套模型
- 当用户让你开发某个接口但没有说明字段时，优先先检查前端对应页面需要什么字段，而不是仅凭后端习惯补全

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

- 在 `purelyprofit-server` 中新增或修改 purelyProfit 业务模块、接口、DTO、Guard、Strategy、Service
- 需要理解当前项目的启动方式、配置结构、数据库接入、缓存接入
- 需要沿用现有登录/注册/JWT 鉴权模式
- 需要决定新代码应该放在哪个目录、保持什么边界
- 需要为接口补 Swagger 注解、参数校验和统一返回节奏

## 当前目录基线

当前仓库的后端结构以“基础设施模块 + 业务模块”组织：

- `src/main.ts`：应用启动、全局校验、CORS、Swagger
- `src/app.module.ts`：根模块装配
- `src/config/*`：环境变量映射
- `src/prisma/*`：数据库客户端与生命周期管理
- `src/redis/*`：Redis 客户端封装
- `src/auth/*`：认证相关 controller/service/dto/guards/strategies
- `prisma/schema.prisma`：数据库模型
- `.env.example`：环境变量示例

## 启动层约定

以 `src/main.ts` 为准，新增全局能力时先判断应该放在启动层还是模块内：

- 全局参数校验使用 `ValidationPipe`
- 当前配置为：`whitelist: true`、`forbidNonWhitelisted: true`、`transform: true`
- 默认已开启 `CORS`
- Swagger 统一在启动时注册
- 应用通过 `ConfigService` 读取端口，默认 `3000`
- HTTP 适配器使用 `FastifyAdapter`

经验规则：

- 与所有接口都相关的能力，优先放 `main.ts`
- 只影响单一业务域的能力，放对应模块内
- 不要在 controller 中重复写全局校验逻辑

## 配置约定

环境变量统一在 `src/config/configuration.ts` 映射，然后通过 `ConfigService` 读取。

当前配置分组：

- `port`
- `nodeEnv`
- `database.url`
- `redis.host`
- `redis.port`
- `redis.password`
- `redis.db`
- `jwt.secret`
- `jwt.expiresIn`

约定：

- 新增配置先补 `configuration.ts`
- 业务代码中优先读取分组后的 key，例如 `config.get<string>('jwt.secret')`
- 不要在业务代码里直接读取 `process.env`
- `.env.example` 要同步补示例值

## 模块组织规范

新增业务模块优先沿用 `auth` 当前结构：

```text
src/<module>/
  <module>.module.ts
  <module>.controller.ts
  <module>.service.ts
  dto/
  guards/
  strategies/
```

使用原则：

- `module`：只负责依赖装配
- `controller`：只负责路由、参数接收、guard、swagger 注解
- `service`：放业务逻辑、数据库读写、缓存协作
- `dto`：请求参数类型和校验规则
- `guards`：权限/认证入口控制
- `strategies`：Passport 策略实现

暂时不要过早拆 repository/domain，除非某业务模块已经明显变复杂。

## Controller 约定

当前 controller 写法以 `src/auth/auth.controller.ts` 为基线：

- 使用装饰器定义路由：`@Controller()`、`@Get()`、`@Post()`
- 参数优先使用 `@Body()`、后续如有 path/query 再补 `@Param()`、`@Query()`
- 需要鉴权的接口用 `@UseGuards(JwtAuthGuard)`
- Swagger 注解优先补齐：`@ApiTags`、`@ApiOperation`、`@ApiResponse`
- Bearer 接口补 `@ApiBearerAuth()`

经验规则：

- controller 不要直接写 Prisma 访问逻辑
- controller 不要堆复杂判断、缓存拼装、密码处理
- 返回结构可以先保持直接返回 service 结果，后续统一响应再抽象

## DTO 与校验约定

当前 DTO 约定参考 `src/auth/dto/*.dto.ts`：

- DTO 类中同时承担类型声明和校验规则
- 使用 `class-validator` 注解，例如 `@IsEmail()`、`@IsString()`、`@MinLength()`、`@IsOptional()`
- Swagger 字段说明使用 `@ApiProperty()` / `@ApiPropertyOptional()`
- 错误文案直接写中文，保持面向业务可读

建议：

- 新增接口优先先定义 DTO，再写 controller/service
- DTO 命名使用 `CreateXxxDto`、`UpdateXxxDto`、`QueryXxxDto`、`LoginDto` 这类明确语义
- 不要把校验写散在 service 里

## Auth 约定

当前认证链路是项目的核心模板，后续接口优先复用：

- 注册：检查邮箱是否存在，密码 `bcrypt.hash()` 后落库
- 登录：按邮箱查用户，`bcrypt.compare()` 校验密码
- 发 token：在 service 内统一签发 JWT
- JWT payload 当前最小约定：`{ sub, email }`
- `JwtStrategy.validate()` 中再次查库确认用户存在
- `JwtAuthGuard` 负责保护需要登录态的接口

经验规则：

- 不要把明文密码存入数据库
- 登录/注册失败统一抛 `UnauthorizedException` 或 `ConflictException`
- JWT payload 保持精简，避免塞大量业务字段
- 需要当前用户时，优先从 guard/strategy 挂载的 user 读取，而不是重新解析 token

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

## Redis 约定

缓存接入以 `src/redis/redis.service.ts` 为基线：

- `RedisService` 负责客户端生命周期
- 默认提供 `get`、`set`、`del`、`exists`、`getClient()`
- 配置来自 `redis.*`

使用原则：

- 通用缓存操作优先复用现有封装方法
- 只有确实需要 Redis 原生能力时再使用 `getClient()`
- key 命名建议带业务前缀，如 `auth:token:blacklist:${tokenId}`
- TTL 在业务语义明确时再传，不要随意写死

## Swagger 约定

当前项目已在启动层统一启用 Swagger，所以新增接口时只需要补接口级注解。

建议最少补齐：

- `@ApiTags('<ModuleName>')`
- `@ApiOperation({ summary: '...' })`
- `@ApiResponse({ status: ..., description: '...' })`
- 鉴权接口补 `@ApiBearerAuth()`

如果 DTO 已补 `ApiProperty`，Swagger 字段展示会自动更完整。

## 新增接口的推荐流程

按下面顺序实现，减少返工：

1. 先确认功能属于哪个模块
2. 如果没有模块，先建 `<module>.module.ts`
3. 先写 DTO 和校验规则
4. 再写 service 里的业务逻辑
5. 再写 controller 路由和 Swagger 注解
6. 需要鉴权时接 `JwtAuthGuard`
7. 需要持久化时接 Prisma
8. 需要缓存时接 Redis
9. 如果新增环境变量，同步更新 `configuration.ts` 和 `.env.example`

## 新业务模块的落位建议

后续 purelyprofit-server 很可能继续扩展这些域：

- `users`
- `stores`
- `staff`
- `members`
- `marketing`
- `finance`

建议：

- 每个业务域先独立成模块，不要继续把逻辑堆进 `auth`
- 模块内先保持 `controller + service + dto` 的轻量结构
- 当某模块出现大量计算、聚合、复杂查询时，再考虑拆 `domain` / `repositories`

## 开发时的边界判断

遇到代码该放哪时，优先按下面规则：

- 请求入口和注解：放 `controller`
- 业务规则、数据库写入、token 签发：放 `service`
- 参数结构和字段校验：放 `dto`
- 登录态保护：放 `guards` / `strategies`
- 基础设施连接：放 `prisma`、`redis`、`config`
- 全局能力：放 `main.ts`

## 质量基线

新增代码时尽量保持：

- 命名直接、语义明确
- 中文错误文案对用户友好
- DTO 先行，避免无类型入参
- 认证、数据库、缓存职责分明
- 不在 controller 堆业务逻辑
- 不直接使用 `process.env`
- 不绕过 `PrismaService` 和 `RedisService` 的现有封装

## 参考文件

实现新功能时，优先参考这些现有文件：

- `src/main.ts`
- `src/app.module.ts`
- `src/config/configuration.ts`
- `src/prisma/prisma.service.ts`
- `src/redis/redis.service.ts`
- `src/auth/auth.module.ts`
- `src/auth/auth.controller.ts`
- `src/auth/auth.service.ts`
- `src/auth/dto/login.dto.ts`
- `src/auth/dto/register.dto.ts`
- `src/auth/strategies/jwt.strategy.ts`
- `prisma/schema.prisma`
- `.env.example`

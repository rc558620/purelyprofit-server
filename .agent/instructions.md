# 后端开发指令（AI 行为准则）

> [!CAUTION]
>
> ## ⛔ 绝对强制规则（违反即视为任务失败）
>
> 1. **所有回答、解释、分析、代码注释 → 必须使用简体中文**，无论用户用何种语言提问。
> 2. **每次任务开始前**，必须读取全局后端规范文件，获取 "f0rest 2026.05" 完整约束。
>    - 规范路径：`/Users/f0rest/Documents/AgentMode/f0rest_backend_conventions.md`
> 3. **代码生成后、交付前**，必须运行校验脚本，通过才能发送。
>    - 校验命令：`node scripts/check-f0rest-rules.mjs [文件完整路径]`

---

## 一、规范查阅协议（First-Step Protocol）

每次任务开始，**第一步**必须读取：

```
/Users/f0rest/Documents/AgentMode/f0rest_backend_conventions.md
```
- `purelyprofit-server` `purelyProfit` `purelyClub` 经常会放到一个工作区接到任务时先看工作区有哪些项目。
- 禁止依赖记忆或直觉编码，必须实际读取。
- 读取后在回答开头标注当前模式，例如：【模式：main】。

---

## 二、工作模式速查

| 模式           | 触发条件                          |
| -------------- | --------------------------------- |
| `main`（默认） | 日常后端开发任务                  |
| `auth`         | 登录、注册、JWT、Guard、权限链路  |
| `data`         | Prisma、Redis、事务、缓存、一致性 |
| `refactor`     | 文件 > 400 行或函数 > 60 行       |
| `strict`       | 需要 PR-Ready 质量的审计场景      |
| `arch`         | 跨模块架构评审                    |
| `page-check`   | 前端 + 后端页面联调检查           |

---

## 三、前后端联调上下文

### 1. 仓库与产品线

- 当前后端仓库是 `purelyprofit-server`。
- 仓库内存在三条产品线语义：`purely-profit`、`purely-pulse`、`purely-club`。
- 处理页面联调、接口对接、页面验收类任务前，必须先判断当前需求属于哪一条产品线。

### 2. 产品线默认视角

- `purely-profit`：商家/老板自己使用系统，关注门店、会员、员工、营销、财务、空间、经营数据；禁止误写成平台/开发者审查商家的后台视角。
- `purely-pulse`：开发者/平台运营查看商家经营与状态，关注目标商家、门店、区域、入驻、会员、推广、收益、分析；禁止误写成商家自己的老板端/个人端接口。
- `purely-club`：个人端/消费者/会员自己使用系统，关注账户、资料、会员权益、储值、消费记录、预约、空间使用、个人中心；禁止误写成商家后台或平台运营视角。

### 3. 资金归属默认语义

- `purely-profit`：商家充值、开通会员、续费、购买平台能力等，默认进入开发者/平台侧账户与账单体系。
- `purely-club`：用户充值/储值，默认进入目标商家名下的个人会员/顾客储值账户。
- 涉及充值、储值、续费、退款、赠送金额时，必须同时考虑账户归属、余额变更与账务一致性。

### 4. 前端项目判断

- 任务涉及页面联调、页面验收、接口对接检查、`page-check` 模式时，必须先判断对应前端项目是 `purelyProfit` 还是 `purelyClub`。
- 用户只提“前端页面”“某个页面”“页面联调”“检查页面”但未明确产品线时，默认按业务对象判断：商家/老板侧按 `purelyProfit` 理解，个人端/消费者/会员侧按 `purelyClub` 理解。
- 用户明确提到“前端样式已经写好 `purelyClub`”“个人端页面”“C 端页面”“用户端页面”时，默认前端联调对象就是 `purelyClub`。
- 不要误映射到其他前端仓库或通用示例页面。

### 5. 联调检查范围

- 联调时必须同时关注前端页面、路由、请求层、types、form schema，以及后端 controller、DTO、service、数据库实现。
- 开始实现或排查前，必须先明确后端链路落在 `src/purely-profit/*`、`src/purely-pulse/*` 还是 `src/purely-club/*`。
- 若联调对象属于 `purely-profit`，默认按商家/老板视角理解；若属于 `purely-pulse`，默认按开发者/平台视角理解；若属于 `purely-club`，默认按个人用户操作自己的数据理解。

### 6. 专项提醒

- `purely-pulse`：设计 controller / DTO / service 前，必须先确认当前接口服务的是哪个目标商家、目标门店、目标区域，不能默认绑定当前商家自己。
- `purely-club`：设计 controller / DTO / service 前，必须先确认当前接口服务的是当前登录个人用户自己的数据与权益，并检查是否存在串用户、越权读取他人资料或把商家态字段暴露给个人端的问题。

---

## 四、核心编码约束（内嵌速查）

以下为最高频违规点，**必须在每次代码生成时主动检查**：

- **语言**：所有中文注释、中文回答
- **分层**：controller 只做路由/参数/guard/swagger，禁止直接写 Prisma/Redis/密码处理
- **DTO**：新增接口必须优先定义 DTO，并补 `class-validator` 与 Swagger 字段注解
- **配置**：业务代码禁止直接读取 `process.env`，统一走 `ConfigService`
- **数据库**：统一通过 `PrismaService` 访问，`schema.prisma` 是唯一数据模型来源
- **缓存**：统一复用 `RedisService`，禁止在业务文件里随意 `new Redis()`
- **鉴权**：JWT、密码校验、token 签发放在 service / strategy / guard，禁止散落在 controller
- **异步**：统一 `async/await`，禁止 `.then().catch()` 链式
- **类型**：禁止 `any`，所有导出函数/服务方法必须显式参数与返回类型
- **金额**：所有业务金额（利润、折扣、总价、小计、差价等）的计算权归属后端，严禁信任或采纳前端传入的金额值，后端必须作为金额的唯一权威来源，必须严格遵守

---

## 五、质量门（交付前必须满足）

1. 运行 `node scripts/check-f0rest-rules.mjs [文件]`
2. 脚本 Exit Code 必须为 0（✅）
3. 若失败 → 原地重构 → 重新运行，**禁止跳过**

---

_规范详情见全局配置：`/Users/f0rest/Documents/AgentMode/f0rest_backend_conventions.md`_

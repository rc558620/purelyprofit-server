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

- 当前后端仓库是 `purelyprofit-server`。
- 仓库内存在两条产品线语义：`purely-profit` 与 `purely-pulse`，处理需求前必须先判断当前任务属于哪一条业务视角。
- `purely-profit`：默认按“商家/老板自己使用系统”的后端视角理解，重点是商家看自己的门店、会员、员工、营销、财务、空间、经营数据等能力；禁止误写成平台/开发者审查商家的后台视角。
- `purely-pulse`：默认按“开发者/平台运营查看商家经营与状态”的后端视角理解，重点是开发者看商家、门店、区域、入驻、会员、推广、收益、分析等数据；禁止误写成“商家看自己的个人端/老板端”接口。
- 当任务涉及页面联调、页面验收、接口对接检查、`page-check` 模式时，默认对应的前端项目名称是 `purelyProfit`。
- 若用户提到“前端页面”“某个页面”“页面联调”“检查页面”，默认先按 `purelyProfit` 前端项目来理解，不要误映射到其他前端仓库或通用示例页面。
- 做前后端联调检查时，必须同时关注 `purelyProfit` 前端页面/路由/请求层/types/form schema，与本仓库后端 controller/DTO/service/数据库实现；同时必须先明确当前后端链路落在 `src/purely-profit/*` 还是 `src/purely-pulse/*`。
- 若联调对象属于 `purely-profit`，默认按“商家/老板自己使用系统”的后端视角理解；若联调对象属于 `purely-pulse`，默认按“开发者/平台运营查看商家经营与状态”的后端视角理解。
- 若任务落在 `purely-pulse`，在设计 controller/DTO/service 前必须先确认：当前接口是在“开发者查看哪个商家/门店/区域”，而不是默认绑定当前商家自己。

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

---

## 五、质量门（交付前必须满足）

1. 运行 `node scripts/check-f0rest-rules.mjs [文件]`
2. 脚本 Exit Code 必须为 0（✅）
3. 若失败 → 原地重构 → 重新运行，**禁止跳过**

---

_规范详情见全局配置：`/Users/f0rest/Documents/AgentMode/f0rest_backend_conventions.md`_

# 项目身份：purelyprofit-server（后端）

- 仓库：`purelyprofit-server`（NestJS + Prisma + TypeScript，pnpm）
- 三条产品线：`purely-profit`（商家端 · 日常经营管理）、`purely-pulse`（经营分析端 · owner / 老板 / 开发者视角）、`purely-club`（C 端会员）
- 对应前端：`purelyProfit`（商家端）、`purelyPulse`（经营分析端）、`purelyClub`（会员端小程序）
- 处理联调/接口任务前，必须先判断需求属于哪条产品线，禁止串视角、越权读取他人数据

---

> 完整后端规范与「按需模式」加载由项目规则（`.codebuddy/rules/backend-core`）控制，可在 IDE 规则设置中按 `enabled` 开关。

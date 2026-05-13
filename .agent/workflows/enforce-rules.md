---
description: 自动执行 f0rest 2026.05 后端规范校验
---

> [!CAUTION]
> **所有回答必须使用简体中文**，无论用户用什么语言提问。执行以下每一步前，先确认语言设置。

## 前置步骤（每次任务必须执行）

// turbo
1. 读取全局后端规范文件：
   ```bash
   # 读取以下路径
   /Users/f0rest/Documents/AgentMode/f0rest_backend_conventions.md
   ```
   - **禁止跳过**，即便已在本次会话中读取过也需确认关键规则。
   - 读取后在回答开头标注模式，如：【模式：main】。

## 代码交付前校验流程

// turbo
2. 对每个修改/新建的文件运行校验：
   ```bash
   node scripts/check-f0rest-rules.mjs [文件完整路径]
   ```

3. **违规处理**
   - Exit Code 1 → **严禁**将代码直接提交用户。
   - 根据报错信息重构（如 controller 越权、DTO 缺校验、直接读取环境变量等）。
   - 修复后**必须重新运行步骤 2**，直到返回 ✅。

4. **结果交付**
   - 仅校验全部通过（✅）后，才能向用户发送完成信息。
   - 用**简体中文**附上校验通过的日志摘要。

## 高频违规速查（代码生成时主动检查）

| 规则 | 正确 | 错误 |
|------|------|------|
| controller 分层 | `controller -> service` | controller 里直接查 Prisma |
| DTO 校验 | `@IsString()` + `@ApiProperty()` | 裸对象入参 |
| 配置读取 | `config.get('jwt.secret')` | `process.env.JWT_SECRET` |
| Redis 接入 | 注入 `RedisService` | `new Redis()` |
| 异步 | `async/await` | `.then().catch()` |
| 鉴权 | `JwtAuthGuard` / `JwtStrategy` | controller 手写 token 解析 |

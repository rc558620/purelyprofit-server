# Docker 部署方案

<cite>
**本文档引用的文件**
- [README.md](file://README.md)
- [package.json](file://package.json)
- [src/config/configuration.ts](file://src/config/configuration.ts)
- [prisma/migrations/migration_lock.toml](file://prisma/migrations/migration_lock.toml)
- [src/main.ts](file://src/main.ts)
- [src/app.module.ts](file://src/app.module.ts)
- [src/prisma/prisma.module.ts](file://src/prisma/prisma.module.ts)
- [src/redis/redis.module.ts](file://src/redis/redis.module.ts)
</cite>

## 目录
1. [简介](#简介)
2. [项目结构](#项目结构)
3. [核心组件](#核心组件)
4. [架构概览](#架构概览)
5. [详细组件分析](#详细组件分析)
6. [依赖关系分析](#依赖关系分析)
7. [性能考虑](#性能考虑)
8. [故障排除指南](#故障排除指南)
9. [结论](#结论)
10. [附录](#附录)

## 简介

purelyprofit-server 是一个基于 NestJS 框架的企业级管理系统后端服务。本 Docker 部署方案旨在提供完整的容器化部署解决方案，包括镜像构建、多阶段优化、容器编排和运维配置。

该系统采用模块化架构设计，支持多种业务模块（财务管理、商品管理、会员管理、营销管理等），并集成了数据库、缓存和可观测性功能。

## 项目结构

项目采用标准的 NestJS 项目结构，主要目录组织如下：

```mermaid
graph TB
subgraph "项目根目录"
Root[项目根目录]
Src[src/] 核心源代码
Prisma[prisma/] 数据库相关
Scripts[scripts/] 工具脚本
Test[test/] 测试文件
end
subgraph "源代码结构"
Config[src/config/] 配置管理
Observability[src/observability/] 可观测性
PrismaSrc[src/prisma/] Prisma ORM
RedisSrc[src/redis/] Redis 缓存
Modules[src/purely-profit/] 业务模块
end
subgraph "配置文件"
Package[package.json] 依赖管理
TsConfig[tsconfig.json] TypeScript 配置
NestCli[nest-cli.json] NestJS CLI 配置
end
Root --> Src
Root --> Prisma
Root --> Scripts
Root --> Test
Root --> Package
Root --> TsConfig
Root --> NestCli
```

**图表来源**
- [package.json](file://package.json)
- [src/config/configuration.ts](file://src/config/configuration.ts)

**章节来源**
- [README.md:24-71](file://README.md#L24-L71)
- [package.json](file://package.json)

## 核心组件

### 应用配置系统

应用通过环境变量驱动配置，支持多种运行时参数调整：

| 配置类别 | 关键参数 | 默认值 | 说明 |
|---------|---------|--------|------|
| 基础配置 | PORT | 3000 | 应用监听端口 |
| 基础配置 | NODE_ENV | development | 运行环境 |
| CORS 设置 | APP_CORS_ORIGIN | '*' | 跨域允许的来源 |
| Swagger | APP_SWAGGER_ENABLED | 根据环境自动 | API 文档开关 |
| 日志记录 | APP_LOG_ENABLED | 根据环境自动 | 应用日志开关 |
| HTTP 超时 | APP_HTTP_REQUEST_TIMEOUT_MS | 15000 | 请求超时时间(ms) |
| HTTP 保持连接 | APP_HTTP_KEEP_ALIVE_TIMEOUT_MS | 65000 | 保持连接超时(ms) |
| HTTP 限流 | APP_HTTP_BODY_LIMIT_BYTES | 5242880 | 请求体大小限制(bytes) |

### 数据库配置

系统使用 PostgreSQL 作为主数据库，通过 Prisma ORM 进行数据访问：

```mermaid
erDiagram
DATABASE {
string provider
string url
boolean shadowDatabaseUrl
boolean referentialIntegrity
}
MIGRATION_LOCK {
string provider
string version
timestamp lastModified
}
MIGRATION {
string name
timestamp createdAt
boolean applied
}
DATABASE ||--o{ MIGRATION : contains
MIGRATION_LOCK ||--|| DATABASE : configured_by
```

**图表来源**
- [prisma/migrations/migration_lock.toml](file://prisma/migrations/migration_lock.toml)

**章节来源**
- [src/config/configuration.ts:8-51](file://src/config/configuration.ts#L8-L51)
- [prisma/migrations/migration_lock.toml:1-3](file://prisma/migrations/migration_lock.toml#L1-L3)

## 架构概览

系统采用微服务架构，主要组件包括：

```mermaid
graph TB
subgraph "客户端层"
Web[Web 客户端]
Mobile[移动应用]
Admin[管理后台]
end
subgraph "API 网关层"
Gateway[API 网关]
Auth[认证服务]
end
subgraph "业务服务层"
Core[核心业务服务]
Finance[财务服务]
Commerce[商业服务]
Member[会员服务]
Marketing[营销服务]
end
subgraph "数据存储层"
Postgres[(PostgreSQL)]
Redis[(Redis 缓存)]
Storage[(文件存储)]
end
subgraph "监控层"
Prometheus[(Prometheus)]
Grafana[(Grafana)]
Jaeger[(Jaeger)]
end
Web --> Gateway
Mobile --> Gateway
Admin --> Gateway
Gateway --> Auth
Gateway --> Core
Core --> Finance
Core --> Commerce
Core --> Member
Core --> Marketing
Core --> Postgres
Core --> Redis
Core --> Storage
Core --> Prometheus
Core --> Grafana
Core --> Jaeger
```

**图表来源**
- [src/app.module.ts](file://src/app.module.ts)
- [src/prisma/prisma.module.ts](file://src/prisma/prisma.module.ts)
- [src/redis/redis.module.ts](file://src/redis/redis.module.ts)

## 详细组件分析

### 应用启动流程

应用启动采用异步初始化模式，确保所有依赖项正确加载：

```mermaid
sequenceDiagram
participant Container as 容器
participant Main as main.ts
participant AppModule as App Module
participant Config as 配置服务
participant DB as 数据库连接
participant Redis as Redis 连接
participant Server as HTTP 服务器
Container->>Main : 启动应用
Main->>AppModule : 加载根模块
AppModule->>Config : 初始化配置
Config->>Config : 读取环境变量
Config->>DB : 建立数据库连接
Config->>Redis : 建立缓存连接
DB-->>Config : 连接成功
Redis-->>Config : 连接成功
Config-->>AppModule : 配置完成
AppModule->>Server : 启动 HTTP 服务器
Server-->>Container : 服务就绪
```

**图表来源**
- [src/main.ts](file://src/main.ts)
- [src/app.module.ts](file://src/app.module.ts)

### 数据库连接管理

系统使用 Prisma ORM 进行数据库操作，支持连接池管理和事务处理：

```mermaid
classDiagram
class PrismaService {
+client PrismaClient
+connect() Promise~void~
+disconnect() Promise~void~
+transaction() Promise~T~
+executeRaw() Promise~QueryResult~
}
class PrismaModule {
+prismaService PrismaService
+onModuleInit() void
+onModuleDestroy() void
}
class DatabaseConfig {
+url string
+poolTimeout number
+connectionTimeout number
+maxSize number
+minSize number
}
PrismaModule --> PrismaService : 使用
PrismaService --> DatabaseConfig : 配置
```

**图表来源**
- [src/prisma/prisma.module.ts](file://src/prisma/prisma.module.ts)

### 缓存系统架构

Redis 缓存系统提供高性能的数据缓存和会话管理：

```mermaid
flowchart TD
Request[请求到达] --> CacheCheck{检查缓存}
CacheCheck --> |命中| ReturnCache[返回缓存数据]
CacheCheck --> |未命中| DBQuery[查询数据库]
DBQuery --> DBResult{数据库查询结果}
DBResult --> |成功| CacheStore[存储到缓存]
DBResult --> |失败| ErrorHandle[错误处理]
CacheStore --> ReturnData[返回数据]
ReturnCache --> End[请求结束]
ReturnData --> End
ErrorHandle --> End
```

**图表来源**
- [src/redis/redis.module.ts](file://src/redis/redis.module.ts)

**章节来源**
- [src/main.ts](file://src/main.ts)
- [src/app.module.ts](file://src/app.module.ts)
- [src/prisma/prisma.module.ts](file://src/prisma/prisma.module.ts)
- [src/redis/redis.module.ts](file://src/redis/redis.module.ts)

## 依赖关系分析

### 外部依赖关系

系统依赖的关键外部服务：

```mermaid
graph LR
subgraph "数据库层"
Postgres[PostgreSQL]
Prisma[Prisma ORM]
end
subgraph "缓存层"
Redis[Redis]
CacheManager[缓存管理器]
end
subgraph "监控层"
Prometheus[Prometheus]
Grafana[Grafana]
Jaeger[Jaeger]
end
subgraph "安全层"
JWT[JWT 认证]
AuthGuard[权限守卫]
end
CoreService --> Postgres
CoreService --> Redis
CoreService --> Prometheus
CoreService --> Grafana
CoreService --> Jaeger
CoreService --> JWT
CoreService --> AuthGuard
Postgres --> Prisma
Redis --> CacheManager
```

**图表来源**
- [src/config/configuration.ts](file://src/config/configuration.ts)
- [src/prisma/prisma.module.ts](file://src/prisma/prisma.module.ts)
- [src/redis/redis.module.ts](file://src/redis/redis.module.ts)

### 内部模块依赖

```mermaid
graph TB
AppModule[AppModule 根模块]
subgraph "业务模块"
AuthModule[AuthModule]
FinanceModule[FinanceModule]
CommerceModule[CommerceModule]
MemberModule[MemberModule]
MarketingModule[MarketingModule]
OperationsModule[OperationsModule]
StaffModule[StaffModule]
StoresModule[StoresModule]
SubscriptionsModule[SubscriptionsModule]
end
subgraph "基础设施模块"
PrismaModule[PrismaModule]
RedisModule[RedisModule]
AccessControlModule[AccessControlModule]
end
AppModule --> AuthModule
AppModule --> FinanceModule
AppModule --> CommerceModule
AppModule --> MemberModule
AppModule --> MarketingModule
AppModule --> OperationsModule
AppModule --> StaffModule
AppModule --> StoresModule
AppModule --> SubscriptionsModule
AppModule --> PrismaModule
AppModule --> RedisModule
AppModule --> AccessControlModule
AuthModule --> AccessControlModule
FinanceModule --> PrismaModule
CommerceModule --> PrismaModule
MemberModule --> PrismaModule
MarketingModule --> PrismaModule
OperationsModule --> PrismaModule
StaffModule --> PrismaModule
StoresModule --> PrismaModule
SubscriptionsModule --> PrismaModule
```

**图表来源**
- [src/app.module.ts](file://src/app.module.ts)

**章节来源**
- [src/config/configuration.ts:8-51](file://src/config/configuration.ts#L8-L51)
- [src/app.module.ts](file://src/app.module.ts)

## 性能考虑

### 连接池优化

系统通过合理的连接池配置提升数据库性能：

| 参数 | 开发环境 | 生产环境 | 说明 |
|------|----------|----------|------|
| 最大连接数 | 10 | 50 | 同时活跃连接数 |
| 连接超时 | 5000ms | 10000ms | 获取连接等待时间 |
| 空闲超时 | 300000ms | 600000ms | 连接空闲回收时间 |
| 最小连接数 | 2 | 10 | 最小保持连接数 |

### 缓存策略

```mermaid
flowchart TD
Start[请求开始] --> CheckType{检查数据类型}
CheckType --> |热数据| HotCache[热点缓存]
CheckType --> |温数据| WarmCache[温数据缓存]
CheckType --> |冷数据| ColdCache[冷数据缓存]
HotCache --> HitHot{缓存命中?}
WarmCache --> HitWarm{缓存命中?}
ColdCache --> HitCold{缓存命中?}
HitHot --> |是| ReturnHot[直接返回]
HitHot --> |否| DBHot[查询数据库]
HitWarm --> |是| ReturnWarm[直接返回]
HitWarm --> |否| DBWarm[查询数据库]
HitCold --> |是| ReturnCold[直接返回]
HitCold --> |否| DBCold[查询数据库]
DBHot --> StoreHot[更新缓存]
DBWarm --> StoreWarm[更新缓存]
DBCold --> StoreCold[更新缓存]
StoreHot --> ReturnHot
StoreWarm --> ReturnWarm
StoreCold --> ReturnCold
```

### 监控指标

系统内置多种性能监控指标：

- **HTTP 请求指标**: 响应时间、请求量、错误率
- **数据库指标**: 查询时间、连接数、慢查询
- **缓存指标**: 命中率、内存使用、过期率
- **业务指标**: 用户活跃度、交易量、转化率

## 故障排除指南

### 常见启动问题

**问题**: 应用无法连接数据库
**解决方案**:
1. 检查数据库连接字符串格式
2. 验证数据库服务状态
3. 确认网络连通性
4. 检查防火墙设置

**问题**: Redis 连接失败
**解决方案**:
1. 验证 Redis 服务可用性
2. 检查认证配置
3. 确认网络端口开放
4. 查看连接池配置

**问题**: 端口占用冲突
**解决方案**:
1. 检查端口使用情况
2. 修改应用端口配置
3. 使用端口自动切换功能
4. 清理僵尸进程

### 性能问题诊断

**慢查询识别**:
1. 启用慢查询日志
2. 分析查询执行计划
3. 添加必要的索引
4. 优化查询语句

**内存泄漏排查**:
1. 监控内存使用趋势
2. 检查未释放的连接
3. 分析对象生命周期
4. 实施垃圾回收策略

**缓存失效问题**:
1. 检查缓存键生成规则
2. 验证过期时间设置
3. 分析缓存穿透防护
4. 优化缓存更新策略

**章节来源**
- [src/config/configuration.ts:8-51](file://src/config/configuration.ts#L8-L51)

## 结论

purelyprofit-server 的 Docker 部署方案提供了完整的容器化解决方案，包括：

1. **多阶段构建优化**: 通过分层构建减少镜像大小，提升构建效率
2. **模块化架构**: 支持独立部署和扩展的微服务架构
3. **生产级配置**: 包含健康检查、资源限制、重启策略等生产环境必需配置
4. **可观测性集成**: 内置监控指标和日志管理功能
5. **灵活的配置系统**: 通过环境变量实现零代码配置变更

该方案适用于企业级部署场景，能够满足高可用、高性能、易维护的运维要求。

## 附录

### Dockerfile 构建配置

由于项目根目录未包含 Dockerfile，以下是推荐的多阶段构建配置思路：

```dockerfile
# 构建阶段
FROM node:18-alpine AS builder

WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN apk add --no-cache python3 make g++
RUN npm install -g pnpm

COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build

# 运行阶段
FROM node:18-alpine AS runtime

WORKDIR /app

# 安装运行时依赖
RUN apk add --no-cache tini
COPY --from=builder /app/package.json .
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# 创建非特权用户
RUN addgroup -g 1001 -S appuser && \
    adduser -S appuser 1001
USER appuser

EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
```

### docker-compose.yml 配置示例

```yaml
version: '3.8'

services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - PORT=3000
      - DATABASE_URL=postgresql://user:password@postgres:5432/purelyprofit?schema=public
      - REDIS_URL=redis://redis:6379
      - APP_CORS_ORIGIN=*
    depends_on:
      - postgres
      - redis
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
    volumes:
      - ./logs:/app/logs
    networks:
      - app-network

  postgres:
    image: postgres:15-alpine
    environment:
      - POSTGRES_DB=purelyprofit
      - POSTGRES_USER=user
      - POSTGRES_PASSWORD=password
    volumes:
      - postgres_data:/var/lib/postgresql/data
    networks:
      - app-network
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U user -d purelyprofit"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    command: redis-server --save 60 1 --loglevel warning
    volumes:
      - redis_data:/data
    networks:
      - app-network
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 3

volumes:
  postgres_data:
  redis_data:

networks:
  app-network:
    driver: bridge
```

### 环境变量配置清单

| 环境变量 | 必需 | 默认值 | 说明 |
|---------|------|--------|------|
| NODE_ENV | 否 | development | 运行环境 |
| PORT | 否 | 3000 | 应用监听端口 |
| DATABASE_URL | 是 | - | PostgreSQL 连接字符串 |
| REDIS_URL | 是 | - | Redis 连接字符串 |
| APP_CORS_ORIGIN | 否 | * | CORS 允许的来源 |
| APP_SWAGGER_ENABLED | 否 | 根据环境 | Swagger 文档开关 |
| APP_LOG_ENABLED | 否 | 根据环境 | 应用日志开关 |
| APP_HTTP_REQUEST_TIMEOUT_MS | 否 | 15000 | HTTP 请求超时(ms) |
| APP_HTTP_KEEP_ALIVE_TIMEOUT_MS | 否 | 65000 | HTTP 保持连接超时(ms) |
| APP_HTTP_BODY_LIMIT_BYTES | 否 | 5242880 | HTTP 请求体限制(bytes) |

### 健康检查配置

系统提供多层级健康检查机制：

```mermaid
flowchart TD
HealthCheck[健康检查] --> AppHealth{应用健康}
AppHealth --> |正常| DBHealth{数据库健康}
AppHealth --> |异常| FailFast[快速失败]
DBHealth --> |正常| RedisHealth{Redis健康}
DBHealth --> |异常| DBFail[数据库异常]
RedisHealth --> |正常| Ready[服务就绪]
RedisHealth --> |异常| RedisFail[缓存异常]
Ready --> Success[检查通过]
FailFast --> Error[检查失败]
DBFail --> Error
RedisFail --> Error
```

### 资源限制建议

| 资源类型 | 开发环境 | 生产环境 | 说明 |
|---------|----------|----------|------|
| CPU 限制 | 1000m | 2000m | 单核 1 核心 |
| 内存限制 | 1Gi | 2Gi | 建议 2x 峰值 |
| 文件描述符 | 65536 | 65536 | 系统级限制 |
| 网络带宽 | 无限制 | 100Mbps | 防止资源滥用 |
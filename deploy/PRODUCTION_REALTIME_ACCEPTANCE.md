# 实时通信上线验收

## 当前完成阶段

当前代码、Redis 跨 Worker 广播、Socket.IO Redis Adapter、Cluster 启动方式、就绪探针、Nginx 与 systemd 模板均已完成。
本地验收标准是运行 `pnpm run realtime:ready` 返回 `database=up`、`redis=up`、`realtime=up`，并使用 `CLUSTER_WORKERS=2 pnpm start:cluster` 完成小程序下单与管理端实时收单验证。

以下事项依赖真实服务器、域名、云网络或微信生产配置，当前不能在本地完成；购买服务器后按本文件顺序执行。

## 服务器到位后执行顺序

1. 准备共享 PostgreSQL 与 Redis；所有后端实例必须使用同一套数据库和 Redis。
2. 为每台 API 服务器安装 Node.js、pnpm，并部署相同版本的 `purelyprofit-server`。
3. 配置每台实例的 `/etc/purelyprofit-server/production.env`，填入生产数据库、Redis、JWT、CORS 与支付密钥。
4. 按 `deploy/systemd/purelyprofit-server.service` 注册服务；初始使用 `CLUSTER_WORKERS=2`。
5. 部署 Nginx 或云负载均衡，将 `deploy/nginx/purelyprofit.conf` 的域名、证书路径和 upstream 私网地址替换为真实值。
6. 配置 DNS、HTTPS 证书与防火墙，仅向公网开放 80/443；PostgreSQL、Redis 和后端 3000 端口只开放私网。
7. 完成下方域名、Cluster 与多服务器验收；全部通过后才将流量切入生产。

## 域名与证书

- 管理端同域部署时，purelyProfit 不设置 `VITE_SOCKET_BASE_URL`，连接当前页面域名的 `/socket.io/`。
- 管理端与 API 不同域时，构建 purelyProfit 前设置 `VITE_SOCKET_BASE_URL=https://api.example.com`。
- purelyClub 构建时设置 `TARO_APP_WS_BASE_URL=https://api.example.com`；运行时会转换为 `wss://api.example.com/api/ws/scan-ordering`。
- 在微信公众平台的小程序后台，将 `wss://api.example.com` 加入合法 socket 域名；必须使用有效、未过期且域名匹配的 TLS 证书。

## 发布前检查

```bash
pnpm run build
pnpm run realtime:ready
sudo nginx -t
sudo systemctl reload nginx
```

`realtime:ready` 必须同时返回 `database=up`、`redis=up`、`realtime=up`。

## Cluster 验收

1. 设置 `CLUSTER_WORKERS=2` 后启动 `pnpm start:cluster`。
2. 保持 purelyProfit 扫码点餐页已连接，Network 中 `/socket.io/` 必须为 `101 Switching Protocols`。
3. 在 purelyClub 下单；管理端不得刷新页面，必须自动看到新订单。
4. 接单、出餐、完成订单；纯lyClub订单详情必须实时同步状态。
5. 终止一个 worker；两端自动重连后重复步骤 3 和步骤 4。
6. 暂时断开 Redis；`/api/readyz` 必须返回 `error`；恢复 Redis 后重新返回 `ok`。

## 多服务器验收

- 配置 Nginx `upstream purelyprofit_api` 的至少两个私网实例并重载。
- 任意实例处理下单时，连接在其他实例的管理端和小程序都必须收到事件。
- 发布前按 `DATABASE_POOL_MAX × CLUSTER_WORKERS × 实例数` 核算 PostgreSQL 最大连接数。
- Redis 必须位于私网并启用密码；跨公网时启用 TLS。

## 服务器到位后仍待完成的外部配置

- **DNS 与证书**：为 API、管理端和小程序 WebSocket 使用的真实域名配置 DNS、HTTPS/WSS 证书及自动续期。
- **微信小程序后台**：将真实 `wss://API域名` 配置为合法 socket 域名；开发阶段的 localhost、IP 地址和自签名证书均不能用于正式小程序。
- **网络隔离**：仅公网开放 Nginx 的 80/443；Redis、PostgreSQL 与 Node 3000 端口必须限制为私网或安全组内部访问。
- **数据库容量**：根据实例数、`CLUSTER_WORKERS` 和 `DATABASE_POOL_MAX` 设置 PostgreSQL `max_connections`，并预留迁移、备份和运维连接。
- **Redis 可靠性**：首发可用单 Redis 实例；需要高可用时采用云托管 Redis 或 Redis Sentinel，切换前必须重新执行跨实例实时验收。
- **监控与备份**：为 `/api/readyz` 设置可用性监控；配置 PostgreSQL 自动备份、Redis 备份策略、Nginx 与应用日志采集及磁盘告警。
- **滚动发布**：发布新版本时先从负载均衡摘除一个实例，等待长连接重连或超时后重启，确认 `/api/readyz` 成功再重新加入流量池。
- **正式密钥**：在服务器环境变量或密钥管理服务中配置 JWT、数据库、Redis、微信支付、短信和对象存储密钥；禁止将生产密钥提交进 Git。

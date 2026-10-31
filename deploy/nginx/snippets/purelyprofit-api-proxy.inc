# ─────────────────────────────────────────────────────────────────────────────
# 后端代理片段（被 api.chunlibao.cn 与各站点域共同 include）
# ─────────────────────────────────────────────────────────────────────────────
# 部署路径：/etc/nginx/snippets/purelyprofit-api-proxy.inc
# 依赖：同目录 conf.d 中由 purelyprofit.conf 定义的 upstream `purelyprofit_api`。
#
# 为什么站点域也要反代 /api：
#   purelyProfit / purelyPulse 的 HTTP_CONFIG.baseURL 默认就是相对路径 `/api`，
#   Socket 在生产环境默认取 window.location.origin。若站点域只托管静态文件，
#   前端上线后所有接口与实时连接都会 404，且不需要任何 CORS 配置。
# ─────────────────────────────────────────────────────────────────────────────

# Socket.IO：管理端实时收单。缺少 HTTP/1.1 或 Upgrade/Connection 会退化为 polling。
location /socket.io/ {
    proxy_pass http://purelyprofit_api;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
}

# 小程序原生 WebSocket：/api/ws/scan-ordering、/api/ws/custody、/api/ws/print-agent
# 三者协议与 Socket.IO 不同；按前缀整体放行，新增通道无需再改 Nginx。
location /api/ws/ {
    proxy_pass http://purelyprofit_api;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
}

# 就绪探针：database / redis / realtime 任一异常都会返回非 200，供发布脚本与负载均衡使用
location = /api/readyz {
    proxy_pass http://purelyprofit_api;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    access_log off;
}

location /api/ {
    proxy_pass http://purelyprofit_api;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 30s;
    proxy_send_timeout 30s;
}

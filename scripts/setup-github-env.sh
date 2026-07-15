#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# purelyprofit-server — GitHub 仓库环境一键初始化脚本
# ─────────────────────────────────────────────────────────────────────────────
# 前置条件：
#   1. 已安装 gh CLI 并完成登录（gh auth login）
#   2. 已配置 self-hosted runner（标签含 production）
#
# 功能：
#   1. 创建 production Environment
#   2. main 分支保护规则（PR 合并 + CI status checks 必填）
#   3. 批量注入 Secrets（敏感凭证）
#   4. 批量注入 Variables（非敏感配置）
#
# 使用方式：
#   1. 填写下方所有 <YOUR_..._HERE> 占位符
#   2. bash scripts/setup-github-env.sh
#
# 脚本幂等：重复执行会覆盖同名变量/密钥，不会重复创建。
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ENV='production'

# ─── 颜色输出 ────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'
ok()   { echo -e "${GREEN}✓${NC} $1"; }
info() { echo -e "${YELLOW}→${NC} $1"; }

# ─── 前置检查 ────────────────────────────────────────────────────────────────
if ! command -v gh &>/dev/null; then
  echo '❌ gh CLI 未安装，请先安装：https://cli.github.com/'
  exit 1
fi

if ! gh auth status &>/dev/null 2>&1; then
  echo '❌ gh 未登录，请先执行：gh auth login'
  exit 1
fi

# ─── 获取仓库信息 ───────────────────────────────────────────────────────────
REPO=$(gh repo view --json nameWithOwner -q '.nameWithOwner')

ok "目标仓库: ${REPO}"
echo ''

# ═══════════════════════════════════════════════════════════════════════════════
#  结构性配置：Environment + Branch Protection
# ═══════════════════════════════════════════════════════════════════════════════

# ─── 1. 创建 production Environment ─────────────────────────────────────────
info '创建 production Environment...'

if gh api \
  --method PUT \
  "repos/${REPO}/environments/${ENV}" \
  --input - <<'ENVEOF'
{
  "wait_timer": 0
}
ENVEOF
then
  ok "production Environment 已创建"
else
  info "production Environment 创建失败（可能已存在）"
fi

echo ''

# ─── 2. main 分支保护规则 ───────────────────────────────────────────────────
# Status check context 格式: "{workflow name} / {job name}"
# 对应 ci.yml (name: CI) 的 3 个 job
info '配置 main 分支保护规则...'

if gh api \
  --method PUT \
  "repos/${REPO}/branches/main/protection" \
  --input - <<'BPEOF'
{
  "required_status_checks": {
    "strict": true,
    "contexts": [
      "CI / Lint Test Build",
      "CI / Release Script Regression",
      "CI / Prisma DB Gate"
    ]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "required_approving_review_count": 0,
    "dismiss_stale_reviews": false
  },
  "restrictions": null,
  "required_linear_history": false,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "block_creations": false,
  "required_conversation_resolution": false
}
BPEOF
then
  ok 'main 分支保护规则已配置'
  echo '    • 强制 PR 合并（禁止直接 push）'
  echo '    • Status checks 必填：'
  echo '        - CI / Lint Test Build'
  echo '        - CI / Release Script Regression'
  echo '        - CI / Prisma DB Gate'
  echo '    • 管理员同样受约束'
else
  info '分支保护规则配置失败（请手动检查）'
fi

echo ''

# ═══════════════════════════════════════════════════════════════════════════════
#  Secrets（敏感凭证）
# ═══════════════════════════════════════════════════════════════════════════════
info '配置 Secrets...'

# ─── Database ────────────────────────────────────────────────────────────────
gh secret set DATABASE_URL          --env "$ENV" --body '<YOUR_DATABASE_URL_HERE>'
# 示例: postgresql://user:pass@host:5432/purelyprofit?schema=public

gh secret set SHADOW_DATABASE_URL   --env "$ENV" --body '<YOUR_SHADOW_DATABASE_URL_HERE>'
# 示例: postgresql://user:pass@host:5432/purelyprofit_shadow?schema=public

# ─── Redis ───────────────────────────────────────────────────────────────────
gh secret set REDIS_HOST            --env "$ENV" --body '<YOUR_REDIS_HOST_HERE>'
gh secret set REDIS_PASSWORD        --env "$ENV" --body '<YOUR_REDIS_PASSWORD_HERE>'

# ─── JWT ─────────────────────────────────────────────────────────────────────
gh secret set JWT_SECRET            --env "$ENV" --body '<YOUR_JWT_SECRET_HERE>'
# 建议: openssl rand -base64 48

# ─── Auth ────────────────────────────────────────────────────────────────────
gh secret set AUTH_ADMIN_LOGIN_PHONE --env "$ENV" --body '<YOUR_ADMIN_PHONE_HERE>'
# Admin 登录手机号，生产务必覆盖默认值

# ─── 微信支付（TODO: 待营业执照办好后取消注释）────────────────────────
# gh secret set WECHAT_APP_ID                    --env "$ENV" --body '<YOUR_WECHAT_APP_ID_HERE>'
# gh secret set WECHAT_APP_SECRET                --env "$ENV" --body '<YOUR_WECHAT_APP_SECRET_HERE>'
# gh secret set WECHAT_MCH_SERIAL_NO             --env "$ENV" --body '<YOUR_WECHAT_MCH_SERIAL_NO_HERE>'
# gh secret set WECHAT_PRIVATE_KEY_PATH          --env "$ENV" --body '<YOUR_WECHAT_PRIVATE_KEY_PATH_HERE>'
# gh secret set WECHAT_PRIVATE_KEY_CONTENT       --env "$ENV" --body '<YOUR_WECHAT_PRIVATE_KEY_CONTENT_HERE>'
# # ↑ PRIVATE_KEY_PATH 和 CONTENT 二选一，另一个留空即可
# gh secret set WECHAT_PLATFORM_PUBLIC_KEY_CONTENT --env "$ENV" --body '<YOUR_WECHAT_PLATFORM_PUBLIC_KEY_HERE>'

# ─── 腾讯云短信（TODO: 待营业执照办好后取消注释）──────────────────────
# gh secret set TENCENT_SMS_SECRET_ID   --env "$ENV" --body '<YOUR_TENCENT_SMS_SECRET_ID_HERE>'
# gh secret set TENCENT_SMS_SECRET_KEY  --env "$ENV" --body '<YOUR_TENCENT_SMS_SECRET_KEY_HERE>'
# gh secret set TENCENT_SMS_SDK_APP_ID  --env "$ENV" --body '<YOUR_TENCENT_SMS_SDK_APP_ID_HERE>'

# ─── 腾讯云 COS ──────────────────────────────────────────────────────────────
gh secret set TENCENT_COS_SECRET_ID   --env "$ENV" --body '<YOUR_TENCENT_COS_SECRET_ID_HERE>'
gh secret set TENCENT_COS_SECRET_KEY  --env "$ENV" --body '<YOUR_TENCENT_COS_SECRET_KEY_HERE>'

ok 'Secrets 配置完成（7 项，微信支付+短信待营业执照后启用）'

# ═══════════════════════════════════════════════════════════════════════════════
#  Variables（非敏感配置 — 必填项，workflow 中无默认值）
# ═══════════════════════════════════════════════════════════════════════════════
info '配置 Variables（必填项）...'

# ─── 应用 ────────────────────────────────────────────────────────────────────
gh variable set APP_CORS_ORIGIN       --env "$ENV" --body '<YOUR_FRONTEND_ORIGIN_HERE>'
# 示例: https://profit.example.com

# ─── 集群 ────────────────────────────────────────────────────────────────────
gh variable set CLUSTER_WORKERS       --env "$ENV" --body '<YOUR_CLUSTER_WORKERS_HERE>'
# 建议: 设为服务器 CPU 核数，如 4

# ─── Auth ────────────────────────────────────────────────────────────────────
gh variable set AUTH_ADMIN_LOGIN_ALIAS --env "$ENV" --body '<YOUR_ADMIN_ALIAS_HERE>'
# 示例: admin

# ─── 微信支付回调（TODO: 待营业执照办好后取消注释）────────────────────────
# gh variable set WECHAT_PAY_NOTIFY_URL  --env "$ENV" --body '<YOUR_WECHAT_PAY_NOTIFY_URL_HERE>'
# # 示例: https://api.example.com/api/club/payments/wechat/callback

# ─── 腾讯云短信（TODO: 待营业执照办好后取消注释）──────────────────────
# gh variable set TENCENT_SMS_SIGN_NAME                  --env "$ENV" --body '<YOUR_SMS_SIGN_NAME_HERE>'
# # 示例: 纯利宝
# gh variable set TENCENT_SMS_REGISTER_TEMPLATE_ID       --env "$ENV" --body '<YOUR_SMS_REGISTER_TEMPLATE_ID_HERE>'
# gh variable set TENCENT_SMS_LOGIN_TEMPLATE_ID          --env "$ENV" --body '<YOUR_SMS_LOGIN_TEMPLATE_ID_HERE>'
# gh variable set TENCENT_SMS_PASSWORD_RESET_TEMPLATE_ID --env "$ENV" --body '<YOUR_SMS_PASSWORD_RESET_TEMPLATE_ID_HERE>'

# ─── 腾讯云 COS ──────────────────────────────────────────────────────────────
gh variable set TENCENT_COS_REGION      --env "$ENV" --body '<YOUR_COS_REGION_HERE>'
# 示例: ap-shanghai
gh variable set TENCENT_COS_BUCKET      --env "$ENV" --body '<YOUR_COS_BUCKET_HERE>'
# 示例: your-bucket-1234567890
gh variable set TENCENT_COS_CDN_DOMAIN  --env "$ENV" --body '<YOUR_COS_CDN_DOMAIN_HERE>'
# 示例: https://cdn.example.com

# ─── Release 重启策略（三选一，其余留空） ────────────────────────────────────
# 方式 A: 自定义命令
gh variable set RELEASE_RESTART_CMD     --env "$ENV" --body '<YOUR_RESTART_CMD_HERE>'
# 示例: pm2 restart purelyprofit-server

# 方式 B: systemd（与 A 互斥，取消注释启用）
# gh variable set RELEASE_SYSTEMD_SERVICE_NAME --env "$ENV" --body 'purelyprofit-server'

# 方式 C: PM2（与 A 互斥，取消注释启用）
# gh variable set RELEASE_PM2_APP_NAME         --env "$ENV" --body 'purelyprofit-server'

# 方式 D: launchd（与 A 互斥，取消注释启用）
# gh variable set RELEASE_LAUNCHD_SERVICE_NAME --env "$ENV" --body 'com.purelyprofit.server'

# ─── Release 备份目录 ────────────────────────────────────────────────────────
gh variable set RELEASE_BACKUP_DIR      --env "$ENV" --body '<YOUR_BACKUP_DIR_HERE>'
# 示例: /opt/backups/purelyprofit-server

ok 'Variables 必填项配置完成（6 项，微信支付+短信待营业执照后启用）'

# ═══════════════════════════════════════════════════════════════════════════════
#  Variables（可选项 — 已有默认值，按需取消注释覆盖）
# ═══════════════════════════════════════════════════════════════════════════════
# info '配置 Variables（可选项，取消注释后生效）...'
#
# gh variable set PORT                          --env "$ENV" --body '3000'
# gh variable set APP_BUSINESS_TIMEZONE         --env "$ENV" --body 'Asia/Shanghai'
# gh variable set DATABASE_POOL_MAX             --env "$ENV" --body '20'
# gh variable set DATABASE_POOL_MIN             --env "$ENV" --body '5'
# gh variable set DATABASE_POOL_IDLE_TIMEOUT_MS --env "$ENV" --body '30000'
# gh variable set DATABASE_POOL_CONNECTION_TIMEOUT_MS --env "$ENV" --body '5000'
# gh variable set DATABASE_STATEMENT_TIMEOUT_MS --env "$ENV" --body '10000'
# gh variable set DATABASE_PG_MAX_CONNECTIONS   --env "$ENV" --body '100'
# gh variable set REDIS_PORT                    --env "$ENV" --body '6379'
# gh variable set REDIS_DB                      --env "$ENV" --body '0'
# gh variable set REDIS_CONNECT_TIMEOUT_MS      --env "$ENV" --body '5000'
# gh variable set REDIS_COMMAND_TIMEOUT_MS      --env "$ENV" --body '3000'
# gh variable set REDIS_MAX_RETRIES_PER_REQUEST --env "$ENV" --body '3'
# gh variable set JWT_EXPIRES_IN                --env "$ENV" --body '7d'
# gh variable set AUTH_PASSWORD_RESET_CODE_TTL_SECONDS --env "$ENV" --body '600'
# gh variable set AUTH_REGISTER_CODE_TTL_SECONDS       --env "$ENV" --body '600'
# gh variable set AUTH_SMS_SEND_COOLDOWN_SECONDS       --env "$ENV" --body '60'
# gh variable set AUTH_REFRESH_TOKEN_TTL_SECONDS       --env "$ENV" --body '2592000'
# gh variable set SMOKE_BASE_URL                --env "$ENV" --body 'http://localhost:3000/api'
# gh variable set RELEASE_BACKUP_RETENTION_DAYS --env "$ENV" --body '14'
# gh variable set RELEASE_BACKUP_FILE_PREFIX    --env "$ENV" --body 'purelyprofit-server'
#
# # HTTP 调优
# gh variable set APP_HTTP_KEEP_ALIVE_TIMEOUT_MS --env "$ENV" --body '65000'
# gh variable set APP_HTTP_REQUEST_TIMEOUT_MS    --env "$ENV" --body '15000'
# gh variable set APP_HTTP_BODY_LIMIT_BYTES      --env "$ENV" --body '5242880'
#
# # 全局限流
# gh variable set APP_THROTTLE_TTL_SECONDS       --env "$ENV" --body '60'
# gh variable set APP_THROTTLE_LIMIT             --env "$ENV" --body '100'
#
# # 慢日志阈值
# gh variable set APP_SLOW_REQUEST_LOG_ENABLED   --env "$ENV" --body 'true'
# gh variable set APP_SLOW_REQUEST_THRESHOLD_MS  --env "$ENV" --body '800'
# gh variable set APP_SLOW_QUERY_LOG_ENABLED     --env "$ENV" --body 'true'
# gh variable set APP_SLOW_QUERY_THRESHOLD_MS    --env "$ENV" --body '80'
# gh variable set APP_SLOW_REDIS_LOG_ENABLED     --env "$ENV" --body 'true'
# gh variable set APP_SLOW_REDIS_THRESHOLD_MS    --env "$ENV" --body '20'
# gh variable set APP_SQL_METRICS_ENABLED        --env "$ENV" --body 'true'
# gh variable set APP_CLIENT_ERROR_LOG_ENABLED   --env "$ENV" --body 'true'
#
# # 缓存预热
# gh variable set APP_CACHE_PREWARM_ENABLED          --env "$ENV" --body 'true'
# gh variable set APP_CACHE_PREWARM_INTERVAL_MS      --env "$ENV" --body '15000'
# gh variable set APP_CACHE_PREWARM_INITIAL_DELAY_MS --env "$ENV" --body '5000'
# gh variable set APP_CACHE_PREWARM_BATCH_SIZE       --env "$ENV" --body '30'
# gh variable set APP_CACHE_PREWARM_CONCURRENCY      --env "$ENV" --body '4'
#
# # 空间自动结账
# gh variable set APP_SPACE_AUTO_CHECKOUT_ENABLED          --env "$ENV" --body 'true'
# gh variable set APP_SPACE_AUTO_CHECKOUT_INTERVAL_MS      --env "$ENV" --body '60000'
# gh variable set APP_SPACE_AUTO_CHECKOUT_INITIAL_DELAY_MS --env "$ENV" --body '10000'

echo ''
echo '════════════════════════════════════════════════════════════════'
echo '  配置完成！'
echo ''
echo '  后续步骤：'
echo '  1. 确认 self-hosted runner 已上线（标签: production）'
echo '  2. 先用 dry_run 模式测试：'
echo '     gh workflow run deploy-production.yml -f dry_run=true'
echo '════════════════════════════════════════════════════════════════'

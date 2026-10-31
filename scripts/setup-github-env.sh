#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# purelyprofit-server — GitHub 仓库环境一键初始化脚本
# ─────────────────────────────────────────────────────────────────────────────
# 前置条件：
#   1. 已安装 gh CLI 并完成登录（gh auth login）
#   2. 已有一台可 SSH 登录的生产服务器（Node 20+/26、pnpm 11、nginx、postgresql-client）
#   3. 已生成部署密钥对（推荐专用密钥，不要复用个人 key）：
#        ssh-keygen -t ed25519 -C 'github-actions@purelyprofit-server' -f ~/.ssh/chunlibao_deploy
#        ssh-copy-id -i ~/.ssh/chunlibao_deploy.pub <user>@<host>
#
# 功能：
#   1. 创建 production Environment
#   2. main 分支保护规则（PR 合并 + CI status checks 必填）
#   3. 注入 SSH 部署 Secrets
#   4. 注入域名/路径 Variables
#
# 使用方式（任选其一）：
#   A. 直接改下方"连接参数"再执行：bash scripts/setup-github-env.sh
#   B. 不改文件，用环境变量覆盖：
#        SERVER_HOST=1.2.3.4 SERVER_USER=deploy \
#        SSH_KEY_FILE=~/.ssh/chunlibao_deploy bash scripts/setup-github-env.sh
#
# 脚本幂等：重复执行会覆盖同名变量/密钥，不会重复创建。
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ENV='production'

# ─── 连接参数（必填，可用同名环境变量覆盖）────────────────────────────────────
SERVER_HOST="${SERVER_HOST:-<YOUR_SERVER_HOST_HERE>}"
SERVER_USER="${SERVER_USER:-<YOUR_SSH_USER_HERE>}"
SERVER_PORT="${SERVER_PORT:-22}"
SSH_KEY_FILE="${SSH_KEY_FILE:-}"
REMOTE_TMP="${REMOTE_TMP:-/tmp}"

# ─── 域名与部署路径（已按 chunlibao.cn 规划填好，按需调整）───────────────────
APP_DOMAIN="${APP_DOMAIN:-chunlibao.cn}"
API_DOMAIN="${API_DOMAIN:-api.chunlibao.cn}"
APP_ROOT="${APP_ROOT:-/opt/purelyprofit-server}"
APP_SERVICE="${APP_SERVICE:-purelyprofit-server}"
APP_ENV_FILE="${APP_ENV_FILE:-/etc/purelyprofit-server/production.env}"
APP_HEALTHCHECK_URL="${APP_HEALTHCHECK_URL:-http://127.0.0.1:3000/api/readyz}"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'
ok() { echo -e "${GREEN}✓${NC} $1"; }
info() { echo -e "${YELLOW}→${NC} $1"; }
err() { echo -e "${RED}✗${NC} $1"; }

# ─── 前置检查 ────────────────────────────────────────────────────────────────
if ! command -v gh &>/dev/null; then
  err 'gh CLI 未安装，请先安装：https://cli.github.com/'
  exit 1
fi

if ! gh auth status &>/dev/null 2>&1; then
  err 'gh 未登录，请先执行：gh auth login'
  exit 1
fi

case "${SERVER_HOST}" in
  '<YOUR_SERVER_HOST_HERE>' | '')
    err '请先设置 SERVER_HOST（服务器公网 IP 或域名）'
    exit 1
    ;;
esac

case "${SERVER_USER}" in
  '<YOUR_SSH_USER_HERE>' | '')
    err '请先设置 SERVER_USER（SSH 登录用户）'
    exit 1
    ;;
esac

if [ -z "${SSH_KEY_FILE}" ] || [ ! -f "${SSH_KEY_FILE}" ]; then
  err '请设置 SSH_KEY_FILE 指向部署私钥文件（如 ~/.ssh/chunlibao_deploy）'
  exit 1
fi

REPO=$(gh repo view --json nameWithOwner -q '.nameWithOwner')
ok "目标仓库: ${REPO}"
info "部署目标: ${SERVER_USER}@${SERVER_HOST}:${SERVER_PORT}"
info "API 域名: ${API_DOMAIN}    站点域名: ${APP_DOMAIN}"
echo ''

# ═══════════════════════════════════════════════════════════════════════════════
#  结构性配置：Environment + Branch Protection
# ═══════════════════════════════════════════════════════════════════════════════
info '创建 production Environment...'

if gh api --method PUT "repos/${REPO}/environments/${ENV}" --input - <<'ENVEOF' >/dev/null
{
  "wait_timer": 0
}
ENVEOF
then
  ok 'production Environment 已就绪'
else
  err 'production Environment 创建失败，请检查仓库权限'
  exit 1
fi

echo ''
info '配置 main 分支保护规则...'

# Status check context 格式为 "{workflow name} / {job name}"。
# 这里的 job name 必须与 .github/workflows/ci.yml 中的 name 字段逐字一致，
# 否则保护规则会一直停在 Expected — 永远等不到一个不存在的检查。
if gh api --method PUT "repos/${REPO}/branches/main/protection" --input - <<'BPEOF' >/dev/null
{
  "required_status_checks": {
    "strict": true,
    "contexts": [
      "CI / Typecheck Lint Unit E2E",
      "CI / Release Script Regression",
      "CI / Prisma DB Gate",
      "CI / Build Artifact"
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
  echo '    • Status checks 必填：Typecheck Lint Unit E2E / Release Script Regression / Prisma DB Gate / Build Artifact'
  echo '    • 管理员同样受约束'
else
  err '分支保护规则配置失败（免费版私有仓库不支持分支保护，可跳过此项）'
fi

echo ''
# ═══════════════════════════════════════════════════════════════════════════════
#  Secrets：仅保留 SSH 连接所需（业务配置全部在服务器 production.env）
# ═══════════════════════════════════════════════════════════════════════════════
info '配置 SSH 部署 Secrets...'

gh secret set SSH_HOST --env "$ENV" --body "${SERVER_HOST}"
gh secret set SSH_USER --env "$ENV" --body "${SERVER_USER}"
gh secret set SSH_PORT --env "$ENV" --body "${SERVER_PORT}"
gh secret set SSH_REMOTE_TMP --env "$ENV" --body "${REMOTE_TMP}"
# 私钥用文件重定向注入，避免私钥内容出现在 shell history / 进程参数里
gh secret set SSH_KEY --env "$ENV" < "${SSH_KEY_FILE}"

ok 'SSH Secrets 配置完成（SSH_HOST / SSH_USER / SSH_PORT / SSH_REMOTE_TMP / SSH_KEY）'

echo ''
# ═══════════════════════════════════════════════════════════════════════════════
#  Variables：域名与服务器路径
# ═══════════════════════════════════════════════════════════════════════════════
info '配置 Variables...'

gh variable set APP_DOMAIN --env "$ENV" --body "${APP_DOMAIN}"
gh variable set API_DOMAIN --env "$ENV" --body "${API_DOMAIN}"
gh variable set APP_ROOT --env "$ENV" --body "${APP_ROOT}"
gh variable set APP_SERVICE --env "$ENV" --body "${APP_SERVICE}"
gh variable set APP_ENV_FILE --env "$ENV" --body "${APP_ENV_FILE}"
gh variable set APP_HEALTHCHECK_URL --env "$ENV" --body "${APP_HEALTHCHECK_URL}"
gh variable set APP_KEEP_RELEASES --env "$ENV" --body '5'
gh variable set RELEASE_REQUIRE_BACKUP --env "$ENV" --body 'true'
# 自动部署总开关：false 时 push main 只跑 CI，不再自动发布（降级为手动 Run workflow）
gh variable set AUTO_DEPLOY_ENABLED --env "$ENV" --body 'true'

ok 'Variables 配置完成'

echo ''
echo '════════════════════════════════════════════════════════════════════════'
echo '  配置完成，接下来按顺序做服务器侧准备：'
echo ''
echo '  1) 建服务用户与发布目录（目录归发布用户所有，服务用户 purelyprofit 只读）'
echo '       sudo useradd -r -m -d /opt/purelyprofit-server -s /usr/sbin/nologin purelyprofit'
echo "       sudo install -d -o ${SERVER_USER} -g purelyprofit -m 775 ${APP_ROOT}/{releases,backups}"
echo "       sudo chown ${SERVER_USER}:purelyprofit ${APP_ROOT}"
echo ''
echo '  1.1) 允许发布用户重启服务（限定到单个 unit，不要给全量 sudo）'
echo "       echo '${SERVER_USER} ALL=(root) NOPASSWD: $(command -v systemctl || echo /usr/bin/systemctl) restart ${APP_SERVICE}, $(command -v systemctl || echo /usr/bin/systemctl) is-active ${APP_SERVICE}' \\"
echo '         | sudo tee /etc/sudoers.d/purelyprofit-release'
echo '       sudo chmod 440 /etc/sudoers.d/purelyprofit-release'
echo ''
echo '  2) 安装运行时依赖（Node 版本见 .nvmrc，pnpm 11、postgresql-client、nginx、curl）'
echo '       curl -fsSL https://get.pnpm.io/install.sh | sh -'
echo "       sudo npm i -g pnpm@11.28.9"
echo ''
echo '  3) 生成生产环境文件（模板见 deploy/production.env.example）'
echo '       sudo install -d -m 750 -o root -g purelyprofit /etc/purelyprofit-server'
echo "       sudo install -m 640 -o root -g purelyprofit deploy/production.env.example ${APP_ENV_FILE}"
echo "       sudo usermod -aG purelyprofit ${SERVER_USER}   # 发布用户需要读 DATABASE_URL 才能执行迁移"
echo '       # 逐项替换 <...> 占位符，密钥生成：openssl rand -base64 48'
echo ''
echo '  4) 注册 systemd 服务'
echo '       sudo cp deploy/systemd/purelyprofit-server.service /etc/systemd/system/'
echo '       sudo systemctl daemon-reload && sudo systemctl enable purelyprofit-server'
echo ''
echo '  5) 部署 Nginx（conf.d 两份 + snippets 一份，缺 snippets 会 include 失败）'
echo '       sudo install -d /etc/nginx/snippets'
echo '       sudo cp deploy/nginx/purelyprofit.conf /etc/nginx/conf.d/api.chunlibao.cn.conf'
echo '       sudo cp deploy/nginx/chunlibao-sites.conf /etc/nginx/conf.d/'
echo '       sudo cp deploy/nginx/snippets/purelyprofit-api-proxy.inc /etc/nginx/snippets/'
echo '       sudo nginx -t && sudo systemctl reload nginx'
echo ''
echo '  6) 首次发布'
echo '       Actions → Deploy Production → Run workflow'
echo '       首次建议 dry_run=true 预演（只打印计划），确认输出无误后再 dry_run=false'
echo '       脚本会自动创建 releases/<git-sha> 与 current 软链，无需手工建目录'
echo ''
echo '  7) 小程序后台配置合法域名'
echo "       request 合法域名: https://${API_DOMAIN}"
echo "       socket  合法域名: wss://${API_DOMAIN}"
echo ''
echo '  详细上线顺序见 docs/launch-checklist.md 第六节。'
echo '════════════════════════════════════════════════════════════════════════'

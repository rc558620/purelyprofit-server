#!/bin/bash
set -euo pipefail

PROJECT_ROOT="/Users/f0rest/Documents/project/react/purelyprofit-server"
cd "$PROJECT_ROOT"

BASE_URL="${SMOKE_BASE_URL:-http://localhost:3000/api}"
TIMEOUT_SECONDS="${SMOKE_TIMEOUT_SECONDS:-10}"
TOKEN="${SMOKE_BEARER_TOKEN:-}"
TOKEN_CMD="${SMOKE_TOKEN_CMD:-node ./scripts/generate-smoke-token.mjs}"
PREPARE_CMD="${SMOKE_PREPARE_CMD:-pnpm run smoke:prepare}"
AUTO_PREPARE_ENABLED="${SMOKE_AUTO_PREPARE_ENABLED:-true}"
AUTO_TOKEN_ENABLED="${SMOKE_AUTO_TOKEN_ENABLED:-true}"
REQUIRE_AUTH="${SMOKE_REQUIRE_AUTH:-false}"
STORE_ID="${SMOKE_STORE_ID:-}"
PROFIT_REPORT_PATH_INPUT="${SMOKE_PROFIT_REPORT_PATH:-}"
PROFIT_REPORT_PATH="$PROFIT_REPORT_PATH_INPUT"

PASS_COUNT=0

is_true() {
  case "${1:-false}" in
    true|TRUE|1|yes|YES|on|ON) return 0 ;;
    *) return 1 ;;
  esac
}

pass() {
  echo "✓ $1"
  PASS_COUNT=$((PASS_COUNT + 1))
}

fail() {
  echo "✗ $1" >&2
  exit 1
}

request_endpoint() {
  local path="$1"
  local auth_header="${2:-}"
  local response

  if [ -n "$auth_header" ]; then
    response=$(curl -sS --max-time "$TIMEOUT_SECONDS" -w "\n%{http_code}" -H "$auth_header" "${BASE_URL}${path}") || \
      fail "请求 ${BASE_URL}${path} 失败"
  else
    response=$(curl -sS --max-time "$TIMEOUT_SECONDS" -w "\n%{http_code}" "${BASE_URL}${path}") || \
      fail "请求 ${BASE_URL}${path} 失败"
  fi

  HTTP_CODE=$(printf '%s' "$response" | tail -n 1)
  BODY=$(printf '%s' "$response" | sed '$d')
}

assert_status_200() {
  local name="$1"
  if [ "$HTTP_CODE" != "200" ]; then
    echo "$BODY" >&2
    fail "$name 返回 HTTP $HTTP_CODE"
  fi
}

apply_smoke_metadata() {
  local metadata="$1"
  local key
  local value

  while IFS='=' read -r key value; do
    case "$key" in
      SMOKE_TOKEN)
        TOKEN="$value"
        export SMOKE_BEARER_TOKEN="$TOKEN"
        ;;
      SMOKE_STORE_ID)
        STORE_ID="$value"
        export SMOKE_STORE_ID="$STORE_ID"
        ;;
      SMOKE_PROFIT_REPORT_PATH)
        if [ -z "$PROFIT_REPORT_PATH_INPUT" ] && [ -n "$value" ]; then
          PROFIT_REPORT_PATH="$value"
        fi
        if [ -n "$value" ]; then
          export SMOKE_PROFIT_REPORT_PATH="$value"
        fi
        ;;
      SMOKE_LOGIN_PHONE|SMOKE_LOGIN_NAME|SMOKE_LOGIN_EMAIL|SMOKE_ACCOUNT_SCOPE|SMOKE_STORE_NAME)
        if [ -n "$value" ]; then
          export "$key=$value"
        fi
        ;;
    esac
  done <<EOF
$metadata
EOF

  TOKEN="$(printf '%s' "$TOKEN" | tr -d '\r\n')"
  STORE_ID="$(printf '%s' "$STORE_ID" | tr -d '\r\n')"
  PROFIT_REPORT_PATH="$(printf '%s' "$PROFIT_REPORT_PATH" | tr -d '\r\n')"
}

ensure_profit_report_path() {
  if [ -n "$PROFIT_REPORT_PATH" ]; then
    return 0
  fi

  if [ -n "$STORE_ID" ]; then
    PROFIT_REPORT_PATH="/profit-detail/report?storeId=${STORE_ID}&period=month"
  else
    PROFIT_REPORT_PATH="/profit-detail/report?storeId=18&period=month"
  fi

  export SMOKE_PROFIT_REPORT_PATH="$PROFIT_REPORT_PATH"
}

auto_prepare_smoke_context() {
  local metadata

  if [ -n "$TOKEN" ] && [ -n "$PROFIT_REPORT_PATH" ]; then
    return 0
  fi

  if [ -n "$STORE_ID" ] || [ -n "$PROFIT_REPORT_PATH" ]; then
    return 0
  fi

  if ! is_true "$AUTO_PREPARE_ENABLED"; then
    return 0
  fi

  if [ -z "$PREPARE_CMD" ]; then
    return 0
  fi

  metadata=$(bash -lc "$PREPARE_CMD") || fail "自动准备 smoke 数据失败"
  printf '%s\n' "$metadata"
  apply_smoke_metadata "$metadata"

  if [ -n "$STORE_ID" ]; then
    echo "- 已通过 SMOKE_PREPARE_CMD 自动准备 smoke 数据"
    echo "- 复用 smoke 门店: $STORE_ID"
  fi
}

auto_resolve_token() {
  local metadata

  auto_prepare_smoke_context

  if [ -n "$TOKEN" ]; then
    return 0
  fi

  if ! is_true "$AUTO_TOKEN_ENABLED"; then
    return 0
  fi

  metadata=$(bash -lc "$TOKEN_CMD") || fail "自动获取 smoke token 失败"
  apply_smoke_metadata "$metadata"

  if [ -z "$TOKEN" ]; then
    fail "自动获取 smoke token 结果为空"
  fi

  ensure_profit_report_path

  echo "- 已通过 SMOKE_TOKEN_CMD 自动获取业务 smoke token"
  echo "- 业务 smoke 路径: $PROFIT_REPORT_PATH"
}

echo "Smoke base url: $BASE_URL"
echo "Smoke auto prepare: $AUTO_PREPARE_ENABLED"
echo "Smoke auto token: $AUTO_TOKEN_ENABLED"
echo

echo "[1/5] 校验根路由"
request_endpoint ""
assert_status_200 "根路由"
pass "根路由返回 200"

echo "[2/5] 校验 healthz"
request_endpoint "/healthz"
assert_status_200 "healthz"
printf '%s' "$BODY" | node -e "const fs=require('fs'); const data=JSON.parse(fs.readFileSync(0,'utf8')); if (data.status !== 'ok') { throw new Error('healthz status 不是 ok'); } if (!data.process || !data.counters) { throw new Error('healthz 缺少 process/counters'); }" >/dev/null || fail "healthz 响应结构不合法"
pass "healthz 返回 ok"

echo "[3/5] 校验 readyz"
request_endpoint "/readyz"
assert_status_200 "readyz"
printf '%s' "$BODY" | node -e "const fs=require('fs'); const data=JSON.parse(fs.readFileSync(0,'utf8')); if (data.status !== 'ok') { throw new Error('readyz status 不是 ok'); } const deps=Array.isArray(data.dependencies) ? data.dependencies : []; const database=deps.find((item)=>item.name==='database'); const redis=deps.find((item)=>item.name==='redis'); if (!database || database.status !== 'up') { throw new Error('database readiness 失败'); } if (!redis || redis.status !== 'up') { throw new Error('redis readiness 失败'); }" >/dev/null || fail "readyz 校验失败"
pass "readyz 返回 database/redis 均为 up"

echo "[4/5] 校验 metrics"
request_endpoint "/metrics"
assert_status_200 "metrics"
printf '%s' "$BODY" | node -e "const fs=require('fs'); const data=JSON.parse(fs.readFileSync(0,'utf8')); const required=['summary','http','sql','redis','cachePrewarm']; for (const key of required) { if (!(key in data)) { throw new Error('metrics 缺少 '+key); } }" >/dev/null || fail "metrics 响应结构不合法"
pass "metrics 响应结构完整"

echo "[5/5] 校验受保护业务接口"
auto_resolve_token
if [ -n "$TOKEN" ]; then
  ensure_profit_report_path
  request_endpoint "$PROFIT_REPORT_PATH" "Authorization: Bearer $TOKEN"
  assert_status_200 "利润报表接口"
  printf '%s' "$BODY" | node -e "const fs=require('fs'); const data=JSON.parse(fs.readFileSync(0,'utf8')); if (typeof data !== 'object' || data === null) { throw new Error('response 不是对象'); }" >/dev/null || fail "利润报表返回结构非法"
  pass "利润报表接口返回 200"
else
  if [ "$REQUIRE_AUTH" = "true" ]; then
    fail "SMOKE_BEARER_TOKEN 未提供，且自动取 token 未生效，无法执行受保护接口校验"
  fi
  echo "- 未提供 SMOKE_BEARER_TOKEN，且未自动获取 token，跳过受保护接口冒烟"
fi

echo
echo "Smoke 完成，共通过 ${PASS_COUNT} 项校验"

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
CLUB_LOGIN_EMAIL="${SMOKE_CLUB_LOGIN_EMAIL:-}"
PULSE_LOGIN_EMAIL="${SMOKE_PULSE_LOGIN_EMAIL:-}"
CLUB_PROFILE_PATH="${SMOKE_CLUB_PROFILE_PATH:-/club/member/profile}"
CLUB_CURRENT_STORE_PATH="${SMOKE_CLUB_CURRENT_STORE_PATH:-/club/stores/current}"
PULSE_SWITCH_STORE_PATH="${SMOKE_PULSE_SWITCH_STORE_PATH:-/pulse/session/current-store}"
PULSE_BOOTSTRAP_PATH="${SMOKE_PULSE_BOOTSTRAP_PATH:-/pulse/session/bootstrap}"

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
  local method="${3:-GET}"
  local body="${4:-}"
  local response
  local -a curl_args

  curl_args=(
    -sS
    --max-time "$TIMEOUT_SECONDS"
    -w "\n%{http_code}"
    -X "$method"
  )

  if [ -n "$auth_header" ]; then
    curl_args+=(-H "$auth_header")
  fi

  if [ -n "$body" ]; then
    curl_args+=(-H "Content-Type: application/json" --data "$body")
  fi

  response=$(curl "${curl_args[@]}" "${BASE_URL}${path}") || \
    fail "请求 ${BASE_URL}${path} 失败"

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

extract_metadata_value() {
  local metadata="$1"
  local key="$2"

  printf '%s\n' "$metadata" | awk -F= -v target="$key" '$1 == target {print substr($0, length($1) + 2); exit}'
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
      SMOKE_CLUB_LOGIN_EMAIL)
        if [ -n "$value" ]; then
          CLUB_LOGIN_EMAIL="$value"
          export SMOKE_CLUB_LOGIN_EMAIL="$value"
        fi
        ;;
      SMOKE_PULSE_LOGIN_EMAIL)
        if [ -n "$value" ]; then
          PULSE_LOGIN_EMAIL="$value"
          export SMOKE_PULSE_LOGIN_EMAIL="$value"
        fi
        ;;
      SMOKE_CLUB_PROFILE_PATH)
        if [ -n "$value" ]; then
          CLUB_PROFILE_PATH="$value"
          export SMOKE_CLUB_PROFILE_PATH="$value"
        fi
        ;;
      SMOKE_CLUB_CURRENT_STORE_PATH)
        if [ -n "$value" ]; then
          CLUB_CURRENT_STORE_PATH="$value"
          export SMOKE_CLUB_CURRENT_STORE_PATH="$value"
        fi
        ;;
      SMOKE_PULSE_SWITCH_STORE_PATH)
        if [ -n "$value" ]; then
          PULSE_SWITCH_STORE_PATH="$value"
          export SMOKE_PULSE_SWITCH_STORE_PATH="$value"
        fi
        ;;
      SMOKE_PULSE_BOOTSTRAP_PATH)
        if [ -n "$value" ]; then
          PULSE_BOOTSTRAP_PATH="$value"
          export SMOKE_PULSE_BOOTSTRAP_PATH="$value"
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

  if [ -z "$PULSE_LOGIN_EMAIL" ] && [ -n "${SMOKE_LOGIN_EMAIL:-}" ]; then
    PULSE_LOGIN_EMAIL="${SMOKE_LOGIN_EMAIL}"
    export SMOKE_PULSE_LOGIN_EMAIL="$PULSE_LOGIN_EMAIL"
  fi

  TOKEN="$(printf '%s' "$TOKEN" | tr -d '\r\n')"
  STORE_ID="$(printf '%s' "$STORE_ID" | tr -d '\r\n')"
  PROFIT_REPORT_PATH="$(printf '%s' "$PROFIT_REPORT_PATH" | tr -d '\r\n')"
  CLUB_LOGIN_EMAIL="$(printf '%s' "$CLUB_LOGIN_EMAIL" | tr -d '\r\n')"
  PULSE_LOGIN_EMAIL="$(printf '%s' "$PULSE_LOGIN_EMAIL" | tr -d '\r\n')"
  CLUB_PROFILE_PATH="$(printf '%s' "$CLUB_PROFILE_PATH" | tr -d '\r\n')"
  CLUB_CURRENT_STORE_PATH="$(printf '%s' "$CLUB_CURRENT_STORE_PATH" | tr -d '\r\n')"
  PULSE_SWITCH_STORE_PATH="$(printf '%s' "$PULSE_SWITCH_STORE_PATH" | tr -d '\r\n')"
  PULSE_BOOTSTRAP_PATH="$(printf '%s' "$PULSE_BOOTSTRAP_PATH" | tr -d '\r\n')"
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

  if [ -n "$TOKEN" ] && [ -n "$STORE_ID" ]; then
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

auto_resolve_profit_token() {
  local metadata

  auto_prepare_smoke_context

  if [ -n "$TOKEN" ]; then
    return 0
  fi

  if ! is_true "$AUTO_TOKEN_ENABLED"; then
    return 0
  fi

  metadata=$(bash -lc "$TOKEN_CMD") || fail "自动获取 purely-profit smoke token 失败"
  apply_smoke_metadata "$metadata"

  if [ -z "$TOKEN" ]; then
    fail "自动获取 purely-profit smoke token 结果为空"
  fi

  ensure_profit_report_path

  echo "- 已通过 SMOKE_TOKEN_CMD 自动获取 purely-profit smoke token"
  echo "- purely-profit smoke 路径: $PROFIT_REPORT_PATH"
}

resolve_scoped_token() {
  local scope="$1"
  local login_email="$2"
  local metadata
  local scoped_token

  if [ -z "$login_email" ]; then
    fail "缺少 ${scope} smoke 登录邮箱，无法生成对应 token"
  fi

  metadata=$(
    SMOKE_ACCOUNT_SCOPE="$scope" \
      SMOKE_LOGIN_EMAIL="$login_email" \
      SMOKE_STORE_ID="$STORE_ID" \
      bash -lc "$TOKEN_CMD"
  ) || fail "自动获取 ${scope} smoke token 失败"

  scoped_token="$(extract_metadata_value "$metadata" 'SMOKE_TOKEN')"
  scoped_token="$(printf '%s' "$scoped_token" | tr -d '\r\n')"
  if [ -z "$scoped_token" ]; then
    fail "自动获取 ${scope} smoke token 结果为空"
  fi

  printf '%s' "$scoped_token"
}

echo "Smoke base url: $BASE_URL"
echo "Smoke auto prepare: $AUTO_PREPARE_ENABLED"
echo "Smoke auto token: $AUTO_TOKEN_ENABLED"
echo

echo "[1/8] 校验根路由"
request_endpoint ""
assert_status_200 "根路由"
pass "根路由返回 200"

echo "[2/8] 校验 healthz"
request_endpoint "/healthz"
assert_status_200 "healthz"
printf '%s' "$BODY" | node -e "const fs=require('fs'); const data=JSON.parse(fs.readFileSync(0,'utf8')); if (data.status !== 'ok') { throw new Error('healthz status 不是 ok'); } if (!data.process || !data.counters) { throw new Error('healthz 缺少 process/counters'); }" >/dev/null || fail "healthz 响应结构不合法"
pass "healthz 返回 ok"

echo "[3/8] 校验 readyz"
request_endpoint "/readyz"
assert_status_200 "readyz"
printf '%s' "$BODY" | node -e "const fs=require('fs'); const data=JSON.parse(fs.readFileSync(0,'utf8')); if (data.status !== 'ok') { throw new Error('readyz status 不是 ok'); } const deps=Array.isArray(data.dependencies) ? data.dependencies : []; const database=deps.find((item)=>item.name==='database'); const redis=deps.find((item)=>item.name==='redis'); if (!database || database.status !== 'up') { throw new Error('database readiness 失败'); } if (!redis || redis.status !== 'up') { throw new Error('redis readiness 失败'); }" >/dev/null || fail "readyz 校验失败"
pass "readyz 返回 database/redis 均为 up"

echo "[4/8] 校验 metrics"
request_endpoint "/metrics"
assert_status_200 "metrics"
printf '%s' "$BODY" | node -e "const fs=require('fs'); const data=JSON.parse(fs.readFileSync(0,'utf8')); const required=['summary','http','sql','redis','cachePrewarm']; for (const key of required) { if (!(key in data)) { throw new Error('metrics 缺少 '+key); } }" >/dev/null || fail "metrics 响应结构不合法"
pass "metrics 响应结构完整"

echo "[5/8] 校验 purely-profit 受保护接口"
auto_resolve_profit_token
if [ -n "$TOKEN" ]; then
  ensure_profit_report_path
  request_endpoint "$PROFIT_REPORT_PATH" "Authorization: Bearer $TOKEN"
  assert_status_200 "利润报表接口"
  printf '%s' "$BODY" | node -e "const fs=require('fs'); const data=JSON.parse(fs.readFileSync(0,'utf8')); if (typeof data !== 'object' || data === null) { throw new Error('response 不是对象'); }" >/dev/null || fail "利润报表返回结构非法"
  pass "purely-profit 利润报表接口返回 200"
else
  if [ "$REQUIRE_AUTH" = "true" ]; then
    fail "SMOKE_BEARER_TOKEN 未提供，且自动取 token 未生效，无法执行 purely-profit 冒烟"
  fi
  echo "- 未提供 purely-profit token，跳过 purely-profit 冒烟"
fi

echo "[6/8] 校验 purely-club 最小闭环"
auto_prepare_smoke_context
if [ -n "$STORE_ID" ] && [ -n "$CLUB_LOGIN_EMAIL" ]; then
  CLUB_TOKEN="$(resolve_scoped_token 'purely_club' "$CLUB_LOGIN_EMAIL")"
  request_endpoint "$CLUB_PROFILE_PATH" "Authorization: Bearer $CLUB_TOKEN"
  assert_status_200 "purely-club 资料接口"
  printf '%s' "$BODY" | node -e "const fs=require('fs'); const data=JSON.parse(fs.readFileSync(0,'utf8')); if (!data || typeof data !== 'object') { throw new Error('profile 不是对象'); } if (!data.id || !data.phone) { throw new Error('profile 缺少 id/phone'); }" >/dev/null || fail "purely-club 资料响应非法"

  request_endpoint "$CLUB_CURRENT_STORE_PATH" "Authorization: Bearer $CLUB_TOKEN"
  assert_status_200 "purely-club 当前门店接口"
  printf '%s' "$BODY" | node -e "const fs=require('fs'); const data=JSON.parse(fs.readFileSync(0,'utf8')); const expectedStoreId=process.env.SMOKE_STORE_ID; if (!data || typeof data !== 'object') { throw new Error('store 不是对象'); } if (!String(data.id || '') || !data.name) { throw new Error('store 缺少 id/name'); } if (expectedStoreId && String(data.id) !== expectedStoreId) { throw new Error('当前门店与 smoke 门店不一致'); }" >/dev/null || fail "purely-club 当前门店响应非法"
  pass "purely-club 资料与当前门店接口返回 200"
else
  if [ "$REQUIRE_AUTH" = "true" ]; then
    fail "缺少 purely-club smoke 元信息，无法执行 purely-club 冒烟"
  fi
  echo "- 缺少 purely-club smoke 元信息，跳过 purely-club 冒烟"
fi

echo "[7/8] 校验 purely-pulse 目标门店切换"
auto_prepare_smoke_context
if [ -n "$STORE_ID" ] && [ -n "$PULSE_LOGIN_EMAIL" ]; then
  PULSE_TOKEN="$(resolve_scoped_token 'developer' "$PULSE_LOGIN_EMAIL")"
  request_endpoint "$PULSE_SWITCH_STORE_PATH" "Authorization: Bearer $PULSE_TOKEN" "PATCH" "{\"storeId\":${STORE_ID}}"
  assert_status_200 "purely-pulse 切换目标门店接口"
  printf '%s' "$BODY" | node -e "const fs=require('fs'); const data=JSON.parse(fs.readFileSync(0,'utf8')); const expectedStoreId=process.env.SMOKE_STORE_ID; if (!data || data.success !== true) { throw new Error('switchCurrentStore success 不是 true'); } if (!data.store || String(data.store.id) !== expectedStoreId) { throw new Error('切换后的门店不匹配'); }" >/dev/null || fail "purely-pulse 切换目标门店响应非法"
  pass "purely-pulse 切换目标门店返回 200"
else
  if [ "$REQUIRE_AUTH" = "true" ]; then
    fail "缺少 purely-pulse smoke 元信息，无法执行 purely-pulse 冒烟"
  fi
  echo "- 缺少 purely-pulse smoke 元信息，跳过 purely-pulse 切换目标门店冒烟"
fi

echo "[8/8] 校验 purely-pulse 首屏上下文"
if [ -n "${PULSE_TOKEN:-}" ]; then
  request_endpoint "$PULSE_BOOTSTRAP_PATH" "Authorization: Bearer $PULSE_TOKEN"
  assert_status_200 "purely-pulse 首屏上下文接口"
  printf '%s' "$BODY" | node -e "const fs=require('fs'); const data=JSON.parse(fs.readFileSync(0,'utf8')); const expectedStoreId=process.env.SMOKE_STORE_ID; if (!data || typeof data !== 'object') { throw new Error('bootstrap 不是对象'); } if (data.mode !== 'developer') { throw new Error('pulse mode 不是 developer'); } if (!data.user || !data.user.id) { throw new Error('bootstrap 缺少 user'); } if (!data.store || String(data.store.id) !== expectedStoreId) { throw new Error('bootstrap store 不匹配'); } if (data.targetStoreSelected !== true) { throw new Error('targetStoreSelected 不是 true'); }" >/dev/null || fail "purely-pulse 首屏上下文响应非法"
  pass "purely-pulse 首屏上下文返回 200"
else
  if [ "$REQUIRE_AUTH" = "true" ]; then
    fail "缺少 purely-pulse token，无法执行 purely-pulse 首屏上下文冒烟"
  fi
  echo "- 缺少 purely-pulse token，跳过 purely-pulse 首屏上下文冒烟"
fi

echo
echo "Smoke 完成，共通过 ${PASS_COUNT} 项校验"

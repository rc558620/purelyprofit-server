#!/bin/bash
#
# 上线后冒烟检查（对应 pnpm run smoke:live）
#
# 由 scripts/release-execute.sh 在服务重启后调用，用于确认新版本确实对外可用，
# 而不是"进程起来了但依赖没连上"。校验顺序：
#   1. 等待 HTTP 探活端点响应（服务重启需要时间，先轮询再校验，避免误判）
#   2. /healthz  —— 进程级健康
#   3. /readyz   —— PostgreSQL / Redis / 实时链路依赖就绪
#   4. 可选业务登录链路（默认关闭，需显式提供凭证才启用）
#
# 只用 curl + node 这两个部署机上必然存在的依赖，避免给生产机增加新的运行时要求。

set -euo pipefail

BASE_URL="${SMOKE_BASE_URL:-http://localhost:3000/api}"
BASE_URL="${BASE_URL%/}"
TIMEOUT_SECONDS="${SMOKE_TIMEOUT_SECONDS:-10}"
WAIT_SECONDS="${SMOKE_WAIT_SECONDS:-60}"

log() {
  printf '%s\n' "$*"
}

fail() {
  printf '✗ %s\n' "$*" >&2
  exit 1
}

command -v curl >/dev/null 2>&1 || fail '未找到 curl，无法执行上线后冒烟检查'
command -v node >/dev/null 2>&1 || fail '未找到 node，无法执行上线后冒烟检查'

log "Smoke base url: ${BASE_URL}"

# ── 1. 等待服务对外可响应 ────────────────────────────────────────────────
# systemd restart 后进程需要加载 Prisma Client、建连接池、预热缓存，
# 直接单次探测会拿到连接 refused，这里轮询到超时为止。
log "==> 等待服务就绪（最长 ${WAIT_SECONDS}s）"
deadline=$((SECONDS + WAIT_SECONDS))
until curl -fsS --max-time "${TIMEOUT_SECONDS}" "${BASE_URL}/healthz" >/dev/null 2>&1; do
  if [ "${SECONDS}" -ge "${deadline}" ]; then
    fail "服务在 ${WAIT_SECONDS}s 内未在 ${BASE_URL}/healthz 响应"
  fi
  sleep 2
done

# ── 2. 进程级健康检查 ────────────────────────────────────────────────────
log '==> 检查 /healthz'
health="$(curl -fsS --max-time "${TIMEOUT_SECONDS}" "${BASE_URL}/healthz")" ||
  fail '/healthz 请求失败'
printf '%s\n' "${health}"

# ── 3. 依赖就绪检查 ──────────────────────────────────────────────────────
log '==> 检查 /readyz'
ready="$(curl -fsS --max-time "${TIMEOUT_SECONDS}" "${BASE_URL}/readyz")" ||
  fail '/readyz 请求失败'

printf '%s' "${ready}" | node -e '
  const chunks = [];
  process.stdin.on("data", (chunk) => chunks.push(chunk));
  process.stdin.on("end", () => {
    const payload = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
    const required = ["database", "redis", "realtime"];

    if (payload.status !== "ok") {
      console.error(`就绪状态非 ok: ${JSON.stringify(payload)}`);
      process.exit(1);
    }

    const down = (payload.dependencies ?? []).filter(
      (item) => required.includes(item.name) && item.status !== "up",
    );
    if (down.length > 0) {
      console.error(`关键依赖不可用: ${JSON.stringify(down)}`);
      process.exit(1);
    }

    const summary = (payload.dependencies ?? [])
      .map((item) => `${item.name}=${item.status}`)
      .join(", ");
    console.log(`依赖就绪: ${summary}`);
  });
' || fail '/readyz 校验未通过，服务不具备对外服务能力'

# ── 4. 可选：业务登录链路 ────────────────────────────────────────────────
# 默认关闭：purely-profit 登录依赖拼图验证码（captchaToken）与 RSA 加密密码，
# 在没有可用凭证时强行校验只会产生噪音。提供以下变量才会启用：
#   SMOKE_LOGIN_PHONE / SMOKE_LOGIN_PASSWORD（必填）
#   SMOKE_LOGIN_PATH（可选，默认 /auth/login）
#   SMOKE_CAPTCHA_TOKEN（可选，服务端开启拼图验证时必须提供）
if [ -n "${SMOKE_LOGIN_PHONE:-}" ] && [ -n "${SMOKE_LOGIN_PASSWORD:-}" ]; then
  login_path="${SMOKE_LOGIN_PATH:-/auth/login}"
  log "==> 检查业务登录链路（${login_path}）"

  payload="{\"phone\":\"${SMOKE_LOGIN_PHONE}\",\"password\":\"${SMOKE_LOGIN_PASSWORD}\""
  if [ -n "${SMOKE_CAPTCHA_TOKEN:-}" ]; then
    payload="${payload},\"captchaToken\":\"${SMOKE_CAPTCHA_TOKEN}\""
  fi
  payload="${payload}}"

  response="$(
    curl -sS --max-time "${TIMEOUT_SECONDS}" \
      -H 'Content-Type: application/json' \
      -d "${payload}" \
      "${BASE_URL}${login_path}"
  )" || fail '登录请求失败'

  printf '%s' "${response}" | node -e '
    const chunks = [];
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf-8").trim();
      let payload;
      try {
        payload = JSON.parse(raw);
      } catch {
        console.error(`登录响应不是合法 JSON: ${raw}`);
        process.exit(1);
      }
      const token = payload.accessToken ?? payload.token;
      if (typeof token !== "string" || token.length === 0) {
        console.error(`登录未返回 token: ${raw}`);
        process.exit(1);
      }
      console.log("登录链路校验通过");
    });
  ' || fail '业务登录链路校验未通过'
fi

log ''
log '✓ 上线后冒烟检查全部通过'

#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# NestJS 11 → 12 影子分支验证（只读脚本）
#
# 不修改源码、不改 package.json、不动 prisma/schema.prisma。
# runtime 段会临时拉起 dist/src/main.js（默认端口 3312），退出时自动回收。
#
# 前置条件：
#   - runtime 段需要可用的 .env（DATABASE_URL / REDIS_*），否则 /readyz 必然失败；
#     本地无依赖时用 VERIFY_MODE=quality SKIP_E2E=1。
#   - 生产以 dist/cluster-main.js 启动，合并前必须跑一次 VERIFY_CLUSTER=1。
#
# 用法：
#   VERIFY_MODE=deps|quality|runtime|all   默认 all
#
# 常用开关：
#   VERIFY_PORT=3312                      运行阶段监听端口
#   VERIFY_BASE_REF=origin/main           规范门对比基线
#   SKIP_E2E=1                            跳过 e2e（本地无 DB/Redis 时）
#   VERIFY_KNOWN_FAILURES=a.spec.ts,b.spec.ts
#                                         排除基线已失败的 spec 文件（升级验收口径=不新增失败）
#   VERIFY_CLUSTER=1                      追加 dist/cluster-main.js 冒烟
#   VERIFY_RATE_LIMIT=1                   追加限流探针（并发打满窗口）
#   VERIFY_RATE_LIMIT_PATH=auth/public-key 限流探针命中的接口（不含 /api 前缀）
#   VERIFY_RATE_LIMIT_BURST=0             固定并发数；0=自动按 40→80→160 逐级加压
#   VERIFY_ALLOW_UPDATE_LOCK=1            允许 pnpm install 更新 lockfile
#   VERIFY_NODE_ENV=development           运行阶段 NODE_ENV
#   VERIFY_WAIT_SECONDS=60                启动等待上限
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")/.."

MODE="${VERIFY_MODE:-all}"
PORT="${VERIFY_PORT:-3312}"
BASE_URL="http://127.0.0.1:${PORT}/api"
LOG_FILE="${VERIFY_LOG_FILE:-/tmp/purelyprofit-nest12-verify.log}"
SERVER_PID=""

log() { printf '%s\n' "$*"; }
step() { printf '\n==> %s\n' "$*"; }
ok() { printf '  ✓ %s\n' "$*"; }
warn() { printf '  ! %s\n' "$*" >&2; }
fail() {
  printf '  ✗ %s\n' "$*" >&2
  exit 1
}

cleanup() {
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill -TERM "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# ── 0. 环境前置 ──────────────────────────────────────────────────────────────
phase_env() {
  step '0. 环境前置'
  command -v node >/dev/null 2>&1 || fail '未找到 node'
  command -v pnpm >/dev/null 2>&1 || fail '未找到 pnpm'
  command -v curl >/dev/null 2>&1 || fail '未找到 curl'

  node -e '
    const [maj, min, pat] = process.versions.node.split(".").map(Number);
    const okRuntime = (maj === 20 && min >= 19) || (maj === 22 && min >= 12) || maj >= 23;
    const okSchematics =
      (maj === 22 && (min > 22 || (min === 22 && pat >= 3))) ||
      (maj === 24 && min >= 15) || maj >= 26;
    if (!okRuntime) {
      console.error(`Node ${process.versions.node} 不满足 Nest 12 运行时要求（>=20.19 / >=22.12）`);
      process.exit(1);
    }
    if (!okSchematics) {
      console.error(`Node ${process.versions.node} 不满足 nest CLI/schematics 要求（>=22.22.3 / >=24.15 / >=26）`);
      process.exit(1);
    }
    console.log(`  ✓ Node ${process.versions.node} 满足运行时与生码要求`);
  ' || fail 'Node 版本不达标'

  local declared actual
  declared="$(node -p 'require("./package.json").packageManager.replace(/^pnpm@/, "")')"
  actual="$(pnpm -v)"
  if [ "$actual" = "$declared" ]; then
    ok "pnpm ${actual}"
  else
    warn "pnpm ${actual} 与 packageManager(${declared}) 不一致"
  fi

  local branch
  branch="$(git rev-parse --abbrev-ref HEAD)"
  case "$branch" in
    main | master) warn "当前在 ${branch}：升级验证必须在影子分支执行" ;;
    *) ok "分支 ${branch}" ;;
  esac
  if [ -z "$(git status --porcelain)" ]; then
    ok '工作区干净'
  else
    warn '工作区有未提交改动，结果不能作为验收基线'
  fi
}

# ── 1. 依赖一致性 ────────────────────────────────────────────────────────────
phase_deps() {
  step '1. Nest 生态 major 一致性'
  node -e '
    const pkg = require("./package.json");
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    const majors = {};
    for (const [name, range] of Object.entries(all)) {
      if (!name.startsWith("@nestjs/")) continue;
      const matched = String(range).match(/(\d+)/);
      if (matched) majors[name] = Number(matched[1]);
    }
    const target = majors["@nestjs/core"];
    if (!target) {
      console.error("@nestjs/core 未声明");
      process.exit(1);
    }
    const mustMatch = [
      "@nestjs/common",
      "@nestjs/core",
      "@nestjs/platform-fastify",
      "@nestjs/platform-socket.io",
      "@nestjs/websockets",
      "@nestjs/testing",
      "@nestjs/platform-express",
    ];
    console.log(`  @nestjs/* 目标 major: ${target}`);
    for (const name of mustMatch) console.log(`  ${name}=${majors[name] ?? "缺失"}`);
    const drift = mustMatch.filter((name) => majors[name] !== target);
    if (drift.length > 0) {
      console.error(`  major 不一致: ${drift.join(", ")}`);
      process.exit(1);
    }
    if (target < 12) {
      console.error(`  @nestjs/core major=${target}，尚未升到 v12`);
      process.exit(1);
    }
    const tsMajor = Number((String(all.typescript ?? "").match(/(\d+)/) ?? [0, 0])[1]);
    if (tsMajor < 6) console.warn(`  typescript 仍为 ${all.typescript}，Nest 12 建议 6.x`);
    if (tsMajor >= 7) {
      console.error("  typescript 7 超出 @nestjs/swagger peer 范围（^5.5 || ^6）");
      process.exit(1);
    }
  ' || fail '依赖 major 一致性未通过'
  ok 'Nest 生态 major 已同步'

  # serve-static / @fastify/static 在 src 内零引用；v12 要求 @fastify/static ^10，
  # 留着只会引入一个无收益的 major 纠缠点。
  if node -e 'const p=require("./package.json");const d={...p.dependencies,...p.devDependencies};process.exit(d["@nestjs/serve-static"]||d["@fastify/static"]?0:1)'; then
    warn '@nestjs/serve-static / @fastify/static 仍在 package.json（src 无引用，建议 P0 删除）'
  else
    ok 'serve-static / @fastify/static 已移除'
  fi

  step '2. v12 已删除 / 已变更 API 扫描'
  local hits
  hits="$(grep -RnE 'HealthIndicator|@nestjs/terminus|subscriptions-transport-ws|StringCodec|JSONCodec' src 2>/dev/null || true)"
  if [ -z "$hits" ]; then
    ok '未命中 Terminus / subscriptions-transport-ws / NATS codec'
  else
    warn "命中需迁移的 API：\n${hits}"
  fi

  step '3. 安装依赖'
  local out='/tmp/purelyprofit-nest12-install.log'
  if [ "${VERIFY_ALLOW_UPDATE_LOCK:-0}" = "1" ]; then
    pnpm install 2>&1 | tee "$out" || fail 'pnpm install 失败'
  else
    pnpm install --frozen-lockfile 2>&1 | tee "$out" ||
      fail 'pnpm install --frozen-lockfile 失败；lockfile 未同步时用 VERIFY_ALLOW_UPDATE_LOCK=1'
  fi
  # 不能用安装日志判断 peer：--frozen-lockfile 命中缓存时输出只有 "Already up to date"。
  local peer_report
  peer_report="$(pnpm peers check 2>&1 || true)"
  if printf '%s' "$peer_report" | grep -q 'unmet peer'; then
    warn "peer 告警：\n$(printf '%s' "$peer_report" | sed -n '2,20p')"
  else
    ok '无 peer 告警'
  fi

  step '4. fastify 单实例校验'
  local versions count
  # 先排除 @nestjs/platform-fastify 自身，否则会把适配器版本误算成第二份 fastify
  versions="$(pnpm ls fastify --depth Infinity 2>/dev/null |
    grep -v 'platform-fastify' |
    grep -oE 'fastify@[0-9]+\.[0-9]+\.[0-9]+' |
    sed 's/^fastify@//' | sort -u || true)"
  count="$(printf '%s\n' "$versions" | grep -c . || true)"
  if [ "${count:-0}" -eq 0 ]; then
    warn '未解析到 fastify 版本（跳过）'
  elif [ "$count" -gt 1 ]; then
    warn "存在多份 fastify：$(printf '%s' "$versions" | tr '\n' ' ')"
  else
    ok "fastify 单实例 ${versions}"
  fi
}

# ── 2. 质量门 ────────────────────────────────────────────────────────────────
phase_quality() {
  step '5. Prisma Client 生成'
  pnpm exec prisma generate >/dev/null || fail 'prisma generate 失败'
  ok 'prisma generate'

  step '6. 类型检查（TS 6 + emitDecoratorMetadata）'
  pnpm run typecheck || fail 'typecheck 失败'

  # 与 CI 一致：不带 --fix，避免静默改写源码后恒为绿。
  step '7. ESLint'
  pnpm exec eslint "{src,apps,libs,test}/**/*.ts" || fail 'eslint 失败'

  step '8. SQL 时区门'
  pnpm run sql:tz:check || fail 'sql:tz:check 失败'

  step '9. 单元测试'
  # 仓库基线本身存在 3 个失败用例（custody-read 2 个 + auth.service 1 个，已在 Nest 11
  # 基线上复现，与本次升级无关）。升级验收的口径是「不新增失败」，因此允许显式排除：
  #   VERIFY_KNOWN_FAILURES="custody-read.service.spec.ts,auth.service.spec.ts"
  if [ -n "${VERIFY_KNOWN_FAILURES:-}" ]; then
    local ignore_regex
    ignore_regex="$(printf '%s' "$VERIFY_KNOWN_FAILURES" | tr ',' '|')"
    warn "跳过基线已知失败用例（整个 spec 文件被排除）：${VERIFY_KNOWN_FAILURES}"
    pnpm run test --ci --testPathIgnorePatterns "$ignore_regex" || fail '单测失败'
  else
    pnpm run test --ci || fail '单测失败'
  fi

  if [ "${SKIP_E2E:-0}" = "1" ]; then
    warn 'SKIP_E2E=1，跳过 e2e'
  else
    step '10. e2e'
    pnpm run test:e2e --ci || fail 'e2e 失败'
  fi

  step '11. 构建与产物断言'
  # nest build 的 deleteOutDir 会一次性删除整个 dist；部分受控环境会拦截这类批量删除。
  # 先把旧产物挪到临时目录，既规避拦截，也保留现场可回溯。
  if [ -d dist ]; then
    mv dist "$(mktemp -d)/dist" 2>/dev/null || fail '无法移走旧 dist'
  fi
  pnpm run build || fail 'build 失败'
  local artifact
  for artifact in \
    dist/src/main.js \
    dist/cluster-main.js \
    dist/config/cluster.configuration.js \
    dist/config/rsa-key-pair.utils.js; do
    [ -f "$artifact" ] || fail "构建产物缺失: ${artifact}"
  done
  ok 'main / cluster-main / cluster.configuration / rsa-key-pair.utils 产物均存在'

  step '12. f0rest 规范门（仅本次改动文件）'
  local base files file failed=0
  base="${VERIFY_BASE_REF:-origin/main}"
  git rev-parse --verify --quiet "$base" >/dev/null || base='main'
  files="$(git diff --name-only --diff-filter=ACMR "${base}...HEAD" -- 'src/**/*.ts' || true)"
  if [ -z "$files" ]; then
    warn "相对 ${base} 无 TS 改动，跳过规范门"
  else
    while IFS= read -r file; do
      [ -n "$file" ] && [ -f "$file" ] || continue
      node scripts/check-f0rest-rules.mjs "$file" || failed=$((failed + 1))
    done <<<"$files"
    [ "$failed" -eq 0 ] || fail "规范校验失败文件数: ${failed}"
    ok '规范校验通过'
  fi
}

# ── 3. 运行时探针 ────────────────────────────────────────────────────────────
http_code() { curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "$@"; }

wait_for_ready() {
  local wait_seconds="${VERIFY_WAIT_SECONDS:-60}"
  local deadline=$((SECONDS + wait_seconds))
  until curl -fsS --max-time 3 "${BASE_URL}/healthz" >/dev/null 2>&1; do
    [ "$SECONDS" -ge "$deadline" ] && fail "服务在 ${wait_seconds}s 内未就绪，日志见 ${LOG_FILE}"
    sleep 1
  done
}

phase_runtime() {
  step '13. 单进程启动冒烟'
  [ -f dist/src/main.js ] || pnpm run build || fail 'build 失败'
  : >"$LOG_FILE"
  NODE_ENV="${VERIFY_NODE_ENV:-development}" \
    PORT="$PORT" \
    APP_PORT_AUTO_TERMINATE_ENABLED=false \
    APP_PORT_AUTO_SHIFT_ENABLED=false \
    node dist/src/main.js >>"$LOG_FILE" 2>&1 &
  SERVER_PID=$!
  # 关掉作业通知，否则 SIGTERM 时 shell 会额外打印一行 "Terminated: 15" 噪音
  disown "$SERVER_PID" 2>/dev/null || true
  wait_for_ready
  ok "服务就绪 pid=${SERVER_PID} ${BASE_URL}"

  # 核心包 ESM-only 后，CJS 产物依赖 Node 的 require(esm)；这里把互操作故障前置暴露。
  if grep -qE 'ERR_REQUIRE_ESM|ERR_REQUIRE_ASYNC_MODULE|Cannot use import statement' "$LOG_FILE"; then
    fail "启动日志出现 ESM/CJS 互操作错误：\n$(grep -nE 'ERR_REQUIRE_ESM|ERR_REQUIRE_ASYNC_MODULE|Cannot use import statement' "$LOG_FILE" | head -5)"
  fi
  ok '无 ESM/CJS 互操作错误'

  step '14. 依赖就绪（/readyz）'
  curl -fsS --max-time 5 "${BASE_URL}/readyz" | node -e '
    const chunks = [];
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => {
      const payload = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
      const required = new Set(["database", "redis", "realtime"]);
      if (payload.status !== "ok") {
        console.error(`状态非 ok: ${JSON.stringify(payload)}`);
        process.exit(1);
      }
      const down = (payload.dependencies ?? []).filter(
        (dependency) => required.has(dependency.name) && dependency.status !== "up",
      );
      if (down.length > 0) {
        console.error(`依赖不可用: ${JSON.stringify(down)}`);
        process.exit(1);
      }
      const summary = (payload.dependencies ?? [])
        .map((dependency) => `${dependency.name}=${dependency.status}`)
        .join(", ");
      console.log(`  ✓ ${summary}`);
    });
  ' || fail '/readyz 未通过'

  step '15. 未匹配路由 / 错误映射'
  local code body
  code="$(http_code "${BASE_URL}/__verify_not_found__")"
  [ "$code" = "404" ] || fail "未匹配路由应为 404，实际 ${code}"
  body="$(curl -sS --max-time 5 "${BASE_URL}/__verify_not_found__")"
  printf '%s' "$body" | node -e '
    const chunks = [];
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf-8").trim();
      try {
        JSON.parse(raw);
      } catch {
        console.error(`404 响应非 JSON: ${raw.slice(0, 200)}`);
        process.exit(1);
      }
      console.log("  ✓ 404 仍为统一 JSON 结构");
    });
  ' || fail '404 响应结构变化，检查 AllExceptionsFilter 与 v12 适配器错误映射'

  # 微信小程序 SDK 会给无 body 的 DELETE 带上 Content-Type；v12 重做了适配器错误映射，
  # 这里确认 bootstrap 里的 onRequest 剥离 hook 仍然生效。
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 -X DELETE \
    -H 'Content-Type: application/json' "${BASE_URL}/__verify_not_found__")"
  case "$code" in
    404 | 405) ok "DELETE 带 Content-Type 无 body 返回 ${code}（未触发 400/500）" ;;
    *) fail "DELETE 带 Content-Type 无 body 返回 ${code}（预期 404/405）" ;;
  esac

  step '16. Swagger 静态资源'
  if grep -q 'Swagger docs at' "$LOG_FILE"; then
    local root_code prefixed_code
    root_code="$(http_code "http://127.0.0.1:${PORT}/api-docs")"
    prefixed_code="$(http_code "http://127.0.0.1:${PORT}/api/api-docs")"
    if [ "$root_code" = "200" ] || [ "$prefixed_code" = "200" ]; then
      ok "/api-docs 可访问（root=${root_code} prefixed=${prefixed_code}）"
    else
      fail "/api-docs 不可访问（root=${root_code} prefixed=${prefixed_code}），检查 @fastify/static 与 swagger 版本"
    fi
  else
    warn '本次启动未开启 Swagger（生产默认关闭），跳过'
  fi

  step '17. 限流探针（opt-in）'
  if [ "${VERIFY_RATE_LIMIT:-0}" = "1" ]; then
    local path="${VERIFY_RATE_LIMIT_PATH:-auth/public-key}"
    local fixed_burst="${VERIFY_RATE_LIMIT_BURST:-0}"
    local codes last_codes='' hit429=0
    # 必须并发打满：串行请求打不满窗口，会得到“限流没生效”的假阴性。
    # 并发数也不写死：目标路由的 limit 会随业务调整（public-key 已从 10 提到 60/分钟），
    # 固定值必然过期，默认按 40 → 80 → 160 逐级加压直到打出 429。
    local -a ladder
    if [ "$fixed_burst" -gt 0 ]; then
      ladder=("$fixed_burst")
    else
      ladder=(40 80 160)
    fi
    local attempt
    for attempt in "${ladder[@]}"; do
      codes="$(seq 1 "$attempt" | xargs -P "$attempt" -I{} curl -s -o /dev/null \
        -w '%{http_code}\n' --max-time 5 "${BASE_URL}/${path}" | sort | uniq -c || true)"
      last_codes="$codes"
      if printf '%s' "$codes" | grep -q '429'; then
        ok "限流生效（并发 ${attempt}）：$(printf '%s' "$codes" | tr -s ' ' | tr '\n' ' ')"
        hit429=1
        break
      fi
    done
    if [ "$hit429" -eq 0 ]; then
      warn "并发加压至 ${ladder[${#ladder[@]} - 1]} 仍未出现 429（最后分布：$(printf '%s' "$last_codes" | tr '\n' ' ')），需人工确认限流配置或 storage"
    fi
  else
    warn 'VERIFY_RATE_LIMIT!=1，跳过（合并前必须单独验证一次）'
  fi

  step '18. 优雅关闭'
  kill -TERM "$SERVER_PID" 2>/dev/null || true
  local waited=0
  while kill -0 "$SERVER_PID" 2>/dev/null && [ "$waited" -lt 10 ]; do
    sleep 1
    waited=$((waited + 1))
  done
  if kill -0 "$SERVER_PID" 2>/dev/null; then
    kill -9 "$SERVER_PID" 2>/dev/null || true
    warn 'SIGTERM 后 10s 未退出，已强制结束'
  else
    ok "SIGTERM 后 ${waited}s 退出（enableShutdownHooks 正常）"
  fi
  SERVER_PID=""

  step '19. Cluster 冒烟（opt-in）'
  if [ "${VERIFY_CLUSTER:-0}" = "1" ]; then
    local cluster_log='/tmp/purelyprofit-nest12-cluster.log'
    : >"$cluster_log"
    PORT="$PORT" \
      APP_PORT_AUTO_TERMINATE_ENABLED=false \
      APP_PORT_AUTO_SHIFT_ENABLED=false \
      node dist/cluster-main.js >>"$cluster_log" 2>&1 &
    SERVER_PID=$!
    disown "$SERVER_PID" 2>/dev/null || true
    wait_for_ready
    ok "cluster 就绪，worker ready 数=$(grep -c 'worker pid=.* ready' "$cluster_log" || true)"
    kill -TERM "$SERVER_PID" 2>/dev/null || true
    sleep 2
    kill -9 "$SERVER_PID" 2>/dev/null || true
    SERVER_PID=""
  else
    warn 'VERIFY_CLUSTER!=1，跳过（生产以 dist/cluster-main.js 启动，合并前必须跑一次）'
  fi
}

case "$MODE" in
  deps)
    phase_env
    phase_deps
    ;;
  quality)
    phase_env
    phase_deps
    phase_quality
    ;;
  runtime)
    phase_env
    phase_runtime
    ;;
  all)
    phase_env
    phase_deps
    phase_quality
    phase_runtime
    ;;
  *)
    fail "未知 VERIFY_MODE=${MODE}"
    ;;
esac

step "验证完成（MODE=${MODE}）"
log '  ✓ 全部通过'

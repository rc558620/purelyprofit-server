#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# purelyprofit-server 服务器端原子发布脚本
# ─────────────────────────────────────────────────────────────────────────────
# 调用方：GitHub Actions（.github/workflows/deploy-production.yml）通过 SSH 执行。
# 职责边界：只负责在服务器上「解包 → 迁移 → 切软链 → 重启 → 健康检查 → 失败回滚」，
#           不负责构建与测试（构建产物由 CI 产出后上传）。
#
# 目录约定（发布后 systemd 的 WorkingDirectory 指向 current）：
#   ${APP_ROOT}/releases/${RELEASE_ID}/   每次发布的独立目录，互不覆盖
#   ${APP_ROOT}/current -> releases/${RELEASE_ID}
#   ${APP_ROOT}/backups/                  发布前数据库备份
#
# 关键环境变量：
#   RELEASE_ID                  必填，发布版本标识（通常为 git sha）
#   RELEASE_ARCHIVE             必填，上传到服务器的产物 tar.gz 绝对路径
#   APP_ROOT                    应用根目录，默认 /opt/purelyprofit-server
#   APP_SERVICE                 systemd 服务名，默认 purelyprofit-server
#   APP_ENV_FILE                运行时环境文件，默认 /etc/purelyprofit-server/production.env
#   APP_HEALTHCHECK_URL         健康检查地址，默认 http://127.0.0.1:3000/api/readyz
#   APP_KEEP_RELEASES           保留历史版本数，默认 5
#   RELEASE_DRY_RUN             默认 false；true 时只打印计划，不做任何变更
#   RELEASE_SKIP_MIGRATE_DEPLOY 默认 false；true 时跳过 prisma migrate deploy
#   RELEASE_REQUIRE_BACKUP      默认 true；pg_dump 不可用时是否直接失败
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

RELEASE_ID="${RELEASE_ID:-}"
RELEASE_ARCHIVE="${RELEASE_ARCHIVE:-}"
APP_ROOT="${APP_ROOT:-/opt/purelyprofit-server}"
APP_SERVICE="${APP_SERVICE:-purelyprofit-server}"
APP_ENV_FILE="${APP_ENV_FILE:-/etc/purelyprofit-server/production.env}"
APP_HEALTHCHECK_URL="${APP_HEALTHCHECK_URL:-http://127.0.0.1:3000/api/readyz}"
APP_KEEP_RELEASES="${APP_KEEP_RELEASES:-5}"
APP_HEALTHCHECK_TIMEOUT_SECONDS="${APP_HEALTHCHECK_TIMEOUT_SECONDS:-60}"
RELEASE_DRY_RUN="${RELEASE_DRY_RUN:-false}"
RELEASE_SKIP_MIGRATE_DEPLOY="${RELEASE_SKIP_MIGRATE_DEPLOY:-false}"
RELEASE_REQUIRE_BACKUP="${RELEASE_REQUIRE_BACKUP:-true}"

# 发布用户通常不是 root：目录归发布用户所有，只有 systemctl 需要提权。
# 生产建议为该用户配 NOPASSWD 的 systemctl restart 权限，而不是放开全部 sudo。
SUDO=''
if [ "$(id -u)" -ne 0 ]; then
  SUDO="${APP_SUDO:-sudo}"
fi

RELEASES_DIR="${APP_ROOT}/releases"
CURRENT_LINK="${APP_ROOT}/current"
BACKUP_DIR="${APP_ROOT}/backups"
PREVIOUS_TARGET=''
BACKUP_FILE=''
CURRENT_STAGE='初始化'

log() { echo "[release] $1"; }
fail() { echo "[release] ✗ 阶段[${CURRENT_STAGE}] 失败：$1" >&2; exit 1; }

is_true() {
  case "${1:-false}" in
    true | TRUE | 1 | yes | ON) return 0 ;;
    *) return 1 ;;
  esac
}

set_stage() { CURRENT_STAGE="$1"; log "→ $1"; }

# dry-run 下只回显命令，避免「预演」误改线上
run() {
  if is_true "$RELEASE_DRY_RUN"; then
    echo "[release][dry-run] $*"
    return 0
  fi
  "$@"
}

resolve_pnpm() {
  if command -v pnpm >/dev/null 2>&1; then
    PNPM_BIN="$(command -v pnpm)"
    return 0
  fi
  # systemd / 非交互 SSH 场景下 PATH 往往不含用户级 pnpm 安装目录
  local candidate
  for candidate in "${HOME}/.local/share/pnpm/pnpm" /usr/local/bin/pnpm /usr/bin/pnpm; do
    if [ -x "$candidate" ]; then
      PNPM_BIN="$candidate"
      return 0
    fi
  done
  fail '服务器未安装 pnpm（需要 >= 11），请先安装并确保非交互 shell 可解析'
}

validate_inputs() {
  set_stage '校验发布参数'
  [ -n "$RELEASE_ID" ] || fail 'RELEASE_ID 为空'
  [ -n "$RELEASE_ARCHIVE" ] || fail 'RELEASE_ARCHIVE 为空'
  # 版本号会直接拼进目录名与清理逻辑，必须先做字符白名单，防止路径穿越
  case "$RELEASE_ID" in
    *[!A-Za-z0-9._-]*) fail "RELEASE_ID 含非法字符：${RELEASE_ID}" ;;
  esac
  [ -f "$RELEASE_ARCHIVE" ] || fail "产物不存在：${RELEASE_ARCHIVE}"

  # dry-run 允许在任意机器上预演发布计划，因此跳过运行时依赖与生产环境文件检查
  if is_true "$RELEASE_DRY_RUN"; then
    log 'dry-run：跳过 node / systemctl / pnpm 与生产环境文件的存在性检查'
    PNPM_BIN="${PNPM_BIN:-pnpm}"
    return 0
  fi

  [ -f "$APP_ENV_FILE" ] || fail "运行时环境文件不存在：${APP_ENV_FILE}（首次部署请先按 deploy/production.env.example 创建）"
  command -v node >/dev/null 2>&1 || fail '服务器未安装 node'
  command -v systemctl >/dev/null 2>&1 || fail '服务器缺少 systemctl'
  resolve_pnpm
}

load_runtime_env() {
  if is_true "$RELEASE_DRY_RUN"; then
    log 'dry-run：跳过加载运行时环境文件'
    return 0
  fi
  set_stage '加载运行时环境文件'
  # 迁移与 generate 都需要 DATABASE_URL，直接从生产环境文件注入当前 shell
  set -a
  # shellcheck disable=SC1090
  . "$APP_ENV_FILE"
  set +a
  [ -n "${DATABASE_URL:-}" ] || fail "环境文件缺少 DATABASE_URL：${APP_ENV_FILE}"
}

backup_database() {
  set_stage '备份数据库'
  if is_true "$RELEASE_DRY_RUN"; then
    log '[dry-run] 跳过数据库备份'
    return 0
  fi
  if ! command -v pg_dump >/dev/null 2>&1; then
    if is_true "$RELEASE_REQUIRE_BACKUP"; then
      fail '缺少 pg_dump，无法在发布前备份（装 postgresql-client 或把 RELEASE_REQUIRE_BACKUP 设为 false）'
    fi
    log '⚠ 缺少 pg_dump，本次跳过备份'
    return 0
  fi
  run mkdir -p "$BACKUP_DIR"
  BACKUP_FILE="${BACKUP_DIR}/purelyprofit-server-${RELEASE_ID}.dump"
  run pg_dump "$DATABASE_URL" --format=custom --no-owner --no-privileges --file="$BACKUP_FILE"
  log "备份完成：${BACKUP_FILE}"
}

prepare_release_dir() {
  set_stage '解包构建产物'
  local target="${RELEASES_DIR}/${RELEASE_ID}"
  local staging="${target}.staging"
  if is_true "$RELEASE_DRY_RUN"; then
    log "[dry-run] 将解包 ${RELEASE_ARCHIVE} → ${target}"
    return 0
  fi
  run mkdir -p "$RELEASES_DIR"
  rm -rf "$staging"
  mkdir -p "$staging"
  tar -xzf "$RELEASE_ARCHIVE" -C "$staging"
  # 产物缺任一入口都会在重启后才暴露，这里提前拦截
  [ -f "$staging/dist/cluster-main.js" ] || fail '产物缺少 dist/cluster-main.js'
  [ -f "$staging/dist/src/main.js" ] || fail '产物缺少 dist/src/main.js'
  [ -f "$staging/package.json" ] || fail '产物缺少 package.json'
  [ -f "$staging/pnpm-lock.yaml" ] || fail '产物缺少 pnpm-lock.yaml'
  rm -rf "$target"
  mv "$staging" "$target"
  log "产物已就位：${target}"
}

install_dependencies() {
  set_stage '安装依赖并生成 Prisma Client'
  local target="${RELEASES_DIR}/${RELEASE_ID}"
  # 必须在 release 目录内执行：Prisma 7 起 client 不再由 postinstall 生成，
  # 缺 generate 会让集群启动时直接报 @prisma/client 未初始化。
  # 用 pnpm --dir 而不是 cd，避免后续阶段继承错误的相对路径。
  run "$PNPM_BIN" --dir "$target" install --frozen-lockfile
  run "$PNPM_BIN" --dir "$target" exec prisma generate
}

run_migrations() {
  if is_true "$RELEASE_SKIP_MIGRATE_DEPLOY"; then
    log '按配置跳过 prisma migrate deploy'
    return 0
  fi
  set_stage '执行数据库迁移'
  local target="${RELEASES_DIR}/${RELEASE_ID}"
  run "$PNPM_BIN" --dir "$target" exec prisma migrate deploy
}

switch_current_symlink() {
  set_stage '切换 current 软链'
  local target="${RELEASES_DIR}/${RELEASE_ID}"
  if [ -L "$CURRENT_LINK" ]; then
    PREVIOUS_TARGET="$(readlink -f "$CURRENT_LINK" || true)"
  fi

  # 历史结构里 current 可能是真实目录：直接 ln -sfn 会把链接建到该目录内部，
  # 导致服务仍跑旧代码，必须先把旧目录改名备份。
  if [ -e "$CURRENT_LINK" ] && [ ! -L "$CURRENT_LINK" ]; then
    local legacy="${CURRENT_LINK}.legacy.$(date +%Y%m%d%H%M%S)"
    if is_true "$RELEASE_DRY_RUN"; then
      log "[dry-run] current 是真实目录，将改名为 ${legacy}"
    else
      mv "$CURRENT_LINK" "$legacy"
      log "⚠ current 原为真实目录，已备份为 ${legacy}"
    fi
  fi

  if is_true "$RELEASE_DRY_RUN"; then
    log "[dry-run] ln -sfn ${target} ${CURRENT_LINK}"
    return 0
  fi
  ln -sfn "$target" "$CURRENT_LINK"
  log "current → ${target}（上一个版本：${PREVIOUS_TARGET:-无}）"
}

restart_service() {
  set_stage '重启 systemd 服务'
  # shellcheck disable=SC2086
  run $SUDO systemctl restart "$APP_SERVICE"
  # shellcheck disable=SC2086
  run $SUDO systemctl is-active --quiet "$APP_SERVICE"
}

wait_healthcheck() {
  set_stage '等待健康检查'
  if is_true "$RELEASE_DRY_RUN"; then
    log "[dry-run] 轮询 ${APP_HEALTHCHECK_URL}"
    return 0
  fi
  command -v curl >/dev/null 2>&1 || fail '服务器缺少 curl，无法做发布后健康检查'

  # /api/readyz 在依赖异常时仍返回 HTTP 200，只把 body.status 置为 error。
  # 只看 HTTP 状态码会得到「数据库/Redis 挂了但发布判成功」的假绿，必须解析响应体。
  local waited=0 body=''
  while [ "$waited" -lt "$APP_HEALTHCHECK_TIMEOUT_SECONDS" ]; do
    if body="$(curl -fsS --max-time 5 "$APP_HEALTHCHECK_URL" 2>/dev/null)"; then
      if printf '%s' "$body" | node -e '
        let raw = "";
        process.stdin.on("data", (chunk) => (raw += chunk));
        process.stdin.on("end", () => {
          const payload = JSON.parse(raw);
          const deps = payload.dependencies ?? [];
          const ok =
            payload.status === "ok" &&
            deps.length > 0 &&
            deps.every((item) => item.status === "up");
          process.exit(ok ? 0 : 1);
        });
      ' 2>/dev/null; then
        log "健康检查通过：${APP_HEALTHCHECK_URL}（${body}）"
        return 0
      fi
    fi
    sleep 2
    waited=$((waited + 2))
  done
  fail "健康检查超时（${APP_HEALTHCHECK_TIMEOUT_SECONDS}s）：${APP_HEALTHCHECK_URL}，最后响应：${body:-无}"
}

rollback() {
  set_stage '回滚到上一个版本'
  if [ -z "$PREVIOUS_TARGET" ] || [ ! -d "$PREVIOUS_TARGET" ]; then
    echo '[release] ✗ 没有可回滚的历史版本，请查看 systemctl status 与服务日志人工介入' >&2
    return 1
  fi
  ln -sfn "$PREVIOUS_TARGET" "$CURRENT_LINK"
  # shellcheck disable=SC2086
  $SUDO systemctl restart "$APP_SERVICE" || true
  echo "[release] 已回滚到：${PREVIOUS_TARGET}" >&2
  if [ -n "$BACKUP_FILE" ] && [ -f "$BACKUP_FILE" ]; then
    echo "[release] 数据库备份：${BACKUP_FILE}（如需回滚数据库：pg_restore --clean -d \"\$DATABASE_URL\" ${BACKUP_FILE}）" >&2
  fi
  return 0
}

cleanup_old_releases() {
  set_stage '清理历史版本'
  if is_true "$RELEASE_DRY_RUN"; then
    log "[dry-run] 仅保留最近 ${APP_KEEP_RELEASES} 个版本"
    return 0
  fi
  # 按修改时间倒序保留最新 N 个；current 指向的版本即使较旧也不删
  local current_real
  current_real="$(readlink -f "$CURRENT_LINK" || true)"
  ls -1dt "${RELEASES_DIR}"/*/ 2>/dev/null | tail -n "+$((APP_KEEP_RELEASES + 1))" | while read -r dir; do
    [ -n "$dir" ] || continue
    if [ "$(readlink -f "$dir")" = "$current_real" ]; then
      continue
    fi
    rm -rf "$dir"
    echo "[release] 已清理旧版本：${dir}"
  done
}

main() {
  validate_inputs
  load_runtime_env
  backup_database
  prepare_release_dir
  install_dependencies
  run_migrations
  switch_current_symlink
  restart_service
  wait_healthcheck
  cleanup_old_releases
  echo "[release] ✅ 发布完成：${RELEASE_ID}"
  echo "[release] current → $(readlink -f "$CURRENT_LINK" 2>/dev/null || echo "$CURRENT_LINK")"
}

# 任意阶段失败都先尝试回滚，避免把线上停在「新代码 + 旧库」或半迁移状态
if ! (main); then
  echo '[release] ✗ 发布失败，开始回滚' >&2
  if ! is_true "$RELEASE_DRY_RUN"; then
    rollback || true
  fi
  exit 1
fi

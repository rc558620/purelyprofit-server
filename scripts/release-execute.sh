#!/bin/bash
set -euo pipefail

PROJECT_ROOT="/Users/f0rest/Documents/project/react/purelyprofit-server"
cd "$PROJECT_ROOT"

RELEASE_LOAD_ENV_FILE="${RELEASE_LOAD_ENV_FILE:-true}"
RELEASE_DRY_RUN="${RELEASE_DRY_RUN:-false}"
RELEASE_FORCE="${RELEASE_FORCE:-false}"
RELEASE_VALIDATE_ENV="${RELEASE_VALIDATE_ENV:-true}"
RELEASE_REQUIRE_BACKUP="${RELEASE_REQUIRE_BACKUP:-false}"
RELEASE_REQUIRE_RESTART="${RELEASE_REQUIRE_RESTART:-false}"
RELEASE_SKIP_BACKUP="${RELEASE_SKIP_BACKUP:-false}"
RELEASE_SKIP_DB_PRECHECK="${RELEASE_SKIP_DB_PRECHECK:-false}"
RELEASE_SKIP_BUILD="${RELEASE_SKIP_BUILD:-false}"
RELEASE_SKIP_MIGRATE_DEPLOY="${RELEASE_SKIP_MIGRATE_DEPLOY:-false}"
RELEASE_SKIP_SMOKE="${RELEASE_SKIP_SMOKE:-false}"
RELEASE_USE_DEFAULT_BACKUP="${RELEASE_USE_DEFAULT_BACKUP:-true}"
RELEASE_BACKUP_CMD="${RELEASE_BACKUP_CMD:-}"
RELEASE_BACKUP_DIR="${RELEASE_BACKUP_DIR:-$PROJECT_ROOT/backups}"
RELEASE_BACKUP_FILE_PREFIX="${RELEASE_BACKUP_FILE_PREFIX:-purelyprofit-server}"
RELEASE_BACKUP_RETENTION_DAYS="${RELEASE_BACKUP_RETENTION_DAYS:-14}"
RELEASE_SMOKE_PREPARE_CMD="${RELEASE_SMOKE_PREPARE_CMD:-${SMOKE_PREPARE_CMD:-pnpm run smoke:prepare}}"
RELEASE_RESTART_CMD="${RELEASE_RESTART_CMD:-}"
RELEASE_SYSTEMD_SERVICE_NAME="${RELEASE_SYSTEMD_SERVICE_NAME:-}"
RELEASE_PM2_APP_NAME="${RELEASE_PM2_APP_NAME:-}"
RELEASE_LAUNCHD_SERVICE_NAME="${RELEASE_LAUNCHD_SERVICE_NAME:-}"

LOADED_ENV_FILE="false"
DEFAULT_BACKUP_MODE="none"
DEFAULT_RESTART_MODE="none"
BACKUP_FILE_PATH=""

is_true() {
  case "${1:-false}" in
    true|TRUE|1|yes|YES|on|ON) return 0 ;;
    *) return 1 ;;
  esac
}

fail() {
  echo "✗ $1" >&2
  exit 1
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

quote_shell_arg() {
  printf '%q' "$1"
}

run_command() {
  local label="$1"
  shift

  echo
  echo "==> ${label}"
  if is_true "$RELEASE_DRY_RUN"; then
    printf 'DRY-RUN: '
    printf '%q ' "$@"
    printf '\n'
    return 0
  fi

  "$@"
}

run_shell_command() {
  local label="$1"
  local command="$2"

  echo
  echo "==> ${label}"
  if is_true "$RELEASE_DRY_RUN"; then
    echo "DRY-RUN: ${command}"
    return 0
  fi

  bash -lc "$command"
}

load_env_file_if_present() {
  if ! is_true "$RELEASE_LOAD_ENV_FILE"; then
    return 0
  fi

  if [ ! -f "$PROJECT_ROOT/.env" ]; then
    return 0
  fi

  set -a
  # shellcheck disable=SC1091
  . "$PROJECT_ROOT/.env"
  set +a
  LOADED_ENV_FILE="true"
}

is_placeholder_value() {
  case "${1:-}" in
    ""|secret|your_jwt_secret_key_here|wx_your_miniprogram_appid|your_miniprogram_appsecret|your_mch_api_certificate_serial_no)
      return 0
      ;;
    https://api.yourdomain.com/*|postgresql://USER:PASSWORD@*|*yourdomain.com*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

validate_release_environment() {
  local -a errors=()
  local node_env="${NODE_ENV:-development}"

  if ! is_true "$RELEASE_VALIDATE_ENV"; then
    return 0
  fi

  if [ "$node_env" != "production" ]; then
    return 0
  fi

  if is_placeholder_value "${DATABASE_URL:-}"; then
    errors+=("DATABASE_URL 未配置或仍在使用示例值")
  fi

  if ! is_true "$RELEASE_SKIP_DB_PRECHECK" && is_placeholder_value "${SHADOW_DATABASE_URL:-}"; then
    errors+=("SHADOW_DATABASE_URL 未配置或仍在使用示例值；release:precheck:db 需要影子库")
  fi

  if [ -z "${REDIS_HOST:-}" ]; then
    errors+=("REDIS_HOST 未配置")
  fi

  if [ "${APP_CORS_ORIGIN:-}" = "*" ] || is_placeholder_value "${APP_CORS_ORIGIN:-}"; then
    errors+=("APP_CORS_ORIGIN 生产环境必须配置为正式域名白名单")
  fi

  if [ "${APP_SWAGGER_ENABLED:-false}" = "true" ]; then
    errors+=("APP_SWAGGER_ENABLED 生产环境必须为 false")
  fi

  if [ "${APP_PORT_AUTO_TERMINATE_ENABLED:-false}" = "true" ]; then
    errors+=("APP_PORT_AUTO_TERMINATE_ENABLED 生产环境必须为 false")
  fi

  if [ "${APP_PORT_AUTO_SHIFT_ENABLED:-false}" = "true" ]; then
    errors+=("APP_PORT_AUTO_SHIFT_ENABLED 生产环境必须为 false")
  fi

  if is_placeholder_value "${JWT_SECRET:-}"; then
    errors+=("JWT_SECRET 未配置或仍在使用示例值")
  fi

  if [ "${CLUB_MANUAL_CONFIRM_PAID_ENABLED:-false}" = "true" ]; then
    errors+=("CLUB_MANUAL_CONFIRM_PAID_ENABLED 生产环境必须为 false")
  fi

  if is_placeholder_value "${WECHAT_APP_ID:-}"; then
    errors+=("WECHAT_APP_ID 未配置或仍在使用示例值")
  fi

  if is_placeholder_value "${WECHAT_APP_SECRET:-}"; then
    errors+=("WECHAT_APP_SECRET 未配置或仍在使用示例值")
  fi

  if is_placeholder_value "${WECHAT_MCH_SERIAL_NO:-}"; then
    errors+=("WECHAT_MCH_SERIAL_NO 未配置或仍在使用示例值")
  fi

  if [ -z "${WECHAT_PRIVATE_KEY_PATH:-}" ] && [ -z "${WECHAT_PRIVATE_KEY_CONTENT:-}" ]; then
    errors+=("WECHAT_PRIVATE_KEY_PATH / WECHAT_PRIVATE_KEY_CONTENT 至少要配置一个")
  fi

  if [ -n "${WECHAT_PRIVATE_KEY_PATH:-}" ] && [ ! -f "${WECHAT_PRIVATE_KEY_PATH}" ]; then
    errors+=("WECHAT_PRIVATE_KEY_PATH 指向的文件不存在: ${WECHAT_PRIVATE_KEY_PATH}")
  fi

  if is_placeholder_value "${WECHAT_PAY_NOTIFY_URL:-}" || [[ "${WECHAT_PAY_NOTIFY_URL:-}" != https://* ]]; then
    errors+=("WECHAT_PAY_NOTIFY_URL 必须配置为可访问的 HTTPS 正式地址")
  fi

  if [ -z "${WECHAT_PLATFORM_PUBLIC_KEY_CONTENT:-}" ]; then
    errors+=("WECHAT_PLATFORM_PUBLIC_KEY_CONTENT 未配置，生产环境必须启用微信支付回调 RSA 验签")
  fi

  if [ ${#errors[@]} -gt 0 ]; then
    fail "发布环境变量校验失败:\n- ${errors[*]}"
  fi
}

prepare_backup_file_path() {
  local timestamp
  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  BACKUP_FILE_PATH="${RELEASE_BACKUP_DIR}/${RELEASE_BACKUP_FILE_PREFIX}-${timestamp}.dump"
}

resolve_default_backup_mode() {
  DEFAULT_BACKUP_MODE="none"

  if [ -n "$RELEASE_BACKUP_CMD" ]; then
    return 0
  fi

  if is_true "$RELEASE_USE_DEFAULT_BACKUP" && [ -n "${DATABASE_URL:-}" ]; then
    DEFAULT_BACKUP_MODE="pg_dump"
  fi
}

build_pg_dump_command() {
  local backup_dir_quoted
  local backup_file_quoted
  local database_url_quoted
  local find_pattern_quoted
  local command

  backup_dir_quoted="$(quote_shell_arg "$RELEASE_BACKUP_DIR")"
  backup_file_quoted="$(quote_shell_arg "$BACKUP_FILE_PATH")"
  database_url_quoted="$(quote_shell_arg "${DATABASE_URL:-}")"
  find_pattern_quoted="$(quote_shell_arg "${RELEASE_BACKUP_FILE_PREFIX}-*.dump")"

  command="mkdir -p ${backup_dir_quoted} && pg_dump --format=custom --no-owner --no-privileges --file=${backup_file_quoted} ${database_url_quoted}"

  if [ "${RELEASE_BACKUP_RETENTION_DAYS:-0}" -gt 0 ] 2>/dev/null; then
    command+=" && find ${backup_dir_quoted} -type f -name ${find_pattern_quoted} -mtime +${RELEASE_BACKUP_RETENTION_DAYS} -delete"
  fi

  printf '%s' "$command"
}

run_default_backup() {
  prepare_backup_file_path

  if ! is_true "$RELEASE_DRY_RUN" && ! command_exists pg_dump; then
    fail "未找到 pg_dump，无法执行默认备份；请安装 PostgreSQL 客户端或显式提供 RELEASE_BACKUP_CMD。"
  fi

  run_shell_command "执行发布前默认备份(pg_dump)" "$(build_pg_dump_command)"

  if ! is_true "$RELEASE_DRY_RUN"; then
    echo "- 备份产物: ${BACKUP_FILE_PATH}"
  fi
}

resolve_default_restart_mode() {
  DEFAULT_RESTART_MODE="none"

  if [ -n "$RELEASE_RESTART_CMD" ]; then
    return 0
  fi

  if [ -n "$RELEASE_PM2_APP_NAME" ]; then
    DEFAULT_RESTART_MODE="pm2"
    return 0
  fi

  if [ -n "$RELEASE_SYSTEMD_SERVICE_NAME" ]; then
    DEFAULT_RESTART_MODE="systemd"
    return 0
  fi

  if [ -n "$RELEASE_LAUNCHD_SERVICE_NAME" ]; then
    DEFAULT_RESTART_MODE="launchd"
  fi
}

build_default_restart_command() {
  case "$DEFAULT_RESTART_MODE" in
    pm2)
      printf 'pm2 restart %q && pm2 describe %q >/dev/null' \
        "$RELEASE_PM2_APP_NAME" "$RELEASE_PM2_APP_NAME"
      ;;
    systemd)
      printf 'systemctl restart %q && systemctl is-active --quiet %q' \
        "$RELEASE_SYSTEMD_SERVICE_NAME" "$RELEASE_SYSTEMD_SERVICE_NAME"
      ;;
    launchd)
      printf 'launchctl kickstart -k gui/%q/%q || launchctl kickstart -k system/%q' \
        "$(id -u)" "$RELEASE_LAUNCHD_SERVICE_NAME" "$RELEASE_LAUNCHD_SERVICE_NAME"
      ;;
    *)
      printf ''
      ;;
  esac
}

run_default_restart() {
  local command
  command="$(build_default_restart_command)"

  if [ -z "$command" ]; then
    fail "未能解析默认重启命令。"
  fi

  case "$DEFAULT_RESTART_MODE" in
    pm2)
      if ! is_true "$RELEASE_DRY_RUN" && ! command_exists pm2; then
        fail "未找到 pm2，无法执行默认重启；请安装 pm2 或显式提供 RELEASE_RESTART_CMD。"
      fi
      run_shell_command "执行默认服务重启(pm2)" "$command"
      ;;
    systemd)
      if ! is_true "$RELEASE_DRY_RUN" && ! command_exists systemctl; then
        fail "未找到 systemctl，无法执行默认重启；请在 systemd 环境下执行或显式提供 RELEASE_RESTART_CMD。"
      fi
      run_shell_command "执行默认服务重启(systemd)" "$command"
      ;;
    launchd)
      if ! is_true "$RELEASE_DRY_RUN" && ! command_exists launchctl; then
        fail "未找到 launchctl，无法执行默认重启；请显式提供 RELEASE_RESTART_CMD。"
      fi
      run_shell_command "执行默认服务重启(launchd)" "$command"
      ;;
  esac
}

apply_smoke_metadata() {
  local metadata="$1"
  local key
  local value

  while IFS='=' read -r key value; do
    case "$key" in
      SMOKE_ACCOUNT_SCOPE|SMOKE_LOGIN_PHONE|SMOKE_LOGIN_NAME|SMOKE_LOGIN_EMAIL|SMOKE_STORE_ID|SMOKE_STORE_NAME|SMOKE_PROFIT_REPORT_PATH)
        if [ -n "$value" ]; then
          export "$key=$value"
        fi
        ;;
    esac
  done <<EOF
$metadata
EOF

  if [ -n "${SMOKE_STORE_ID:-}" ] && [ -z "${SMOKE_PROFIT_REPORT_PATH:-}" ]; then
    export SMOKE_PROFIT_REPORT_PATH="/profit-detail/report?storeId=${SMOKE_STORE_ID}&period=month"
  fi
}

run_smoke_prepare_command() {
  local metadata

  echo
  echo "==> 准备 smoke 数据"
  if is_true "$RELEASE_DRY_RUN"; then
    echo "DRY-RUN: ${RELEASE_SMOKE_PREPARE_CMD}"
    return 0
  fi

  metadata=$(bash -lc "$RELEASE_SMOKE_PREPARE_CMD") || fail "准备 smoke 数据失败"
  printf '%s\n' "$metadata"
  apply_smoke_metadata "$metadata"

  if [ -n "${SMOKE_STORE_ID:-}" ]; then
    echo "- 已复用 smoke 门店: ${SMOKE_STORE_ID}"
  fi
  if [ -n "${SMOKE_LOGIN_PHONE:-}" ]; then
    echo "- 已复用 smoke 账号: ${SMOKE_LOGIN_PHONE}"
  fi
}

validate_release_inputs() {
  resolve_default_backup_mode
  resolve_default_restart_mode

  if is_true "$RELEASE_REQUIRE_BACKUP" && is_true "$RELEASE_SKIP_BACKUP"; then
    fail "RELEASE_REQUIRE_BACKUP=true 时不能再设置 RELEASE_SKIP_BACKUP=true。"
  fi

  if is_true "$RELEASE_REQUIRE_BACKUP" && [ -z "$RELEASE_BACKUP_CMD" ] && [ "$DEFAULT_BACKUP_MODE" = "none" ]; then
    fail "RELEASE_REQUIRE_BACKUP=true 时必须提供 RELEASE_BACKUP_CMD，或让默认备份策略可用。"
  fi

  if is_true "$RELEASE_REQUIRE_RESTART" && [ -z "$RELEASE_RESTART_CMD" ] && [ "$DEFAULT_RESTART_MODE" = "none" ]; then
    fail "RELEASE_REQUIRE_RESTART=true 时必须提供 RELEASE_RESTART_CMD，或配置默认重启策略。"
  fi
}

load_env_file_if_present

if ! is_true "$RELEASE_DRY_RUN" && ! is_true "$RELEASE_FORCE"; then
  fail "发布执行脚本默认受保护；请显式传入 RELEASE_FORCE=true，或先用 RELEASE_DRY_RUN=true 预演。"
fi

validate_release_environment
validate_release_inputs

resolve_default_backup_mode
resolve_default_restart_mode

echo "Release project root: $PROJECT_ROOT"
echo "Release dry run: $RELEASE_DRY_RUN"
echo "Loaded env file: $LOADED_ENV_FILE"
echo "Validate env: $RELEASE_VALIDATE_ENV"
echo "Require backup: $RELEASE_REQUIRE_BACKUP"
echo "Require restart: $RELEASE_REQUIRE_RESTART"
echo "Smoke base url: ${SMOKE_BASE_URL:-http://localhost:3000/api}"
if [ -n "$RELEASE_BACKUP_CMD" ]; then
  echo "Backup command: $RELEASE_BACKUP_CMD"
elif [ "$DEFAULT_BACKUP_MODE" = "pg_dump" ]; then
  echo "Backup command: <auto pg_dump -> ${RELEASE_BACKUP_DIR}>"
else
  echo "Backup command: <not provided>"
fi
if [ -n "$RELEASE_SMOKE_PREPARE_CMD" ]; then
  echo "Smoke prepare command: $RELEASE_SMOKE_PREPARE_CMD"
else
  echo "Smoke prepare command: <not provided>"
fi
if [ -n "$RELEASE_RESTART_CMD" ]; then
  echo "Restart command: $RELEASE_RESTART_CMD"
elif [ "$DEFAULT_RESTART_MODE" != "none" ]; then
  echo "Restart command: <auto ${DEFAULT_RESTART_MODE}>"
else
  echo "Restart command: <not provided>"
fi

if ! is_true "$RELEASE_SKIP_BACKUP"; then
  if [ -n "$RELEASE_BACKUP_CMD" ]; then
    run_shell_command "执行发布前备份命令" "$RELEASE_BACKUP_CMD"
  elif [ "$DEFAULT_BACKUP_MODE" = "pg_dump" ]; then
    run_default_backup
  else
    echo "- 未提供 RELEASE_BACKUP_CMD，且未命中默认备份策略，跳过发布前备份命令"
  fi
else
  echo "- 跳过发布前备份命令"
fi

if ! is_true "$RELEASE_SKIP_DB_PRECHECK"; then
  run_command "发布前预检查" pnpm run release:precheck
else
  echo "- 跳过发布前预检查"
fi

if ! is_true "$RELEASE_SKIP_BUILD"; then
  run_command "构建产物" pnpm run build
else
  echo "- 跳过构建产物"
fi

if ! is_true "$RELEASE_SKIP_MIGRATE_DEPLOY"; then
  run_command "执行 Prisma migrate deploy" pnpm run prisma:migrate:deploy
else
  echo "- 跳过 Prisma migrate deploy"
fi

if ! is_true "$RELEASE_SKIP_SMOKE"; then
  if [ -n "$RELEASE_SMOKE_PREPARE_CMD" ]; then
    run_smoke_prepare_command
  else
    echo "- 未提供 RELEASE_SMOKE_PREPARE_CMD，跳过 smoke 数据准备"
  fi
else
  echo "- 已跳过上线后 smoke 检查，连带跳过 smoke 数据准备"
fi

if [ -n "$RELEASE_RESTART_CMD" ]; then
  run_shell_command "执行服务重启命令" "$RELEASE_RESTART_CMD"
elif [ "$DEFAULT_RESTART_MODE" != "none" ]; then
  run_default_restart
else
  echo "- 未提供 RELEASE_RESTART_CMD，且未命中默认重启策略，默认认为服务会由外部发布平台完成重启"
fi

if ! is_true "$RELEASE_SKIP_SMOKE"; then
  run_command "执行上线后 smoke 检查" pnpm run smoke:live
else
  echo "- 跳过上线后 smoke 检查"
fi

echo
if is_true "$RELEASE_DRY_RUN"; then
  echo "Release dry-run 完成，未执行真实发布命令"
else
  echo "Release 执行完成"
fi

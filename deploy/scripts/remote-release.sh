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
#                                         同 ID 重发时自动追加时间戳后缀，保证新发布永远落在新目录
#   ${APP_ROOT}/current -> releases/${RELEASE_ID}
#   ${APP_ROOT}/backups/                  发布前数据库备份
#   ${APP_ROOT}/shared/print-agent/versions/<version>/  打印代理安装包（每个版本独立目录，见 publish_print_agent_assets）
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
#   RELEASE_REQUIRE_PRINT_AGENT_ASSETS  默认 true；
#                               服务器没有任何安装包（下载会 404）时是否中止发布
#   RELEASE_REQUIRE_PRINT_AGENT_VERSION 默认 true；
#                               安装包缺 VERSION 标记、或版本与 PRINT_AGENT_LATEST_VERSION 不一致时是否中止发布
#   PRINT_AGENT_LATEST_VERSION  由运行时环境文件注入；未配置时应用按安装包 VERSION 文件报告版本
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
RELEASE_REQUIRE_PRINT_AGENT_ASSETS="${RELEASE_REQUIRE_PRINT_AGENT_ASSETS:-true}"
RELEASE_REQUIRE_PRINT_AGENT_VERSION="${RELEASE_REQUIRE_PRINT_AGENT_VERSION:-true}"

# 发布用户通常不是 root：目录归发布用户所有，只有 systemctl 需要提权。
# 生产建议为该用户配 NOPASSWD 的 systemctl restart 权限，而不是放开全部 sudo。
SUDO=''
if [ "$(id -u)" -ne 0 ]; then
  SUDO="${APP_SUDO:-sudo}"
fi

RELEASES_DIR="${APP_ROOT}/releases"
CURRENT_LINK="${APP_ROOT}/current"
BACKUP_DIR="${APP_ROOT}/backups"
# 商家端下载的打印代理安装包：放在 releases 之外，避免清理历史版本时把安装包一起删掉。
# 服务端下载接口按 process.cwd()/public/print-agent 读文件（cwd 即 current），
# 因此每个 release 目录里的 public/print-agent 都软链到「具体版本目录」而非常量路径。
#
# 目录结构：
#   ${APP_ROOT}/shared/print-agent/versions/<version>/{print-agent-win64.exe,print-agent-macos-app.zip,VERSION}
#   ${APP_ROOT}/releases/<id>/public/print-agent -> ../.../versions/<version>
# 发布时先把新包完整写入 versions/<version>.incoming.*，校验通过才改名为正式版本目录，
# 新 release 再指向它。因此在用的旧版本目录自始至终不会被改写：
# 校验失败时线上提供的下载包内容与校验和保持不变。
SHARED_PRINT_AGENT_DIR="${APP_ROOT}/shared/print-agent"
PRINT_AGENT_VERSIONS_DIR="${SHARED_PRINT_AGENT_DIR}/versions"
PRINT_AGENT_FILES='print-agent-win64.exe print-agent-macos-app.zip'
PREVIOUS_TARGET=''
BACKUP_FILE=''
CURRENT_STAGE='初始化'
# current 是否已经切到本次新版本：只有切换之后才需要回滚软链，
# 之前的失败（校验/解包/依赖/迁移）线上仍是旧版本。
CURRENT_SWITCHED=false
# 安装包暂存目录（校验中途失败时要清掉，否则会留下半套产物）
PRINT_AGENT_STAGED=''
# 本次运行「实际创建」的目录。回滚只允许清理这里记录过的路径：
# 绝不能用 ${RELEASES_DIR}/${RELEASE_ID} 反推——参数校验阶段就失败时 RELEASE_ID 还是原始 SHA，
# 而那个目录正是线上正在用的版本，按名字删等于直接毁掉线上目录和它的下载文件。
CREATED_RELEASE_DIR=''
CREATED_STAGING_DIR=''
# current 原本是实体目录时被改名备份的位置：建软链失败后 current 会消失，必须搬回去
LEGACY_CURRENT_BACKUP=''

log() { echo "[release] $1"; }
fail() { echo "[release] ✗ 阶段[${CURRENT_STAGE}] 失败：$1" >&2; exit 1; }

is_true() {
  case "${1:-false}" in
    true | TRUE | 1 | yes | ON) return 0 ;;
    *) return 1 ;;
  esac
}

set_stage() { CURRENT_STAGE="$1"; log "→ $1"; }

# dry-run 下只回显命令，避免「预演」误改线上。
# 这里显式检查退出码：脚本一旦被放在 `if ! main` 之类的条件上下文里执行，
# set -e 会失效，install / migrate / restart 这类关键命令的失败会被静默吞掉，
# 最终打印「发布完成」。所有变更类命令必须走 run（或显式判断），不允许裸调用。
run() {
  if is_true "$RELEASE_DRY_RUN"; then
    echo "[release][dry-run] $*"
    return 0
  fi
  local status=0
  "$@" || status=$?
  if [ "$status" -ne 0 ]; then
    fail "命令执行失败（退出码 ${status}）：$*"
  fi
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

# 同一提交重发时 RELEASE_ID 相同（通常就是 git sha），而该目录可能正被 current 引用。
# 若沿用原目录并 rm -rf 重建，等于「先毁掉线上版本，再校验新产物」：
# 坏包被拒绝后 current 虽然没切，旧目录和它的下载文件却已经没了。
# 因此这里为目标目录选一个确定不存在的 ID：已存在就追加时间戳后缀。
resolve_release_id() {
  set_stage '确定发布目录'
  local base="$RELEASE_ID" candidate="$RELEASE_ID" index=0
  while [ -e "${RELEASES_DIR}/${candidate}" ] || [ -L "${RELEASES_DIR}/${candidate}" ]; do
    index=$((index + 1))
    candidate="${base}-$(date +%Y%m%d%H%M%S)-${index}"
  done
  if [ "$candidate" != "$base" ]; then
    log "发布目录 ${base} 已存在（可能仍被 current 引用），本次改用 ${candidate}"
    RELEASE_ID="$candidate"
  else
    log "本次发布目录：${RELEASES_DIR}/${RELEASE_ID}"
  fi
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
  # 兜底：resolve_release_id 已保证目录不存在，这里再拦一次，绝不复用旧目录
  if [ -e "$target" ] || [ -L "$target" ]; then
    fail "发布目录已存在：${target}（拒绝覆盖，避免毁掉可能正在使用的版本）"
  fi
  rm -rf "$staging"
  CREATED_STAGING_DIR="$staging"
  mkdir -p "$staging"
  tar -xzf "$RELEASE_ARCHIVE" -C "$staging"
  # 产物缺任一入口都会在重启后才暴露，这里提前拦截
  [ -f "$staging/dist/cluster-main.js" ] || fail '产物缺少 dist/cluster-main.js'
  [ -f "$staging/dist/src/main.js" ] || fail '产物缺少 dist/src/main.js'
  [ -f "$staging/package.json" ] || fail '产物缺少 package.json'
  [ -f "$staging/pnpm-lock.yaml" ] || fail '产物缺少 pnpm-lock.yaml'
  mv "$staging" "$target"
  # 只有到这里，目录才算「本次创建」；失败回滚只清理这两个记录值
  CREATED_RELEASE_DIR="$target"
  CREATED_STAGING_DIR=''
  log "产物已就位：${target}"
}

# 读取安装包版本标记（安装包目录内的 VERSION 文件，由构建产物提供）
read_print_agent_version() {
  local dir="$1"
  if [ ! -f "${dir}/VERSION" ]; then
    return 0
  fi
  tr -d '[:space:]' < "${dir}/VERSION"
}

file_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

# 安装包目录指纹：同版本号但内容不同时用于拒绝覆盖
print_agent_digest() {
  local dir="$1" file
  [ -d "$dir" ] || return 0
  for file in $PRINT_AGENT_FILES; do
    if [ -f "${dir}/${file}" ]; then
      printf '%s ' "$(file_sha256 "${dir}/${file}")"
    fi
  done
}

# 校验安装包目录并输出其中的版本号。
# 文件缺失、或缺少 VERSION 标记时直接失败：VERSION 必须随产物一起构建，
# 不允许 CI/人工事后补写，否则「内容没变的旧包标成新版」也会通过校验。
require_print_agent_dir() {
  local dir="$1" label="$2" name missing='' version
  for name in $PRINT_AGENT_FILES; do
    [ -s "${dir}/${name}" ] || missing="${missing:+$missing }${name}"
  done
  if [ -n "$missing" ]; then
    fail "${label}缺少安装包：${missing}（下载接口会返回 404）"
  fi
  version="$(read_print_agent_version "$dir")"
  if [ -z "$version" ]; then
    fail "${label}缺少 VERSION 版本标记，无法确认发布的是哪个版本（VERSION 必须由构建产物提供，禁止事后补写）"
  fi
  printf '%s' "$version"
}

# 复用已有版本目录前的完整性校验：两份安装包缺一不可，缺了下载接口只对其中一个平台 404。
# 与新产物不同，这里允许按 RELEASE_REQUIRE_PRINT_AGENT_ASSETS 降级为告警，
# 兼容「确实只用 Windows」这类历史部署。
assert_print_agent_files() {
  local dir="$1" label="$2" name missing=''
  for name in $PRINT_AGENT_FILES; do
    [ -s "${dir}/${name}" ] || missing="${missing:+$missing }${name}"
  done
  if [ -z "$missing" ]; then
    return 0
  fi
  if is_true "$RELEASE_REQUIRE_PRINT_AGENT_ASSETS"; then
    fail "${label}缺少安装包：${missing}（下载接口会返回 404；确认不需要下载能力时设 RELEASE_REQUIRE_PRINT_AGENT_ASSETS=false）"
  fi
  log "⚠ ${label}缺少安装包：${missing}，下载接口会返回 404（按配置不阻断发布）"
}

# 把上一版脚本的旧布局（安装包直接放在 shared/print-agent 下）复制成版本目录。
# 用复制而非移动：切换 current 之前旧 release 仍在读旧路径，必须保持原样。
adopt_legacy_print_agent_layout() {
  local version dest file missing=''
  [ -s "${SHARED_PRINT_AGENT_DIR}/print-agent-win64.exe" ] || return 0
  if [ -n "$(ls -1d "${PRINT_AGENT_VERSIONS_DIR}"/*/ 2>/dev/null | head -1 || true)" ]; then
    return 0
  fi
  # 旧布局不完整（例如只剩 Windows 包）时不导入：把半套产物固化成版本目录，
  # 会让后续复用校验永远失败。是否放行由下面的复用校验按配置判断。
  for file in $PRINT_AGENT_FILES; do
    [ -s "${SHARED_PRINT_AGENT_DIR}/${file}" ] || missing="${missing:+$missing }${file}"
  done
  if [ -n "$missing" ] || [ ! -s "${SHARED_PRINT_AGENT_DIR}/VERSION" ]; then
    log "⚠ 旧布局 ${SHARED_PRINT_AGENT_DIR} 不完整（缺 ${missing:-VERSION}），跳过导入"
    return 0
  fi
  version="$(read_print_agent_version "$SHARED_PRINT_AGENT_DIR")"
  version="${version:-legacy}"
  dest="${PRINT_AGENT_VERSIONS_DIR}/${version}"
  run mkdir -p "$dest"
  for file in $PRINT_AGENT_FILES; do
    run cp -a "${SHARED_PRINT_AGENT_DIR}/${file}" "$dest/"
  done
  if [ -f "${SHARED_PRINT_AGENT_DIR}/VERSION" ]; then
    run cp -a "${SHARED_PRINT_AGENT_DIR}/VERSION" "${dest}/VERSION"
  fi
  log "已把旧布局安装包复制为版本目录：${dest}"
}

# 产物未携带安装包时挑一个已发布的版本目录复用：
# 期望版本 → 当前 release 正在用的目录（按其 VERSION 找回版本目录）→ 最新的版本目录
pick_published_print_agent_dir() {
  local expected="$1" candidate='' version
  if [ -n "$expected" ] && [ -d "${PRINT_AGENT_VERSIONS_DIR}/${expected}" ]; then
    printf '%s' "${PRINT_AGENT_VERSIONS_DIR}/${expected}"
    return 0
  fi
  if [ -L "$CURRENT_LINK" ]; then
    candidate="$(readlink -f "${CURRENT_LINK}/public/print-agent" 2>/dev/null || true)"
  fi
  version="$(read_print_agent_version "${candidate:-/nonexistent}")"
  if [ -n "$version" ] && [ -d "${PRINT_AGENT_VERSIONS_DIR}/${version}" ]; then
    printf '%s' "${PRINT_AGENT_VERSIONS_DIR}/${version}"
    return 0
  fi
  candidate="$(ls -1dt "${PRINT_AGENT_VERSIONS_DIR}"/*/ 2>/dev/null | head -1 || true)"
  printf '%s' "${candidate%/}"
}

# 版本一致性校验：应用侧同样优先读 VERSION 文件，环境变量仅在没有标记时兜底，
# 因此一旦配置了 PRINT_AGENT_LATEST_VERSION 就必须与安装包版本完全一致。
assert_print_agent_version() {
  local version="$1" source="$2" expected="${PRINT_AGENT_LATEST_VERSION:-}"
  if [ -z "$version" ]; then
    if is_true "$RELEASE_REQUIRE_PRINT_AGENT_VERSION"; then
      fail "无法确认安装包版本（${source} 内缺少 VERSION 标记），无法保证下载到的是配置声明的版本"
    fi
    log "⚠ 无法确认安装包版本（${source} 缺少 VERSION），按配置不阻断发布"
    return 0
  fi
  if [ -z "$expected" ]; then
    log "未配置 PRINT_AGENT_LATEST_VERSION，应用将按 VERSION 文件报告最新版本：${version}"
    return 0
  fi
  if [ "$version" = "$expected" ]; then
    log "安装包版本校验通过：${version}"
    return 0
  fi
  if is_true "$RELEASE_REQUIRE_PRINT_AGENT_VERSION"; then
    fail "安装包版本 ${version}（${source}）与 PRINT_AGENT_LATEST_VERSION=${expected} 不一致：配置会提示 ${expected}，实际下载 ${version}；请更换安装包或同步修改环境变量"
  fi
  log "⚠ 安装包版本 ${version} 与 PRINT_AGENT_LATEST_VERSION=${expected} 不一致，按配置不阻断发布"
}

publish_print_agent_assets() {
  set_stage '挂载打印代理安装包'
  local target="${RELEASES_DIR}/${RELEASE_ID}"
  local incoming="${target}/public/print-agent"
  local expected="${PRINT_AGENT_LATEST_VERSION:-}"
  local version='' published='' staged='' dest=''

  if is_true "$RELEASE_DRY_RUN"; then
    log "[dry-run] 校验产物安装包 → 通过后写入 ${PRINT_AGENT_VERSIONS_DIR}/<version>，并让 ${target}/public/print-agent 指向该版本目录"
    return 0
  fi

  run mkdir -p "$PRINT_AGENT_VERSIONS_DIR"

  if [ -d "$incoming" ] && [ -n "$(ls -A "$incoming" 2>/dev/null || true)" ]; then
    # 产物带包：先写进本次专用临时目录，全部校验通过才改名为正式版本目录。
    # 正式版本目录一旦存在就不再改写，因此在用的下载文件校验和不会被发布动作影响。
    version="$(require_print_agent_dir "$incoming" '本次产物')"
    staged="${PRINT_AGENT_VERSIONS_DIR}/.${version}.incoming.$$"
    rm -rf "$staged"
    run mkdir -p "$staged"
    PRINT_AGENT_STAGED="$staged"
    run cp -a "${incoming}/." "$staged/"
    require_print_agent_dir "$staged" "版本目录 ${version} " >/dev/null
    # 版本一致性在「发布为正式版本目录」之前校验：不一致时不落盘任何东西
    assert_print_agent_version "$version" '本次产物'
    dest="${PRINT_AGENT_VERSIONS_DIR}/${version}"
    if [ -d "$dest" ]; then
      if [ "$(print_agent_digest "$staged")" != "$(print_agent_digest "$dest")" ]; then
        rm -rf "$staged"
        PRINT_AGENT_STAGED=''
        fail "版本目录 ${dest} 已存在且内容与本次产物不同：拒绝覆盖可能仍在提供下载的安装包，请提升代理版本号后重新发布"
      fi
      rm -rf "$staged"
      PRINT_AGENT_STAGED=''
      log "安装包版本 ${version} 已存在且校验和一致，复用 ${dest}"
    else
      run mv "$staged" "$dest"
      PRINT_AGENT_STAGED=''
      log "安装包已发布到版本目录：${dest}"
    fi
    published="$dest"
  else
    # 只有「本次产物没带安装包、确实要复用历史版本」时才导入旧布局。
    # 旧布局可能只剩 Windows 包，无条件导入会因缺 macOS 包直接失败，
    # 把「本次两份齐全」的新产物挡在发布之外。
    adopt_legacy_print_agent_layout
    published="$(pick_published_print_agent_dir "$expected")"
    if [ -z "$published" ]; then
      if is_true "$RELEASE_REQUIRE_PRINT_AGENT_ASSETS"; then
        fail "服务器上没有任何可用安装包（${PRINT_AGENT_VERSIONS_DIR} 为空），下载接口会返回 404；请把带 VERSION 的安装包打进产物或预置到该目录；确认不需要下载能力时设 RELEASE_REQUIRE_PRINT_AGENT_ASSETS=false"
      fi
      log "⚠ 服务器没有可用安装包，本次不提供下载（下载接口会返回 404）"
      run mkdir -p "$target/public"
      run rm -rf "$incoming"
      run mkdir -p "$incoming"
      return 0
    fi
    log "产物未携带安装包，复用已发布版本：${published}"
    # 复用不是免检：目录里只有 Windows 包时，macOS 那个下载入口会一直 404，
    # 因此两份文件与 VERSION 都要在挂链之前校验。
    assert_print_agent_files "$published" "复用目录 ${published} "
    version="$(read_print_agent_version "$published")"
    assert_print_agent_version "$version" "$published"
  fi

  run mkdir -p "$target/public"
  # 先删后链：删的是本 release 目录里自带的副本，不影响其它版本
  run rm -rf "$incoming"
  run ln -sfn "$published" "$incoming"
  log "本次发布的下载目录 → ${published}（版本 ${version:-未标记}）"
}

verify_print_agent_download() {
  set_stage '检查打印代理安装包'
  if is_true "$RELEASE_DRY_RUN"; then
    log '[dry-run] 跳过安装包校验'
    return 0
  fi
  local dir path name missing=''
  dir="$(readlink -f "$CURRENT_LINK" || echo "$CURRENT_LINK")/public/print-agent"
  # 这两份是下载接口真正会发的文件：缺失即 404，但回滚也救不回来（旧版本同样没有），
  # 所以这里只告警不失败，避免把可恢复的代码发布回滚掉。
  for name in $PRINT_AGENT_FILES; do
    path="${dir}/${name}"
    if [ -r "$path" ]; then
      log "下载资源正常：${name}（$(du -h "$path" | cut -f1)，sha256 $(file_sha256 "$path")）"
    else
      missing="${missing:+$missing }${name}"
    fi
  done
  if [ -n "$missing" ]; then
    log "⚠ 下载资源缺失或不可读：${missing}，下载接口会返回 404；请把安装包放入 ${PRINT_AGENT_VERSIONS_DIR}/<version>"
  else
    log "当前可供下载的安装包版本：$(read_print_agent_version "$dir")"
  fi
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
      # 移走旧目录后 current 就不存在了：必须先登记「需要恢复」，
      # 这样即使下面建软链失败，退出清理也会把实体目录搬回 current，而不是留下一个空洞。
      # PREVIOUS_TARGET 用于「已切到新版本后」的回滚，LEGACY_CURRENT_BACKUP 用于「还没切成就失败」的恢复。
      PREVIOUS_TARGET="$legacy"
      LEGACY_CURRENT_BACKUP="$legacy"
      log "⚠ current 原为真实目录，已备份为 ${legacy}"
    fi
  fi

  if is_true "$RELEASE_DRY_RUN"; then
    log "[dry-run] ln -sfn ${target} ${CURRENT_LINK}"
    return 0
  fi
  ln -sfn "$target" "$CURRENT_LINK"
  # 从这里开始才需要「回滚软链」，之前阶段的失败只回滚数据/进程状态
  CURRENT_SWITCHED=true
  # 新链接已建立，旧实体目录通过 PREVIOUS_TARGET 可达，不再需要「搬回 current」
  LEGACY_CURRENT_BACKUP=''
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

# current 原本是实体目录时，切换前会被改名备份。若随后建软链失败，current 直接消失，
# 服务的 WorkingDirectory 会指向不存在的路径；这里把实体目录搬回去。
restore_legacy_current() {
  [ -n "${LEGACY_CURRENT_BACKUP:-}" ] || return 0
  if [ ! -d "$LEGACY_CURRENT_BACKUP" ]; then
    LEGACY_CURRENT_BACKUP=''
    return 0
  fi
  # 已经存在新的链接/目录时不覆盖，交给后续软链回滚处理
  if [ -e "$CURRENT_LINK" ] || [ -L "$CURRENT_LINK" ]; then
    LEGACY_CURRENT_BACKUP=''
    return 0
  fi
  if mv "$LEGACY_CURRENT_BACKUP" "$CURRENT_LINK"; then
    echo "[release] 已恢复原 current 实体目录：${CURRENT_LINK}" >&2
    LEGACY_CURRENT_BACKUP=''
  else
    echo "[release] ✗ 恢复 current 实体目录失败，请人工执行：mv ${LEGACY_CURRENT_BACKUP} ${CURRENT_LINK}" >&2
  fi
}

# 只清理本次运行实际创建的目录（CREATED_*），不按 RELEASE_ID 反推。
cleanup_created_dirs() {
  local dir real_current=''
  if [ -e "$CURRENT_LINK" ] || [ -L "$CURRENT_LINK" ]; then
    real_current="$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)"
  fi
  for dir in "$CREATED_STAGING_DIR" "$CREATED_RELEASE_DIR"; do
    [ -n "$dir" ] || continue
    [ -d "$dir" ] || continue
    # 双保险：即使记录错了，也绝不删除 current 正在指向的目录
    if [ -n "$real_current" ] && [ "$(readlink -f "$dir" 2>/dev/null || true)" = "$real_current" ]; then
      continue
    fi
    rm -rf "$dir"
    echo "[release] 已清理本次未启用的目录：${dir}" >&2
  done
  CREATED_STAGING_DIR=''
  CREATED_RELEASE_DIR=''
}

# 回滚：与发布共用同一份状态（PREVIOUS_TARGET / CURRENT_SWITCHED）：
# 只有真正切过 current 才改软链，且在切换之前记录的旧目录里重启服务。
rollback() {
  set_stage '回滚到上一个版本'
  # 安装包暂存目录在版本校验失败时会被留下，这里统一清掉
  if [ -n "${PRINT_AGENT_STAGED:-}" ] && [ -d "$PRINT_AGENT_STAGED" ]; then
    rm -rf "$PRINT_AGENT_STAGED"
    echo "[release] 已清理未完成的安装包暂存目录：${PRINT_AGENT_STAGED}" >&2
    PRINT_AGENT_STAGED=''
  fi
  # 先恢复被移走的实体 current（参数校验/解包阶段失败也可能已经移走，且此时 current 是空的）
  restore_legacy_current
  if ! is_true "$CURRENT_SWITCHED"; then
    # 失败发生在切换 current 之前（校验/解包/依赖/迁移阶段）：线上仍是旧版本。
    # 本次新建但未启用的目录直接删掉，避免失败的半成品混进历史版本、把真正可回滚的版本挤出保留窗口。
    cleanup_created_dirs
    echo '[release] 尚未切换 current，线上仍运行旧版本，无需回滚' >&2
    return 0
  fi
  if [ -z "$PREVIOUS_TARGET" ] || [ ! -d "$PREVIOUS_TARGET" ]; then
    echo '[release] ✗ 已切换 current 但找不到上一个版本目录，请人工介入' >&2
    return 1
  fi
  if ln -sfn "$PREVIOUS_TARGET" "$CURRENT_LINK"; then
    CURRENT_SWITCHED=false
    echo "[release] 已回滚 current → ${PREVIOUS_TARGET}" >&2
  else
    echo "[release] ✗ 回滚切换软链失败，请人工执行：ln -sfn ${PREVIOUS_TARGET} ${CURRENT_LINK}" >&2
  fi
  # 新版本重启失败时服务可能已经停下，这里的重启是关键步骤，失败必须显式暴露
  # shellcheck disable=SC2086
  if ! $SUDO systemctl restart "$APP_SERVICE"; then
    echo "[release] ✗ 回滚后重启服务失败，请人工执行：${SUDO} systemctl restart ${APP_SERVICE}" >&2
  fi
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
  cleanup_print_agent_versions
}

# 安装包版本目录只保留仍被存活 release 引用的版本，以及残留的临时目录
cleanup_print_agent_versions() {
  if [ ! -d "$PRINT_AGENT_VERSIONS_DIR" ]; then
    return 0
  fi
  local dir target keep=''
  for dir in "${RELEASES_DIR}"/*/; do
    [ -d "$dir" ] || continue
    if [ -L "${dir}public/print-agent" ]; then
      target="$(readlink -f "${dir}public/print-agent" 2>/dev/null || true)"
      [ -n "$target" ] && keep="${keep}${target}"$'\n'
    fi
  done
  for dir in "${PRINT_AGENT_VERSIONS_DIR}"/*/ "${PRINT_AGENT_VERSIONS_DIR}"/.*.incoming.*/; do
    [ -d "$dir" ] || continue
    if [ -n "$keep" ] && printf '%s' "$keep" | grep -Fxq "$(readlink -f "$dir" 2>/dev/null || true)"; then
      continue
    fi
    rm -rf "$dir"
    echo "[release] 已清理未使用的安装包版本：${dir}"
  done
}

main() {
  validate_inputs
  resolve_release_id
  load_runtime_env
  backup_database
  prepare_release_dir
  publish_print_agent_assets
  install_dependencies
  run_migrations
  switch_current_symlink
  restart_service
  wait_healthcheck
  verify_print_agent_download
  cleanup_old_releases
  echo "[release] ✅ 发布完成：${RELEASE_ID}"
  echo "[release] current → $(readlink -f "$CURRENT_LINK" 2>/dev/null || echo "$CURRENT_LINK")"
}

# 任意阶段失败都先尝试回滚，避免把线上停在「新代码 + 旧库」或半迁移状态。
#
# 注意：这里不能写成 `if ! (main); then ...`。
# 1) 条件上下文会关闭子 shell 内的 set -e，install / migrate / restart 失败后脚本继续往下跑，
#    最后仍打印「发布完成」；
# 2) 子 shell 里设置的 PREVIOUS_TARGET / BACKUP_FILE 不会传回父 shell，
#    回滚拿不到旧版本目录，只会打印「尚未切换 current」而把新版留在线上。
# 因此 main 直接在当前 shell 执行，统一由 EXIT trap 兜底回滚，状态天然共享。
finalize() {
  local status=$?
  trap - EXIT
  if [ "$status" -eq 0 ]; then
    return 0
  fi
  echo '[release] ✗ 发布失败，开始回滚' >&2
  if ! is_true "$RELEASE_DRY_RUN"; then
    rollback || true
  fi
  exit "$status"
}

trap finalize EXIT
main
trap - EXIT

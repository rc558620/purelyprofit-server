#!/bin/bash
# 发布脚本安全回归（无需 root、无需真实服务）：
# 失败路径绝不允许动到「正在使用的发布目录 / current / 已发布安装包」。
#
# 覆盖的回归点：
#   1. 同一 SHA 重发 + 参数校验失败 → 旧发布目录与两份下载包原样保留
#   2. 依赖安装失败 → 不切 current、不留半成品目录
#   3. 健康检查失败 → current 回滚到旧版，两份旧包 SHA-256 不变
#   4. 旧版 current 是实体目录 + 建链失败 → 实体目录被搬回 current
#   5. 旧布局只有 Windows 包 + 新产物两份齐全 → 不再阻断发布
#   6. 同一 SHA 重发坏包（版本不一致）→ 旧目录与两份下载包原样保留
#
# 用法：bash deploy/scripts/tests/release-safety.test.sh
set -uo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/remote-release.sh"
WORK="$(mktemp -d -t release-safety)"
trap 'rm -rf "$WORK"' EXIT

failures=0
pass() { printf '  ✓ %s\n' "$1"; }
bad() {
  printf '  ✗ %s\n' "$1"
  failures=$((failures + 1))
}
assert_same() { if [ "$1" = "$2" ]; then pass "$3"; else bad "$3（期望 ${1}，实际 ${2}）"; fi; }
assert_dir() { if [ -d "$1" ]; then pass "$2"; else bad "$2（目录不存在：$1）"; fi; }
assert_link() { if [ -L "$1" ]; then pass "$2"; else bad "$2（不是软链：$1）"; fi; }
assert_not_link() { if [ ! -L "$1" ] && [ -d "$1" ]; then pass "$2"; else bad "$2（应为实体目录：$1）"; fi; }

sha_of() { if [ -r "$1" ]; then shasum -a 256 "$1" | awk '{print $1}'; else echo '(missing)'; fi; }

make_tools() { # $1=目录 $2=pnpm(ok|fail) $3=ln(ok|fail)
  mkdir -p "$1"
  printf '#!/bin/sh\nexit 0\n' >"$1/systemctl"
  printf '#!/bin/sh\nexec "$@"\n' >"$1/sudo"
  if [ "$2" = fail ]; then
    printf '#!/bin/sh\necho "pnpm install failed" >&2\nexit 1\n' >"$1/pnpm"
  else
    printf '#!/bin/sh\nexit 0\n' >"$1/pnpm"
  fi
  rm -f "$1/ln"
  if [ "$3" = fail ]; then
    # 只注入「建 current 软链」失败，安装包软链仍走真实 ln
    cat >"$1/ln" <<'SHIM'
#!/bin/sh
for last do :; done
case "$last" in
  */public/print-agent) exec /bin/ln "$@" ;;
  *) echo "ln failed (injected)" >&2; exit 1 ;;
esac
SHIM
  fi
  chmod +x "$1"/*
}

make_archive() { # $1=tar 路径 $2=安装包版本（空=产物不带安装包）
  local work
  work="$(mktemp -d)"
  mkdir -p "$work/dist/src" "$work/prisma" "$work/public/print-agent"
  printf 'x' >"$work/dist/cluster-main.js"
  printf 'x' >"$work/dist/src/main.js"
  printf '{"name":"demo"}' >"$work/package.json"
  printf 'lockfileVersion: 9\n' >"$work/pnpm-lock.yaml"
  printf 'export default {};\n' >"$work/prisma.config.ts"
  printf '' >"$work/prisma/schema.prisma"
  if [ -n "$2" ]; then
    printf 'exe-%s' "$2" >"$work/public/print-agent/print-agent-win64.exe"
    printf 'zip-%s' "$2" >"$work/public/print-agent/print-agent-macos-app.zip"
    printf '%s\n' "$2" >"$work/public/print-agent/VERSION"
  fi
  (cd "$work" && tar -czf "$1" dist prisma prisma.config.ts package.json pnpm-lock.yaml public)
  rm -rf "$work"
}

init_app() { # $1=APP_ROOT $2=线上版本号；current 指向 releases/<sha> 软链
  local root="$1" version="$2"
  rm -rf "$root"
  mkdir -p "$root/releases/abc123/dist" "$root/releases/abc123/public/print-agent"
  printf 'old' >"$root/releases/abc123/dist/cluster-main.js"
  printf 'exe-%s' "$version" >"$root/releases/abc123/public/print-agent/print-agent-win64.exe"
  printf 'zip-%s' "$version" >"$root/releases/abc123/public/print-agent/print-agent-macos-app.zip"
  printf '%s\n' "$version" >"$root/releases/abc123/public/print-agent/VERSION"
  ln -sfn "$root/releases/abc123" "$root/current"
  # 目标版本固定 0.1.2，线上旧版本由调用方指定，用于区分「新包」与「旧包」
  printf 'PRINT_AGENT_LATEST_VERSION=0.1.2\nDATABASE_URL=postgresql://u:p@127.0.0.1:5432/fake\n' >"$root/app.env"
  printf '{"status":"ok","dependencies":[{"name":"db","status":"up"}]}' >"$root/hc-ok.json"
  printf '{"status":"error","dependencies":[{"name":"db","status":"down"}]}' >"$root/hc-bad.json"
  make_archive "$root/rel.tar.gz" 0.1.2
}

deploy() { # 走真实脚本；环境变量由调用方以 KEY=VALUE 前缀传入
  local root="$WORK/app"
  env \
    PATH="$WORK/tools:$PATH" \
    APP_SUDO='' \
    RELEASE_ID="${RID:-abc123}" \
    RELEASE_ARCHIVE="${ARCHIVE:-$WORK/app/rel.tar.gz}" \
    APP_ROOT="$root" \
    APP_SERVICE=demo \
    APP_ENV_FILE="${ENV_FILE:-$root/app.env}" \
    APP_HEALTHCHECK_URL="${HC:-file://$root/hc-ok.json}" \
    APP_HEALTHCHECK_TIMEOUT_SECONDS='2' \
    APP_KEEP_RELEASES='5' \
    RELEASE_REQUIRE_BACKUP=false \
    PRINT_AGENT_LATEST_VERSION="${EXPECT_VERSION:-0.1.1}" \
    bash "$SCRIPT"
}

echo '── 用例 1：同一 SHA 重发 + 参数校验失败，旧版本原样保留'
init_app "$WORK/app" 0.1.1
make_tools "$WORK/tools" ok ok
make_archive "$WORK/app/rel.tar.gz" 0.1.2
EXE_BEFORE="$(sha_of "$WORK/app/releases/abc123/public/print-agent/print-agent-win64.exe")"
ZIP_BEFORE="$(sha_of "$WORK/app/releases/abc123/public/print-agent/print-agent-macos-app.zip")"
ARCHIVE="$WORK/app/rel.tar.gz" ENV_FILE="$WORK/app/does-not-exist.env" deploy >"$WORK/1.log" 2>&1
status=$?
[ "$status" -ne 0 ] && pass '脚本以非 0 退出' || bad '脚本本应失败却返回 0'
assert_dir "$WORK/app/releases/abc123" '旧发布目录仍在'
assert_link "$WORK/app/current" 'current 仍是软链'
assert_same "$(cd "$WORK/app/releases/abc123" && pwd -P)" "$(readlink -f "$WORK/app/current")" 'current 仍指向旧发布目录'
assert_same "$EXE_BEFORE" "$(sha_of "$WORK/app/releases/abc123/public/print-agent/print-agent-win64.exe")" '旧 Windows 包未被删除或替换'
assert_same "$ZIP_BEFORE" "$(sha_of "$WORK/app/releases/abc123/public/print-agent/print-agent-macos-app.zip")" '旧 macOS 包未被删除或替换'
assert_same 'abc123' "$(ls "$WORK/app/releases")" '没有留下多余的发布目录'

echo '── 用例 2：依赖安装失败'
init_app "$WORK/app" 0.1.1
make_tools "$WORK/tools" fail ok
RID=dead01 deploy >"$WORK/2.log" 2>&1
status=$?
[ "$status" -ne 0 ] && pass '安装失败时脚本非 0 退出' || bad '安装失败被吞掉'
assert_same "$(cd "$WORK/app/releases/abc123" && pwd -P)" "$(readlink -f "$WORK/app/current")" 'current 未被切换'
assert_same 'abc123' "$(ls "$WORK/app/releases")" '半成品目录已清理'

echo '── 用例 3：健康检查失败后回滚，旧包不变'
init_app "$WORK/app" 0.1.1
make_tools "$WORK/tools" ok ok
EXE_BEFORE="$(sha_of "$WORK/app/releases/abc123/public/print-agent/print-agent-win64.exe")"
ZIP_BEFORE="$(sha_of "$WORK/app/releases/abc123/public/print-agent/print-agent-macos-app.zip")"
HC="file://$WORK/app/hc-bad.json" RID=dead02 deploy >"$WORK/3.log" 2>&1
status=$?
[ "$status" -ne 0 ] && pass '健康检查失败时脚本非 0 退出' || bad '健康检查失败被判成功'
assert_same "$(cd "$WORK/app/releases/abc123" && pwd -P)" "$(readlink -f "$WORK/app/current")" 'current 已回滚到旧版本'
assert_same "$EXE_BEFORE" "$(sha_of "$WORK/app/releases/abc123/public/print-agent/print-agent-win64.exe")" '回滚后旧 Windows 包不变'
assert_same "$ZIP_BEFORE" "$(sha_of "$WORK/app/releases/abc123/public/print-agent/print-agent-macos-app.zip")" '回滚后旧 macOS 包不变'

echo '── 用例 4：旧版 current 是实体目录 + 建链失败'
init_app "$WORK/app" 0.1.1
rm -f "$WORK/app/current"
cp -a "$WORK/app/releases/abc123" "$WORK/app/current"
make_tools "$WORK/tools" ok fail
RID=dead03 deploy >"$WORK/4.log" 2>&1
status=$?
[ "$status" -ne 0 ] && pass '建链失败时脚本非 0 退出' || bad '建链失败被吞掉'
# 先确认确实走到了「移走旧实体目录」这一步，否则本用例会变成假绿
if grep -q 'current 原为真实目录' "$WORK/4.log"; then pass '旧实体目录已被移走备份'; else bad '未走到实体目录切换分支'; fi
if grep -q '已恢复原 current 实体目录' "$WORK/4.log"; then pass '退出清理恢复了实体 current'; else bad '退出清理没有恢复实体 current'; fi
assert_not_link "$WORK/app/current" '实体 current 被搬回（不是悬空链接）'

echo '── 用例 5：旧布局只有 Windows 包，新产物两份齐全'
init_app "$WORK/app" 0.1.1
mkdir -p "$WORK/app/shared/print-agent"
printf 'exe-legacy' >"$WORK/app/shared/print-agent/print-agent-win64.exe"
make_tools "$WORK/tools" ok ok
make_archive "$WORK/app/full.tar.gz" 0.1.2
RID=fab5c1 deploy >"$WORK/5.log" 2>&1
status=$?
[ "$status" -eq 0 ] && pass '完整新包未被不完整旧布局阻断' || {
  bad "完整新包被旧布局阻断：$(grep -m1 '✗ 阶段' "$WORK/5.log")"
}
assert_dir "$WORK/app/releases/fab5c1" '新发布目录已创建'

echo '── 用例 6：同一 SHA 重发坏包（版本与配置不一致）'
init_app "$WORK/app" 0.1.1
make_tools "$WORK/tools" ok ok
make_archive "$WORK/app/bad.tar.gz" 0.1.9
EXE_BEFORE="$(sha_of "$WORK/app/releases/abc123/public/print-agent/print-agent-win64.exe")"
ZIP_BEFORE="$(sha_of "$WORK/app/releases/abc123/public/print-agent/print-agent-macos-app.zip")"
EXPECT_VERSION=0.1.2 RID=abc123 ARCHIVE="$WORK/app/bad.tar.gz" deploy >"$WORK/6.log" 2>&1
status=$?
[ "$status" -ne 0 ] && pass '坏包被拒绝' || bad '坏包被接受'
assert_same "$(cd "$WORK/app/releases/abc123" && pwd -P)" "$(readlink -f "$WORK/app/current")" 'current 仍指向旧发布目录'
assert_same "$EXE_BEFORE" "$(sha_of "$WORK/app/releases/abc123/public/print-agent/print-agent-win64.exe")" '旧 Windows 包 SHA-256 不变'
assert_same "$ZIP_BEFORE" "$(sha_of "$WORK/app/releases/abc123/public/print-agent/print-agent-macos-app.zip")" '旧 macOS 包 SHA-256 不变'
assert_same 'abc123' "$(ls "$WORK/app/releases")" '失败的新目录已清理'

echo
if [ "$failures" -eq 0 ]; then
  echo '全部回归用例通过'
  exit 0
fi
echo "存在 ${failures} 项失败"
exit 1

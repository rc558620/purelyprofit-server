#!/bin/bash
#
# 全新库验证迁移链 —— 上线前的数据库健康检查。
#
# 目的：证明「删掉现在这个库，仅靠 prisma/migrations 也能 100% 重建出可用结构」。
# 这是上线最大的技术风险点：只要迁移链能从零重放成功，就不存在「本地库是唯一事实源」
# 这种隐性依赖，换机器、换环境、重建生产库都不会踩空。
#
# 流程：
#   1. 读 .env 的 DATABASE_URL 作为模板
#   2. 建一个临时空库（默认 purelyprofit_migrationcheck）
#   3. 在该库上 prisma migrate deploy（从零重放全部迁移）
#   4. prisma migrate status 确认 up to date
#   5. 用 migrate diff 比对「实际结构」与「schema.prisma」，
#      与基线文件 scripts/data/fresh-chain-expected-diff.sql 对比：
#        - 完全一致 → 通过（差异在预期范围内）
#        - 出现新差异 → 失败并打印，提示要么补迁移、要么更新基线
#   6. 默认清理临时库（KEEP_DB=true 可保留用于排查）
#
# 用法：
#   bash ./scripts/verify-fresh-migration-chain.sh                # 验证
#   bash ./scripts/verify-fresh-migration-chain.sh --update-baseline  # 重写基线
#   FRESH_DB=mycheck KEEP_DB=true bash ./scripts/verify-fresh-migration-chain.sh
#
# 环境变量：
#   FRESH_DB        临时库名，默认 purelyprofit_migrationcheck
#   KEEP_DB         true 时结束后不删临时库
#   BASELINE_FILE   基线文件路径，默认 scripts/data/fresh-chain-expected-diff.sql

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

# psql / createdb / dropdb 的 PATH 兜底
# shellcheck source=./pg-env.sh
source "$PROJECT_ROOT/scripts/pg-env.sh"

FRESH_DB="${FRESH_DB:-purelyprofit_migrationcheck}"
KEEP_DB="${KEEP_DB:-false}"
BASELINE_FILE="${BASELINE_FILE:-scripts/data/fresh-chain-expected-diff.sql}"
UPDATE_BASELINE=false
[[ "${1:-}" == "--update-baseline" ]] && UPDATE_BASELINE=true

DIFF_TMP="$(mktemp -t pp-fresh-chain-diff)"
cleanup_tmp() { rm -f "$DIFF_TMP"; }
trap cleanup_tmp EXIT

# ── 工具函数 ────────────────────────────────────────────────────────────────

log() { printf '\n==> %s\n' "$*"; }
fail() { printf '\n✗ %s\n' "$*" >&2; exit 1; }

# 把 DATABASE_URL 的数据库名替换成目标库名。
# 同时去掉 ?schema=public 这类 Prisma 专有查询参数：psql / createdb 不接受它会直接报错，
# 而 prisma CLI 识别的是原始 DATABASE_URL，两者互不影响。
build_database_url() {
  node -e '
    const raw = process.argv[1];
    const dbName = process.argv[2];
    const url = new URL(raw);
    url.pathname = "/" + dbName;
    url.search = "";
    console.log(url.toString());
  ' "$1" "$2"
}

# ── 1. 读取 DATABASE_URL ────────────────────────────────────────────────────

log "解析 DATABASE_URL"
# 环境变量优先（CI 里由 Secrets 注入且没有 .env），本机开发则回落到 .env 文件
SOURCE_URL="${DATABASE_URL:-}"

if [[ -z "$SOURCE_URL" ]]; then
  SOURCE_URL="$(
    [[ -f .env ]] && node --env-file=.env -e 'console.log(process.env.DATABASE_URL ?? "")' || echo ""
  )"
fi

[[ -n "$SOURCE_URL" ]] || fail "缺少 DATABASE_URL（请设置环境变量或在 .env 中配置）"

# 建/删库需要连到另一个库，这里统一用 postgres 系统库
ADMIN_URL="$(build_database_url "$SOURCE_URL" "postgres")"
FRESH_URL="$(build_database_url "$SOURCE_URL" "$FRESH_DB")"

# ── 2. 建临时空库 ───────────────────────────────────────────────────────────

log "重建临时空库：$FRESH_DB"
if ! psql "$ADMIN_URL" -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE IF EXISTS \"$FRESH_DB\" WITH (FORCE)" \
  -c "CREATE DATABASE \"$FRESH_DB\""; then
  fail "创建临时库失败：请确认数据库账号具备 CREATEDB 权限（ALTER ROLE <user> CREATEDB）"
fi

drop_fresh_db() {
  if [[ "$KEEP_DB" == "true" ]]; then
    echo "==> KEEP_DB=true，保留临时库 $FRESH_DB"
    return
  fi
  echo "==> 清理临时库 $FRESH_DB"
  psql "$ADMIN_URL" -v ON_ERROR_STOP=1 \
    -c "DROP DATABASE IF EXISTS \"$FRESH_DB\" WITH (FORCE)" || true
}
trap drop_fresh_db EXIT

# ── 3. 从零重放全部迁移 ─────────────────────────────────────────────────────

log "在 $FRESH_DB 上执行 prisma migrate deploy（从零重放迁移链）"
DATABASE_URL="$FRESH_URL" ./node_modules/.bin/prisma migrate deploy

# ── 4. 确认迁移状态干净 ─────────────────────────────────────────────────────

log "校验迁移状态"
STATUS_OUTPUT="$(DATABASE_URL="$FRESH_URL" ./node_modules/.bin/prisma migrate status)"
echo "$STATUS_OUTPUT"
grep -q "up to date" <<<"$STATUS_OUTPUT" ||
  fail "迁移状态不是 up to date，迁移链重放后仍有待应用迁移"

# ── 5. 结构与 schema.prisma 的差异比对 ──────────────────────────────────────

log "比对结构差异（实际结构 vs schema.prisma）"
DATABASE_URL="$FRESH_URL" ./node_modules/.bin/prisma migrate diff \
  --from-config-datasource --to-schema prisma --script >"$DIFF_TMP"

if [[ "$UPDATE_BASELINE" == "true" ]]; then
  mkdir -p "$(dirname "$BASELINE_FILE")"
  cp "$DIFF_TMP" "$BASELINE_FILE"
  echo "==> 已写入基线：$BASELINE_FILE"
  cat "$BASELINE_FILE"
  exit 0
fi

if [[ ! -f "$BASELINE_FILE" ]]; then
  fail "缺少基线文件 $BASELINE_FILE，请先执行：bash ./scripts/verify-fresh-migration-chain.sh --update-baseline"
fi

if diff -u "$BASELINE_FILE" "$DIFF_TMP" >/dev/null; then
  echo "✓ 差异与基线一致（均为已知且有意保留的对象）"
else
  echo "✗ 出现非预期的结构差异（基线 < ，当前 >）：" >&2
  diff -u "$BASELINE_FILE" "$DIFF_TMP" >&2 || true
  echo "" >&2
  echo "处理建议：" >&2
  echo "  1. 若是本次改动遗漏了迁移，请补写 migration 后重跑；" >&2
  echo "  2. 若该差异确实有意保留（如手写索引/归档表），请更新基线：" >&2
  echo "     bash ./scripts/verify-fresh-migration-chain.sh --update-baseline" >&2
  exit 1
fi

log "全新库迁移链验证通过"

if [[ "$KEEP_DB" == "true" ]]; then
  keep_state="已保留"
else
  keep_state="已清理"
fi

echo "- 临时库: ${FRESH_DB} (${keep_state})"
echo "- 基线文件: ${BASELINE_FILE}"

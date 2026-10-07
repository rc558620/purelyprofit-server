#!/usr/bin/env bash
#
# db-optimization-pack.sh
#
# 生成数据库优化 Prompt 资产包的「机械部分」：
#   1) 三份输入清单（索引 / 写路径 / 事务），供调用 3、4、6 粘贴
#   2) 可复制的完整 Prompt（前置块 + 各任务卡拼接）
#   3) 调用 8 的 9 个模块变体
#
# 前置块与任务卡的源文件位于 docs/db-optimization/prompts/，可直接编辑。
#
# 用法：
#   bash scripts/db-optimization-pack.sh            # 全部生成
#   bash scripts/db-optimization-pack.sh inputs     # 只生成输入清单
#   bash scripts/db-optimization-pack.sh assemble   # 只拼接完整 Prompt

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${ROOT}/docs/db-optimization"
PROMPTS="${OUT}/prompts"
INPUTS="${OUT}/inputs"
ASSEMBLED="${OUT}/assembled"

# 实施阶段的目录与任务卡（与「分析阶段」并列，互不影响）
IMPL_OUT="${OUT}/实施"
IMPL_PROMPTS="${IMPL_OUT}/prompts"
IMPL_ASSEMBLED="${IMPL_OUT}/assembled"

IMPL_CARD_IDS=(
  "01-repo-config"
  "02-pg-server"
  "03-partition-decision"
  "04-index-disposal"
  "05-index-add"
  "06-code-rewrite"
  "07-cache-cleanup"
  "08-loadtest-launch"
  "09-archive-job"
  "10-config-finalize"
  "11-server-runbook"
)

# 调用 8 需要逐个模块执行，此处定义遍历顺序
MODULES=(operations member marketing finance goods staff stores club pulse)

# 任务卡文件名（顺序即调用顺序）
# 调用 8 是模板，不在此列表，由 gen_assembled 逐个模块生成变体
CARD_IDS=(
  "01-capacity"
  "02-server-pg-tuning"
  "03-index-audit"
  "04-write-hotspot"
  "05-query-degradation"
  "06-tx-connection"
  "07-idempotency-audit-log"
  "09-verify-launch"
)

log() {
  printf '[pack] %s\n' "$*"
}

die() {
  printf '[pack] 错误：%s\n' "$*" >&2
  exit 1
}

require_file() {
  if [[ ! -f "$1" ]]; then
    die "缺少文件 $1，请先确认 docs/db-optimization/prompts/ 下的任务卡是否完整。"
  fi
}

# 生成三份输入清单
gen_inputs() {
  mkdir -p "${INPUTS}"

  local prisma_files
  prisma_files="$(find "${ROOT}/prisma/purely-profit" -name '*.prisma' | sort)"

  if [[ -z "${prisma_files}" ]]; then
    die "未找到 prisma schema 文件，请确认 prisma/purely-profit/ 存在。"
  fi

  # 1. 索引清单：文件 | model | 索引声明
  # shellcheck disable=SC2086
  awk '/^model /{m=$2} /@@(index|unique)/{gsub(/  +/," ");print FILENAME" | "m" | "$0}' \
    ${prisma_files} > "${INPUTS}/01-index-inventory.txt"

  # 2. 写路径盘点：默认只取 operations + member（全量约 415 行，按需自行放开）
  grep -rn "\.update(\|\.updateMany(\|\.upsert(\|\.deleteMany(\|\.create(" \
    "${ROOT}/src/purely-profit/operations" \
    "${ROOT}/src/purely-profit/member" \
    --include='*.ts' 2>/dev/null | grep -v '\.spec\.ts' > "${INPUTS}/02-write-paths.txt" || true

  # 3. 事务盘点
  grep -rn '\$transaction' "${ROOT}/src" --include='*.ts' 2>/dev/null \
    | grep -v '\.spec\.ts' > "${INPUTS}/03-transactions.txt" || true

  log "输入清单已生成："
  wc -l "${INPUTS}"/*.txt | sed 's/^/       /'
}

# 拼接「前置块 + 任务卡」为可直接复制的完整 Prompt
gen_assembled() {
  mkdir -p "${ASSEMBLED}"
  # 清理上一轮产物，避免任务卡改名后残留过期文件被误粘
  find "${ASSEMBLED}" -maxdepth 1 -name '*.full.md' -delete

  local preamble="${PROMPTS}/preamble.md"
  require_file "${preamble}"

  local id card
  for id in "${CARD_IDS[@]}"; do
    card="${PROMPTS}/${id}.md"
    require_file "${card}"
    cat "${preamble}" > "${ASSEMBLED}/${id}.full.md"
    printf '\n---\n\n' >> "${ASSEMBLED}/${id}.full.md"
    cat "${card}" >> "${ASSEMBLED}/${id}.full.md"
    log "已拼接 ${id}.full.md"
  done

  # 调用 8：为每个模块生成独立变体，替换卡内的 <模块名> 占位
  local template="${PROMPTS}/08-module-template.md"
  require_file "${template}"

  local module
  for module in "${MODULES[@]}"; do
    cat "${preamble}" > "${ASSEMBLED}/08-module-${module}.full.md"
    printf '\n---\n\n' >> "${ASSEMBLED}/08-module-${module}.full.md"
    sed "s/<模块名>/${module}/g" "${template}" >> "${ASSEMBLED}/08-module-${module}.full.md"
    log "已拼接 08-module-${module}.full.md"
  done

  log "共生成 $(find "${ASSEMBLED}" -name '*.full.md' | wc -l | tr -d ' ') 个完整 Prompt。"
}

# 拼接「实施前置块 + 实施任务卡」
gen_impl_assembled() {
  mkdir -p "${IMPL_ASSEMBLED}"
  find "${IMPL_ASSEMBLED}" -maxdepth 1 -name '*.full.md' -delete

  local preamble="${IMPL_PROMPTS}/preamble.md"
  require_file "${preamble}"

  local id card
  for id in "${IMPL_CARD_IDS[@]}"; do
    card="${IMPL_PROMPTS}/${id}.md"
    require_file "${card}"
    cat "${preamble}" > "${IMPL_ASSEMBLED}/${id}.full.md"
    printf '\n---\n\n' >> "${IMPL_ASSEMBLED}/${id}.full.md"
    cat "${card}" >> "${IMPL_ASSEMBLED}/${id}.full.md"
    log "已拼接 实施/${id}.full.md"
  done
}

# 摘要便签由 docs/db-optimization/实施/notes.md 手工维护，此处仅做存在性提醒
check_impl_notes() {
  if [[ ! -f "${IMPL_OUT}/notes.md" ]]; then
    printf '[pack] 提示：%s 不存在，请先创建（各任务卡的「文件操作」会写入该文件）。\n' \
      "${IMPL_OUT}/notes.md" >&2
  fi
}

main() {
  local target="${1:-all}"

  case "${target}" in
    inputs) gen_inputs ;;
    assemble) gen_assembled ;;
    impl)
      gen_impl_assembled
      check_impl_notes
      ;;
    all)
      gen_inputs
      gen_assembled
      gen_impl_assembled
      check_impl_notes
      ;;
    *)
      printf '用法：%s [all|inputs|assemble|impl]\n' "$0" >&2
      printf '  all       全部分析阶段 + 实施阶段\n' >&2
      printf '  inputs    只生成三份输入清单\n' >&2
      printf '  assemble  只拼接分析阶段的完整 Prompt\n' >&2
      printf '  impl      只拼接实施阶段的完整 Prompt\n' >&2
      exit 1
      ;;
  esac

  log "完成。产物目录：${OUT}"
  log "分析阶段：docs/db-optimization/跟着做.md"
  log "实施阶段：docs/db-optimization/实施/跟着做.md"
}

main "$@"

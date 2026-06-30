#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════
# 核心查询 EXPLAIN ANALYZE 基线采集脚本
# 目的：确认现有/新增索引是否真正生效，为后续优化提供数据支撑
#
# 用法：DATABASE_URL=postgresql://... bash scripts/explain-analyze-baseline.sh
#
# 输出：每个核心查询的执行计划，带实际耗时
# ═══════════════════════════════════════════════════════════

set -euo pipefail

# 检查 DATABASE_URL
if [ -z "${DATABASE_URL:-}" ]; then
  echo "❌ 请设置 DATABASE_URL 环境变量"
  echo "   示例: DATABASE_URL=postgresql://user:pass@host:5432/db bash scripts/explain-analyze-baseline.sh"
  exit 1
fi

PSQL="psql ${DATABASE_URL} -c"

echo "════════════════════════════════════════════════════════════"
echo "  EXPLAIN ANALYZE 基线采集"
echo "  采集时间: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo "════════════════════════════════════════════════════════════"
echo ""

# ── 辅助函数 ─────────────────────────────────────────────
run_explain() {
  local label="$1"
  local sql="$2"
  echo "──────────────────────────────────────────────────────────"
  echo "  📊 ${label}"
  echo "──────────────────────────────────────────────────────────"
  ${PSQL} "EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${sql}" 2>&1 || true
  echo ""
}

# ── 测试门店 ID（使用一个实际存在的门店 ID）────────────────
STORE_ID=${STORE_ID:-1}

# ═══════════════════════════════════════════════════════════
# 1. 销售记录列表
# ═══════════════════════════════════════════════════════════
run_explain \
  "销售记录列表 - 主查询 (store_id=${STORE_ID}, date DESC, id DESC)" \
  "SELECT id, order_no, date, created_at FROM sale_orders WHERE store_id = ${STORE_ID} ORDER BY date DESC, id DESC LIMIT 20"

run_explain \
  "销售记录列表 - 日期区间 (store_id=${STORE_ID}, 最近7天)" \
  "SELECT id, order_no, date, created_at FROM sale_orders WHERE store_id = ${STORE_ID} AND date >= CURRENT_DATE - INTERVAL '7 days' AND date <= CURRENT_DATE ORDER BY date DESC, id DESC LIMIT 20"

run_explain \
  "销售记录列表 - 计数 (store_id=${STORE_ID}, 最近7天)" \
  "SELECT COUNT(*) FROM sale_orders WHERE store_id = ${STORE_ID} AND date >= CURRENT_DATE - INTERVAL '7 days' AND date <= CURRENT_DATE"

# ═══════════════════════════════════════════════════════════
# 2. 空间预约列表
# ═══════════════════════════════════════════════════════════
run_explain \
  "空间预约列表 - 门店维度 (store_id=${STORE_ID}, status=pending)" \
  "SELECT id, space_id, guest_name, reserved_at, created_at FROM space_reservations WHERE store_id = ${STORE_ID} AND status = 'pending' ORDER BY reserved_at ASC, created_at ASC, id ASC LIMIT 200"

run_explain \
  "空间预约列表 - 空间维度 (space_id=1, status=pending)" \
  "SELECT id, space_id, guest_name, reserved_at, created_at FROM space_reservations WHERE space_id = 1 AND status = 'pending' ORDER BY reserved_at ASC, created_at ASC, id ASC LIMIT 200"

# ═══════════════════════════════════════════════════════════
# 3. 空间会话列表
# ═══════════════════════════════════════════════════════════
run_explain \
  "空间会话列表 - 门店维度 active (store_id=${STORE_ID}, status=active, start_time DESC)" \
  "SELECT id, space_id, guest_name, start_time, status FROM space_sessions WHERE store_id = ${STORE_ID} AND status = 'active' ORDER BY start_time DESC, id DESC LIMIT 200"

run_explain \
  "空间会话列表 - 门店维度 settled (store_id=${STORE_ID}, status=settled, start_time DESC)" \
  "SELECT id, space_id, guest_name, start_time, end_time, status FROM space_sessions WHERE store_id = ${STORE_ID} AND status = 'settled' ORDER BY start_time DESC, id DESC LIMIT 20"

run_explain \
  "空间会话列表 - 门店维度 settled 按 end_time (store_id=${STORE_ID}, status=settled, end_time DESC)" \
  "SELECT id, space_id, guest_name, start_time, end_time, status FROM space_sessions WHERE store_id = ${STORE_ID} AND status = 'settled' ORDER BY end_time DESC, id DESC LIMIT 20"

run_explain \
  "空间会话列表 - 手机号前缀搜索 (store_id=${STORE_ID}, guestPhone startsWith '138')" \
  "SELECT id, space_id, guest_name, guest_phone, start_time, status FROM space_sessions WHERE store_id = ${STORE_ID} AND status = 'settled' AND guest_phone LIKE '138%' ORDER BY start_time DESC, id DESC LIMIT 20"

# ═══════════════════════════════════════════════════════════
# 4. 财务流水列表
# ═══════════════════════════════════════════════════════════
run_explain \
  "财务流水列表 - 主查询 (store_id=${STORE_ID}, date DESC, created_at DESC, id DESC)" \
  "SELECT id, direction, category, title, amount, date, created_at FROM finance_cash_flow_records WHERE store_id = ${STORE_ID} ORDER BY date DESC, created_at DESC, id DESC LIMIT 20"

run_explain \
  "财务流水列表 - 日期区间 (store_id=${STORE_ID}, 最近30天)" \
  "SELECT id, direction, category, title, amount, date, created_at FROM finance_cash_flow_records WHERE store_id = ${STORE_ID} AND date >= CURRENT_DATE - INTERVAL '30 days' AND date <= CURRENT_DATE ORDER BY date DESC, created_at DESC, id DESC LIMIT 20"

run_explain \
  "财务流水列表 - 日期区间+方向 (store_id=${STORE_ID}, 最近30天, income)" \
  "SELECT id, direction, category, title, amount, date, created_at FROM finance_cash_flow_records WHERE store_id = ${STORE_ID} AND date >= CURRENT_DATE - INTERVAL '30 days' AND date <= CURRENT_DATE AND direction = 'income' ORDER BY date DESC, created_at DESC, id DESC LIMIT 20"

# ═══════════════════════════════════════════════════════════
# 5. 营销顾客列表
# ═══════════════════════════════════════════════════════════
run_explain \
  "营销顾客列表 - 主查询 (store_id=${STORE_ID}, updated_at DESC, id DESC)" \
  "SELECT id, name, phone, tier, balance, points, updated_at FROM marketing_customers WHERE store_id = ${STORE_ID} AND deleted_at IS NULL ORDER BY updated_at DESC, id DESC LIMIT 20"

run_explain \
  "营销顾客列表 - 活跃状态 (store_id=${STORE_ID}, lastVisitAt >= 30天前)" \
  "SELECT id, name, phone, tier, balance, points, updated_at FROM marketing_customers WHERE store_id = ${STORE_ID} AND deleted_at IS NULL AND last_visit_at >= CURRENT_DATE - INTERVAL '30 days' ORDER BY updated_at DESC, id DESC LIMIT 20"

run_explain \
  "营销顾客列表 - 手机号前缀搜索 (store_id=${STORE_ID}, phone startsWith '138')" \
  "SELECT id, name, phone, tier, balance, points, updated_at FROM marketing_customers WHERE store_id = ${STORE_ID} AND deleted_at IS NULL AND phone LIKE '138%' ORDER BY updated_at DESC, id DESC LIMIT 20"

echo "════════════════════════════════════════════════════════════"
echo "  ✅ 基线采集完成"
echo "════════════════════════════════════════════════════════════"

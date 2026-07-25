#!/usr/bin/env bash
# ============================================================================
# 扫码点餐端到端手工联调脚本
# 覆盖步骤 20-24：商家配置 → C 端点餐支付 → 商家处理 → 服务呼叫 → 超时取消
#
# 使用方法：
#   1. 启动后端服务（确保 DATABASE_URL、Redis、JWT_SECRET 已配置）
#   2. 确保 CLUB_MANUAL_CONFIRM_PAID_ENABLED=true（开发环境跳过微信支付）
#   3. 准备两个 token：
#      - MERCHANT_TOKEN：商家端 JWT（拥有 scan-ordering:* 权限的老板或员工）
#      - CLUB_TOKEN：C 端用户 JWT（通过微信小程序登录获取）
#   4. 运行：bash scripts/e2e-scan-ordering.sh
#
# 可选环境变量：
#   BASE_URL          后端地址（默认 http://localhost:3000/api）
#   MERCHANT_TOKEN    商家端 JWT
#   CLUB_TOKEN        C 端用户 JWT
#   SKIP_CONFIRM      设为 1 则每个步骤后等待用户确认再继续
# ============================================================================

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000/api}"
MERCHANT_TOKEN="${MERCHANT_TOKEN:-}"
CLUB_TOKEN="${CLUB_TOKEN:-}"
SKIP_CONFIRM="${SKIP_CONFIRM:-0}"

# ── 颜色 ──────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ── 工具函数 ──────────────────────────────────────────────────
log_section() {
  echo ""
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BLUE}  $1${NC}"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

log_step() {
  echo ""
  echo -e "${YELLOW}▶ [$1] $2${NC}"
}

log_ok() {
  echo -e "${GREEN}  ✅ $1${NC}"
}

log_fail() {
  echo -e "${RED}  ❌ $1${NC}"
}

log_info() {
  echo -e "  ℹ️  $1"
}

pause_if_needed() {
  if [ "$SKIP_CONFIRM" = "1" ]; then
    echo ""
    read -p "  按回车继续..." </dev/tty
  fi
}

# 检查依赖
check_prerequisites() {
  log_section "前置检查"

  if ! command -v jq &>/dev/null; then
    log_fail "未安装 jq（JSON 处理工具），请先安装：brew install jq"
    exit 1
  fi
  log_ok "jq 已安装"

  if [ -z "$MERCHANT_TOKEN" ]; then
    log_fail "MERCHANT_TOKEN 未设置"
    echo "  请设置环境变量：export MERCHANT_TOKEN='你的商家端 JWT'"
    exit 1
  fi
  log_ok "MERCHANT_TOKEN 已设置"

  if [ -z "$CLUB_TOKEN" ]; then
    log_fail "CLUB_TOKEN 未设置"
    echo "  请设置环境变量：export CLUB_TOKEN='你的 C 端用户 JWT'"
    exit 1
  fi
  log_ok "CLUB_TOKEN 已设置"

  # 健康检查
  local resp
  resp=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/" 2>/dev/null || echo "000")
  if [ "$resp" = "000" ]; then
    log_fail "后端服务不可达：${BASE_URL}"
    exit 1
  fi
  log_ok "后端服务可达：${BASE_URL}（HTTP ${resp}）"
}

# ============================================================================
# 步骤 20：商家配置阶段
# ============================================================================
step20_merchant_setup() {
  log_section "步骤 20：商家配置阶段"

  # ── 20.1 创建区域 ──────────────────────────────────────────
  log_step "20.1" "创建区域"
  AREA_RESP=$(curl -s -X POST "${BASE_URL}/profit/scan-ordering/areas" \
    -H "Authorization: Bearer ${MERCHANT_TOKEN}" \
    -H "Content-Type: application/json" \
    -d '{"name":"E2E 测试大厅","sortOrder":1}')
  AREA_ID=$(echo "$AREA_RESP" | jq -r '. // empty')
  if [ -z "$AREA_ID" ] || [ "$AREA_ID" = "null" ]; then
    log_fail "创建区域失败：$AREA_RESP"
    exit 1
  fi
  log_ok "区域已创建：areaId=$AREA_ID"
  pause_if_needed

  # ── 20.2 创建桌台 ──────────────────────────────────────────
  log_step "20.2" "创建桌台"
  TABLE_RESP=$(curl -s -X POST "${BASE_URL}/profit/scan-ordering/tables" \
    -H "Authorization: Bearer ${MERCHANT_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{\"areaId\":${AREA_ID},\"tableCode\":\"E2E-T01\",\"name\":\"E2E 测试桌 1 号\",\"capacity\":4}")
  TABLE_ID=$(echo "$TABLE_RESP" | jq -r '.id // empty')
  if [ -z "$TABLE_ID" ] || [ "$TABLE_ID" = "null" ]; then
    log_fail "创建桌台失败：$TABLE_RESP"
    exit 1
  fi
  log_ok "桌台已创建：tableId=$TABLE_ID"
  pause_if_needed

  # ── 20.3 创建菜单分类 ──────────────────────────────────────
  log_step "20.3" "创建菜单分类"
  CATEGORY_RESP=$(curl -s -X POST "${BASE_URL}/profit/scan-ordering/menu/categories" \
    -H "Authorization: Bearer ${MERCHANT_TOKEN}" \
    -H "Content-Type: application/json" \
    -d '{"name":"E2E 主食","sortOrder":1}')
  CATEGORY_ID=$(echo "$CATEGORY_RESP" | jq -r '.id // empty')
  if [ -z "$CATEGORY_ID" ] || [ "$CATEGORY_ID" = "null" ]; then
    log_fail "创建菜单分类失败：$CATEGORY_RESP"
    exit 1
  fi
  log_ok "菜单分类已创建：categoryId=$CATEGORY_ID"
  pause_if_needed

  # ── 20.4 创建商品（有限库存） ──────────────────────────────
  log_step "20.4" "创建商品（有限库存）"
  PRODUCT_RESP=$(curl -s -X POST "${BASE_URL}/profit/scan-ordering/menu/products" \
    -H "Authorization: Bearer ${MERCHANT_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{\"categoryId\":${CATEGORY_ID},\"name\":\"E2E 招牌牛肉面\",\"basePrice\":28,\"stockMode\":\"limited\",\"stockQuantity\":10}")
  PRODUCT_ID=$(echo "$PRODUCT_RESP" | jq -r '.id // empty')
  if [ -z "$PRODUCT_ID" ] || [ "$PRODUCT_ID" = "null" ]; then
    log_fail "创建商品失败：$PRODUCT_RESP"
    exit 1
  fi
  log_ok "商品已创建：productId=$PRODUCT_ID（有限库存 10）"
  pause_if_needed

  # ── 20.5 创建规格组 ────────────────────────────────────────
  log_step "20.5" "创建规格组"
  SPEC_GROUP_RESP=$(curl -s -X POST "${BASE_URL}/profit/scan-ordering/menu/products/${PRODUCT_ID}/spec-groups" \
    -H "Authorization: Bearer ${MERCHANT_TOKEN}" \
    -H "Content-Type: application/json" \
    -d '{"name":"E2E 辣度","selectionType":"single"}')
  SPEC_GROUP_ID=$(echo "$SPEC_GROUP_RESP" | jq -r '. // empty')
  if [ -z "$SPEC_GROUP_ID" ] || [ "$SPEC_GROUP_ID" = "null" ]; then
    log_fail "创建规格组失败：$SPEC_GROUP_RESP"
    exit 1
  fi
  log_ok "规格组已创建：specGroupId=$SPEC_GROUP_ID"
  pause_if_needed

  # ── 20.6 创建规格项（有限库存） ────────────────────────────
  log_step "20.6" "创建规格项（有限库存）"
  SPEC_OPTION_RESP=$(curl -s -X POST "${BASE_URL}/profit/scan-ordering/menu/spec-groups/${SPEC_GROUP_ID}/options" \
    -H "Authorization: Bearer ${MERCHANT_TOKEN}" \
    -H "Content-Type: application/json" \
    -d '{"name":"加辣","extraPrice":2,"stockQuantity":5}')
  SPEC_OPTION_ID=$(echo "$SPEC_OPTION_RESP" | jq -r '. // empty')
  if [ -z "$SPEC_OPTION_ID" ] || [ "$SPEC_OPTION_ID" = "null" ]; then
    log_fail "创建规格项失败：$SPEC_OPTION_RESP"
    exit 1
  fi
  log_ok "规格项已创建：specOptionId=$SPEC_OPTION_ID（有限库存 5，加价 2 元）"
  pause_if_needed

  # ── 20.7 创建桌台二维码 ────────────────────────────────────
  log_step "20.7" "创建桌台二维码"
  QR_RESP=$(curl -s -X POST "${BASE_URL}/profit/scan-ordering/tables/${TABLE_ID}/qr-codes" \
    -H "Authorization: Bearer ${MERCHANT_TOKEN}" \
    -H "Content-Type: application/json")
  QR_TOKEN=$(echo "$QR_RESP" | jq -r '.token // empty')
  if [ -z "$QR_TOKEN" ] || [ "$QR_TOKEN" = "null" ]; then
    log_fail "创建二维码失败：$QR_RESP"
    exit 1
  fi
  log_ok "二维码已创建：qrToken=${QR_TOKEN:0:20}..."
  pause_if_needed

  # ── 20.8 确认二维码可解析 ──────────────────────────────────
  log_step "20.8" "确认二维码可解析"
  RESOLVE_RESP=$(curl -s -X POST "${BASE_URL}/club/scan-ordering/scan/resolve" \
    -H "Content-Type: application/json" \
    -d "{\"qrToken\":\"${QR_TOKEN}\"}")
  SCAN_TOKEN=$(echo "$RESOLVE_RESP" | jq -r '.scanToken // empty')
  if [ -z "$SCAN_TOKEN" ] || [ "$SCAN_TOKEN" = "null" ]; then
    log_fail "二维码解析失败：$RESOLVE_RESP"
    exit 1
  fi
  log_ok "二维码解析成功：scanToken=${SCAN_TOKEN:0:20}..."
  log_info "门店 ID: $(echo "$RESOLVE_RESP" | jq -r '.store.id')"
  log_info "桌台 ID: $(echo "$RESOLVE_RESP" | jq -r '.table.id')"
  log_info "桌台名称: $(echo "$RESOLVE_RESP" | jq -r '.table.name')"
  pause_if_needed
}

# ============================================================================
# 步骤 21：C 端点餐与支付阶段
# ============================================================================
step21_club_order_and_pay() {
  log_section "步骤 21：C 端点餐与支付阶段"

  # ── 21.1 创建或恢复桌台会话 ────────────────────────────────
  log_step "21.1" "创建或恢复桌台会话"
  SESSION_RESP=$(curl -s -X POST "${BASE_URL}/club/scan-ordering/sessions" \
    -H "Authorization: Bearer ${CLUB_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{\"scanToken\":\"${SCAN_TOKEN}\",\"guestCount\":2}")
  SESSION_ID=$(echo "$SESSION_RESP" | jq -r '.id // empty')
  if [ -z "$SESSION_ID" ] || [ "$SESSION_ID" = "null" ]; then
    log_fail "创建会话失败：$SESSION_RESP"
    exit 1
  fi
  log_ok "会话已创建：sessionId=$SESSION_ID"
  pause_if_needed

  # ── 21.2 获取真实菜单 ──────────────────────────────────────
  log_step "21.2" "获取真实菜单"
  MENU_RESP=$(curl -s -X GET "${BASE_URL}/club/scan-ordering/menu?sessionId=${SESSION_ID}" \
    -H "Authorization: Bearer ${CLUB_TOKEN}")
  local menu_product_count
  menu_product_count=$(echo "$MENU_RESP" | jq '[.[].products[]?] | length')
  log_ok "菜单已获取：分类数=$(echo "$MENU_RESP" | jq 'length')，商品数=$menu_product_count"
  pause_if_needed

  # ── 21.3 添加商品至购物车 ──────────────────────────────────
  log_step "21.3" "添加商品至购物车（无规格）"
  CART_ITEM_RESP=$(curl -s -X POST "${BASE_URL}/club/scan-ordering/cart/items" \
    -H "Authorization: Bearer ${CLUB_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{\"sessionId\":${SESSION_ID},\"productId\":${PRODUCT_ID},\"quantity\":2,\"specOptionIds\":[]}")
  CART_ITEM_ID=$(echo "$CART_ITEM_RESP" | jq -r '.id // empty')
  CART_ITEM_VERSION=$(echo "$CART_ITEM_RESP" | jq -r '.version // empty')
  if [ -z "$CART_ITEM_ID" ] || [ "$CART_ITEM_ID" = "null" ]; then
    log_fail "添加购物车失败：$CART_ITEM_RESP"
    exit 1
  fi
  log_ok "购物车商品已添加：cartItemId=$CART_ITEM_ID, version=$CART_ITEM_VERSION"
  pause_if_needed

  # ── 21.4 添加带规格商品 ────────────────────────────────────
  log_step "21.4" "添加带规格商品"
  CART_ITEM2_RESP=$(curl -s -X POST "${BASE_URL}/club/scan-ordering/cart/items" \
    -H "Authorization: Bearer ${CLUB_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{\"sessionId\":${SESSION_ID},\"productId\":${PRODUCT_ID},\"quantity\":1,\"specOptionIds\":[${SPEC_OPTION_ID}]}")
  CART_ITEM2_ID=$(echo "$CART_ITEM2_RESP" | jq -r '.id // empty')
  CART_ITEM2_VERSION=$(echo "$CART_ITEM2_RESP" | jq -r '.version // empty')
  if [ -z "$CART_ITEM2_ID" ] || [ "$CART_ITEM2_ID" = "null" ]; then
    log_fail "添加规格商品失败：$CART_ITEM2_RESP"
    exit 1
  fi
  log_ok "规格商品已添加：cartItemId=$CART_ITEM2_ID, version=$CART_ITEM2_VERSION"
  pause_if_needed

  # ── 21.5 修改购物车数量 ────────────────────────────────────
  log_step "21.5" "修改购物车数量"
  curl -s -X PATCH "${BASE_URL}/club/scan-ordering/cart/items/${CART_ITEM_ID}" \
    -H "Authorization: Bearer ${CLUB_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{\"quantity\":3,\"version\":${CART_ITEM_VERSION}}" >/dev/null
  log_ok "购物车数量已修改：itemId=$CART_ITEM_ID, quantity=3"
  pause_if_needed

  # ── 21.6 获取购物车 ────────────────────────────────────────
  log_step "21.6" "获取购物车"
  CART_RESP=$(curl -s -X GET "${BASE_URL}/club/scan-ordering/cart?sessionId=${SESSION_ID}" \
    -H "Authorization: Bearer ${CLUB_TOKEN}")
  CART_VERSION=$(echo "$CART_RESP" | jq -r '.version // empty')
  local cart_item_count
  cart_item_count=$(echo "$CART_RESP" | jq '.items | length')
  log_ok "购物车已获取：version=$CART_VERSION, items=$cart_item_count"
  pause_if_needed

  # ── 21.7 获取订单预览 ──────────────────────────────────────
  log_step "21.7" "获取订单预览"
  PREVIEW_RESP=$(curl -s -X POST "${BASE_URL}/club/scan-ordering/orders/preview" \
    -H "Authorization: Bearer ${CLUB_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{\"sessionId\":${SESSION_ID},\"cartVersion\":${CART_VERSION},\"guestCount\":2}")
  PRICING_VERSION=$(echo "$PREVIEW_RESP" | jq -r '.pricingVersion // empty')
  PAYABLE_AMOUNT=$(echo "$PREVIEW_RESP" | jq -r '.payableAmount // empty')
  if [ -z "$PRICING_VERSION" ] || [ "$PRICING_VERSION" = "null" ]; then
    log_fail "订单预览失败：$PREVIEW_RESP"
    exit 1
  fi
  log_ok "订单预览成功"
  log_info "pricingVersion: $PRICING_VERSION"
  log_info "payableAmount（分）: $PAYABLE_AMOUNT"
  log_info "itemOriginalAmount: $(echo "$PREVIEW_RESP" | jq -r '.itemOriginalAmount')"
  log_info "specificationExtraAmount: $(echo "$PREVIEW_RESP" | jq -r '.specificationExtraAmount')"
  pause_if_needed

  # ── 21.8 幂等创建订单（使用固定 Idempotency-Key） ──────────
  log_step "21.8" "幂等创建订单"
  local idempotency_key
  idempotency_key="e2e-test-$(date +%s)"
  ORDER_RESP=$(curl -s -X POST "${BASE_URL}/club/scan-ordering/orders" \
    -H "Authorization: Bearer ${CLUB_TOKEN}" \
    -H "Content-Type: application/json" \
    -H "Idempotency-Key: ${idempotency_key}" \
    -d "{\"sessionId\":${SESSION_ID},\"cartVersion\":${CART_VERSION},\"guestCount\":2,\"pricingVersion\":\"${PRICING_VERSION}\"}")
  ORDER_ID=$(echo "$ORDER_RESP" | jq -r '.id // empty')
  ORDER_VERSION=$(echo "$ORDER_RESP" | jq -r '.version // empty')
  if [ -z "$ORDER_ID" ] || [ "$ORDER_ID" = "null" ]; then
    log_fail "创建订单失败：$ORDER_RESP"
    exit 1
  fi
  log_ok "订单已创建：orderId=$ORDER_ID, version=$ORDER_VERSION"
  log_info "orderNo: $(echo "$ORDER_RESP" | jq -r '.orderNo')"
  log_info "status: $(echo "$ORDER_RESP" | jq -r '.status')"
  log_info "paymentStatus: $(echo "$ORDER_RESP" | jq -r '.paymentStatus')"
  pause_if_needed

  # ── 21.9 重复提交验证幂等 ──────────────────────────────────
  log_step "21.9" "重复提交验证幂等（相同 Idempotency-Key）"
  ORDER2_RESP=$(curl -s -X POST "${BASE_URL}/club/scan-ordering/orders" \
    -H "Authorization: Bearer ${CLUB_TOKEN}" \
    -H "Content-Type: application/json" \
    -H "Idempotency-Key: ${idempotency_key}" \
    -d "{\"sessionId\":${SESSION_ID},\"cartVersion\":${CART_VERSION},\"guestCount\":2,\"pricingVersion\":\"${PRICING_VERSION}\"}")
  ORDER2_ID=$(echo "$ORDER2_RESP" | jq -r '.id // empty')
  if [ "$ORDER2_ID" = "$ORDER_ID" ]; then
    log_ok "幂等验证通过：返回同一订单 ID=$ORDER2_ID"
  else
    log_fail "幂等验证失败：第一次=$ORDER_ID，第二次=$ORDER2_ID"
  fi
  pause_if_needed

  # ── 21.10 发起支付（开发环境确认支付） ─────────────────────
  log_step "21.10" "发起支付（开发环境确认支付）"
  PAY_RESP=$(curl -s -X POST "${BASE_URL}/club/scan-ordering/orders/${ORDER_ID}/confirm-paid" \
    -H "Authorization: Bearer ${CLUB_TOKEN}" \
    -H "Content-Type: application/json")
  local pay_status
  pay_status=$(echo "$PAY_RESP" | jq -r '.status // empty')
  if [ "$pay_status" = "pending_acceptance" ]; then
    log_ok "支付确认成功：status=$pay_status"
  else
    log_fail "支付确认失败：$PAY_RESP"
  fi
  pause_if_needed

  # ── 21.11 验证订单状态 ─────────────────────────────────────
  log_step "21.11" "验证订单状态"
  ORDER_DETAIL=$(curl -s -X GET "${BASE_URL}/club/scan-ordering/orders/${ORDER_ID}" \
    -H "Authorization: Bearer ${CLUB_TOKEN}")
  local order_status
  order_status=$(echo "$ORDER_DETAIL" | jq -r '.status')
  local payment_status
  payment_status=$(echo "$ORDER_DETAIL" | jq -r '.paymentStatus')
  if [ "$order_status" = "pending_acceptance" ] && [ "$payment_status" = "paid" ]; then
    log_ok "订单状态正确：status=$order_status, paymentStatus=$payment_status"
  else
    log_fail "订单状态异常：status=$order_status, paymentStatus=$payment_status"
  fi
  ORDER_VERSION=$(echo "$ORDER_DETAIL" | jq -r '.version')
  pause_if_needed
}

# ============================================================================
# 步骤 22：商家处理与 C 端实时追踪
# ============================================================================
step22_merchant_process() {
  log_section "步骤 22：商家处理与 C 端实时追踪"

  # ── 22.1 商家获取订单列表 ──────────────────────────────────
  log_step "22.1" "商家获取订单列表"
  MERCHANT_ORDERS=$(curl -s -X GET "${BASE_URL}/profit/scan-ordering/orders" \
    -H "Authorization: Bearer ${MERCHANT_TOKEN}")
  local order_count
  order_count=$(echo "$MERCHANT_ORDERS" | jq '.items | length')
  log_ok "商家订单列表已获取：$order_count 笔订单"
  pause_if_needed

  # ── 22.2 商家接单 ──────────────────────────────────────────
  log_step "22.2" "商家接单"
  curl -s -X POST "${BASE_URL}/profit/scan-ordering/orders/${ORDER_ID}/accept" \
    -H "Authorization: Bearer ${MERCHANT_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{\"version\":${ORDER_VERSION}}" >/dev/null
  log_ok "订单已接单"
  pause_if_needed

  # ── 22.3 C 端验证状态变为 preparing ─────────────────────────
  log_step "22.3" "C 端验证状态变为 preparing"
  ORDER_DETAIL=$(curl -s -X GET "${BASE_URL}/club/scan-ordering/orders/${ORDER_ID}" \
    -H "Authorization: Bearer ${CLUB_TOKEN}")
  local status
  status=$(echo "$ORDER_DETAIL" | jq -r '.status')
  if [ "$status" = "preparing" ]; then
    log_ok "C 端订单状态正确：preparing"
  else
    log_fail "C 端订单状态异常：$status（期望 preparing）"
  fi
  ORDER_VERSION=$(echo "$ORDER_DETAIL" | jq -r '.version')
  pause_if_needed

  # ── 22.4 商家出餐 ──────────────────────────────────────────
  log_step "22.4" "商家出餐"
  curl -s -X POST "${BASE_URL}/profit/scan-ordering/orders/${ORDER_ID}/serve" \
    -H "Authorization: Bearer ${MERCHANT_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{\"version\":${ORDER_VERSION}}" >/dev/null
  log_ok "订单已出餐"
  pause_if_needed

  # ── 22.5 C 端验证状态变为 served ───────────────────────────
  log_step "22.5" "C 端验证状态变为 served"
  ORDER_DETAIL=$(curl -s -X GET "${BASE_URL}/club/scan-ordering/orders/${ORDER_ID}" \
    -H "Authorization: Bearer ${CLUB_TOKEN}")
  status=$(echo "$ORDER_DETAIL" | jq -r '.status')
  if [ "$status" = "served" ]; then
    log_ok "C 端订单状态正确：served"
  else
    log_fail "C 端订单状态异常：$status（期望 served）"
  fi
  ORDER_VERSION=$(echo "$ORDER_DETAIL" | jq -r '.version')
  pause_if_needed

  # ── 22.6 商家完成订单 ──────────────────────────────────────
  log_step "22.6" "商家完成订单"
  curl -s -X POST "${BASE_URL}/profit/scan-ordering/orders/${ORDER_ID}/complete" \
    -H "Authorization: Bearer ${MERCHANT_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{\"version\":${ORDER_VERSION}}" >/dev/null
  log_ok "订单已完成"
  pause_if_needed

  # ── 22.7 C 端验证最终状态 completed ────────────────────────
  log_step "22.7" "C 端验证最终状态 completed"
  ORDER_DETAIL=$(curl -s -X GET "${BASE_URL}/club/scan-ordering/orders/${ORDER_ID}" \
    -H "Authorization: Bearer ${CLUB_TOKEN}")
  status=$(echo "$ORDER_DETAIL" | jq -r '.status')
  if [ "$status" = "completed" ]; then
    log_ok "C 端订单最终状态正确：completed"
  else
    log_fail "C 端订单最终状态异常：$status（期望 completed）"
  fi
  pause_if_needed
}

# ============================================================================
# 步骤 23：服务呼叫联调
# ============================================================================
step23_service_calls() {
  log_section "步骤 23：服务呼叫联调"

  # ── 23.1 C 端创建服务呼叫 ──────────────────────────────────
  log_step "23.1" "C 端创建服务呼叫"
  CALL_RESP=$(curl -s -X POST "${BASE_URL}/club/scan-ordering/service-calls" \
    -H "Authorization: Bearer ${CLUB_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{\"sessionId\":${SESSION_ID},\"type\":\"water\",\"remark\":\"E2E 测试呼叫加水\"}")
  SERVICE_CALL_ID=$(echo "$CALL_RESP" | jq -r '.id // empty')
  if [ -z "$SERVICE_CALL_ID" ] || [ "$SERVICE_CALL_ID" = "null" ]; then
    log_fail "创建服务呼叫失败：$CALL_RESP"
    exit 1
  fi
  log_ok "服务呼叫已创建：serviceCallId=$SERVICE_CALL_ID"
  pause_if_needed

  # ── 23.2 商家查询服务呼叫待办 ──────────────────────────────
  log_step "23.2" "商家查询服务呼叫待办"
  CALLS_RESP=$(curl -s -X GET "${BASE_URL}/profit/scan-ordering/service-calls?status=pending" \
    -H "Authorization: Bearer ${MERCHANT_TOKEN}")
  local call_count
  call_count=$(echo "$CALLS_RESP" | jq 'length')
  log_ok "商家服务呼叫待办：$call_count 条"
  pause_if_needed

  # ── 23.3 商家确认响应 ──────────────────────────────────────
  log_step "23.3" "商家确认响应服务呼叫"
  curl -s -X POST "${BASE_URL}/profit/scan-ordering/service-calls/${SERVICE_CALL_ID}/process" \
    -H "Authorization: Bearer ${MERCHANT_TOKEN}" \
    -H "Content-Type: application/json" \
    -d '{"status":"acknowledged","remark":"马上来"}' >/dev/null
  log_ok "服务呼叫已确认响应"
  pause_if_needed

  # ── 23.4 商家完成服务呼叫 ──────────────────────────────────
  log_step "23.4" "商家完成服务呼叫"
  curl -s -X POST "${BASE_URL}/profit/scan-ordering/service-calls/${SERVICE_CALL_ID}/process" \
    -H "Authorization: Bearer ${MERCHANT_TOKEN}" \
    -H "Content-Type: application/json" \
    -d '{"status":"resolved","remark":"已完成"}' >/dev/null
  log_ok "服务呼叫已完成"
  pause_if_needed

  # ── 23.5 验证已完成呼叫不能重复处理 ────────────────────────
  log_step "23.5" "验证已完成呼叫不能重复处理"
  local repeat_resp
  repeat_resp=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BASE_URL}/profit/scan-ordering/service-calls/${SERVICE_CALL_ID}/process" \
    -H "Authorization: Bearer ${MERCHANT_TOKEN}" \
    -H "Content-Type: application/json" \
    -d '{"status":"resolved","remark":"重复处理"}')
  if [ "$repeat_resp" = "409" ] || [ "$repeat_resp" = "400" ]; then
    log_ok "已完成呼叫被正确拒绝：HTTP $repeat_resp"
  else
    log_fail "已完成呼叫未被拒绝：HTTP $repeat_resp（期望 409 或 400）"
  fi
  pause_if_needed
}

# ============================================================================
# 步骤 24：超时、取消与库存补偿联调
# ============================================================================
step24_timeout_cancel() {
  log_section "步骤 24：超时、取消与库存补偿联调"

  # ── 24.1 用户取消未支付订单 ────────────────────────────────
  log_step "24.1" "创建未支付订单并用户取消"
  # 先添加购物车商品
  curl -s -X POST "${BASE_URL}/club/scan-ordering/cart/items" \
    -H "Authorization: Bearer ${CLUB_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{\"sessionId\":${SESSION_ID},\"productId\":${PRODUCT_ID},\"quantity\":1,\"specOptionIds\":[]}" >/dev/null

  # 获取购物车版本
  local cart_resp
  cart_resp=$(curl -s -X GET "${BASE_URL}/club/scan-ordering/cart?sessionId=${SESSION_ID}" \
    -H "Authorization: Bearer ${CLUB_TOKEN}")
  local cart_ver
  cart_ver=$(echo "$cart_resp" | jq -r '.version')

  # 预览
  local preview_resp
  preview_resp=$(curl -s -X POST "${BASE_URL}/club/scan-ordering/orders/preview" \
    -H "Authorization: Bearer ${CLUB_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{\"sessionId\":${SESSION_ID},\"cartVersion\":${cart_ver},\"guestCount\":2}")
  local pricing_ver
  pricing_ver=$(echo "$preview_resp" | jq -r '.pricingVersion')

  # 创建订单
  local cancel_order_resp
  cancel_order_resp=$(curl -s -X POST "${BASE_URL}/club/scan-ordering/orders" \
    -H "Authorization: Bearer ${CLUB_TOKEN}" \
    -H "Content-Type: application/json" \
    -H "Idempotency-Key: e2e-cancel-$(date +%s)" \
    -d "{\"sessionId\":${SESSION_ID},\"cartVersion\":${cart_ver},\"guestCount\":2,\"pricingVersion\":\"${pricing_ver}\"}")
  CANCEL_ORDER_ID=$(echo "$cancel_order_resp" | jq -r '.id')
  local cancel_order_version
  cancel_order_version=$(echo "$cancel_order_resp" | jq -r '.version')
  log_ok "未支付订单已创建：orderId=$CANCEL_ORDER_ID, version=$cancel_order_version"
  pause_if_needed

  # ── 24.2 用户取消订单 ──────────────────────────────────────
  log_step "24.2" "用户取消订单"
  curl -s -X POST "${BASE_URL}/club/scan-ordering/orders/${CANCEL_ORDER_ID}/cancel" \
    -H "Authorization: Bearer ${CLUB_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{\"version\":${cancel_order_version}}" >/dev/null
  log_ok "订单已取消"
  pause_if_needed

  # ── 24.3 验证取消后状态 ────────────────────────────────────
  log_step "24.3" "验证取消后订单状态"
  local cancelled_detail
  cancelled_detail=$(curl -s -X GET "${BASE_URL}/club/scan-ordering/orders/${CANCEL_ORDER_ID}" \
    -H "Authorization: Bearer ${CLUB_TOKEN}")
  local cancelled_status
  cancelled_status=$(echo "$cancelled_detail" | jq -r '.status')
  if [ "$cancelled_status" = "cancelled" ]; then
    log_ok "订单状态正确：cancelled"
  else
    log_fail "订单状态异常：$cancelled_status（期望 cancelled）"
  fi
  pause_if_needed

  # ── 24.4 验证重复取消不重复恢复库存 ────────────────────────
  log_step "24.4" "验证重复取消被拒绝"
  local repeat_cancel_code
  repeat_cancel_code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BASE_URL}/club/scan-ordering/orders/${CANCEL_ORDER_ID}/cancel" \
    -H "Authorization: Bearer ${CLUB_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{\"version\":${cancel_order_version}}")
  if [ "$repeat_cancel_code" = "409" ] || [ "$repeat_cancel_code" = "400" ]; then
    log_ok "重复取消被正确拒绝：HTTP $repeat_cancel_code"
  else
    log_fail "重复取消未被拒绝：HTTP $repeat_cancel_code"
  fi
  pause_if_needed

  # ── 24.5 验证商品库存已恢复 ────────────────────────────────
  log_step "24.5" "验证商品库存已恢复"
  local merchant_menu
  merchant_menu=$(curl -s -X GET "${BASE_URL}/profit/scan-ordering/menu" \
    -H "Authorization: Bearer ${MERCHANT_TOKEN}")
  local remaining_stock
  remaining_stock=$(echo "$merchant_menu" | jq -r "[.[].products[]? | select(.id == ${PRODUCT_ID}) | .stockQuantity] | .[0] // \"未找到\"")
  log_info "商品当前库存：$remaining_stock（初始 10）"
  log_ok "库存恢复验证完成（需人工核对数值是否正确）"
  pause_if_needed

  # ── 24.6 验证支付超时关闭（需手动触发） ────────────────────
  log_step "24.6" "支付超时关闭（需手动触发扫描或调整 paymentExpiresAt）"
  log_info "此场景需要："
  log_info "  1. 创建一笔未支付订单"
  log_info "  2. 将 paymentExpiresAt 调整为过去时间（SQL）"
  log_info "  3. 手动触发扫描服务或等待自动扫描"
  log_info "  4. 验证订单变为 cancelled，库存恢复，支付尝试关闭"
  log_info "  5. 重复扫描不会再次恢复库存"
  pause_if_needed

  # ── 24.7 验证回调竞态（需手动模拟） ────────────────────────
  log_step "24.7" "回调竞态验证（需手动模拟）"
  log_info "此场景需要："
  log_info "  1. 创建并超时关闭订单"
  log_info "  2. 模拟微信支付成功回调"
  log_info "  3. 验证订单不恢复为 paid"
  log_info "  4. 验证不重新扣库存"
  log_info "  5. 验证存在高优先级异常日志"
  log_info "  6. 验证存在退款或人工处置入口"
  log_info "  7. 验证不向商家端发送错误的待接单事件"
  pause_if_needed
}

# ============================================================================
# 清理
# ============================================================================
cleanup() {
  log_section "联调总结"
  echo -e "  ${GREEN}创建的资源 ID 汇总：${NC}"
  echo "  区域 ID:        $AREA_ID"
  echo "  桌台 ID:        $TABLE_ID"
  echo "  菜单分类 ID:    $CATEGORY_ID"
  echo "  商品 ID:        $PRODUCT_ID"
  echo "  规格组 ID:      $SPEC_GROUP_ID"
  echo "  规格项 ID:      $SPEC_OPTION_ID"
  echo "  会话 ID:        $SESSION_ID"
  echo "  订单 ID:        $ORDER_ID"
  echo "  取消订单 ID:    $CANCEL_ORDER_ID"
  echo "  服务呼叫 ID:    $SERVICE_CALL_ID"
  echo ""
  echo -e "  ${YELLOW}注意：以上测试数据需手动清理或保留供后续联调使用。${NC}"
  echo -e "  ${YELLOW}步骤 24.6-24.7 需要手动操作数据库和模拟微信回调。${NC}"
}

# ============================================================================
# 主流程
# ============================================================================
main() {
  echo ""
  echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${BLUE}║        扫码点餐端到端手工联调脚本                           ║${NC}"
  echo -e "${BLUE}║        覆盖步骤 20-24                                       ║${NC}"
  echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"

  check_prerequisites

  step20_merchant_setup
  step21_club_order_and_pay
  step22_merchant_process
  step23_service_calls
  step24_timeout_cancel

  cleanup

  echo ""
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${GREEN}  全部自动化步骤已完成！请检查上方结果。${NC}"
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

main "$@"

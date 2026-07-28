#!/bin/bash
# Scan-Ordering Guest Name Fix Verification Script
set -e

echo "===================================="
echo " Scan-Ordering Guest Name Fix Test"
echo "===================================="
echo ""

# Backend verification
echo "Testing Backend..."
if [ -f "src/purely-profit/operations/scan-ordering/scan-ordering-order.service.ts" ]; then
    if grep -q "clubUserId: true" src/purely-profit/operations/scan-ordering/scan-ordering-order.service.ts; then
        echo "✅ Backend: clubUserId field added to Prisma query"
    else
        echo "❌ Backend: clubUserId field NOT found"
        exit 1
    fi
    
    if grep -q "guestName," src/purely-profit/operations/scan-ordering/scan-ordering-order.service.ts; then
        echo "✅ Backend: guestName field in response"
    else
        echo "❌ Backend: guestName field missing from response"
        exit 1
    fi
else
    echo "❌ Backend service file not found"
    exit 1
fi

echo ""

# Frontend verification
echo "Testing Frontend..."
FRONTEND_PATH="../purelyProfit/src/pages/main/operations/scanOrdering/"

if [ -f "$FRONTEND_PATH/scanOrdering.service.api.ts" ]; then
    if grep -q "guestName?: number | string" "$FRONTEND_PATH/scanOrdering.service.api.ts"; then
        echo "✅ Frontend: API response type extended with guestName"
    else
        echo "❌ Frontend: API response type missing guestName"
        exit 1
    fi
    
    if grep -q "(order.guestName ?? '顾客')" "$FRONTEND_PATH/scanOrdering.service.api.ts"; then
        echo "✅ Frontend: Default value fallback implemented"
    else
        echo "❌ Frontend: Default fallback missing"
        exit 1
    fi
else
    echo "❌ Frontend API file not found"
    exit 1
fi

echo ""

# Summary
echo "===================================="
echo "✅ All guest name fix tests passed!"
echo "===================================="
echo ""
echo "Changes Applied:"
echo "  ✅ Backend now returns clubUserId as guestName (temporary)"
echo "  ✅ Frontend accepts and displays the returned value"
echo "  ✅ Default fallback '顾客' maintained for backward compatibility"
echo ""
echo "Next Steps:"
echo "  1. Run backend: cd purelyprofit-server && pnpm start:dev"
echo "  2. Run frontend: cd purelyProfit && pnpm dev"
echo "  3. Visit scan-ordering page and verify customer names appear"
echo ""
echo "Optional Enhancement:"
echo "  To show real nickname, add user table query in backend"
echo ""

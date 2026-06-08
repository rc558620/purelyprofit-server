#!/bin/bash
cd /Users/f0rest/Documents/project/react/purelyprofit-server

# 使用 pnpm test 中的脚本来获取 token
TOKEN=$(pnpm exec node -e "
const jwt = require('jsonwebtoken');
const token = jwt.sign(
  { sub: '13619654022', memberships: [{ storeId: 18, subjectType: 'OWNER' }] },
  'purely-profit-dev-secret-key'
);
console.log(token);
" 2>/dev/null)

echo "Generated Token: $TOKEN"

# 调用利润报表接口
echo -e "\n=== Calling /api/profit-detail/report ==="
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/profit-detail/report?storeId=18&period=month" \
  | jq '.data.products[] | {name, amount}' | head -100

echo -e "\n\n=== All products ==="
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/profit-detail/report?storeId=18&period=month" \
  | jq '.data.products | length'

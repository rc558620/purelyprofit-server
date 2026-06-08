#!/bin/bash
# 这里 generate-token.js 在当前目录，但它需要 jsonwebtoken
# 所以使用 pnpm 来运行它
TOKEN=$(pnpm exec node -e "const jwt = require('jsonwebtoken'); process.stdout.write(jwt.sign({ sub: '13619654022', memberships: [{ storeId: 18, subjectType: 'OWNER' }] }, 'purely-profit-dev-secret-key'))" 2>/dev/null)

echo "Token generated: ${#TOKEN} chars"

if [ -z "$TOKEN" ]; then
  echo "Failed to generate token"
  exit 1
fi

echo "Calling /api/profit-detail/report..."
curl -s -H "Authorization: Bearer $TOKEN" "http://localhost:3000/api/profit-detail/report?storeId=18&period=month" | head -800

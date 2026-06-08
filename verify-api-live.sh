#!/bin/bash
cd /Users/f0rest/Documents/project/react/purelyprofit-server

# Check if server is running on port 3000
if ! curl -s http://localhost:3000/api/ > /dev/null 2>&1; then
  echo "Server not running on port 3000"
  exit 1
fi

echo "✓ Server is running on port 3000"
echo ""

# Get a token using node with loaded dependencies from dist
echo "Generating JWT token..."
# Try to use require from the running dist
TOKEN=$(node --input-type=module --eval "
import jwt from 'jsonwebtoken';
const token = jwt.sign(
  { sub: '13619654022', memberships: [{ storeId: 18, subjectType: 'OWNER' }] },
  'purely-profit-dev-secret-key'
);
console.log(token);
" 2>/dev/null)

if [ -z "$TOKEN" ]; then
  # Fallback: try to manually create a JWT-like token (base64)
  # JWT format: header.payload.signature
  HEADER=$(echo -n '{"alg":"HS256","typ":"JWT"}' | base64 -w 0 | tr '+/' '-_' | tr -d '=')
  PAYLOAD=$(echo -n '{"sub":"13619654022","memberships":[{"storeId":18,"subjectType":"OWNER"}]}' | base64 -w 0 | tr '+/' '-_' | tr -d '=')
  # For testing, we'll skip signature verification (signing doesn't matter for test)
  TOKEN="$HEADER.$PAYLOAD.test"
  echo "Using fallback token: $TOKEN"
fi

echo "Token: ${TOKEN:0:50}..."
echo ""

# Call the API
echo "Calling /api/profit-detail/report..."
RESPONSE=$(curl -s -w "\n%{http_code}" -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/profit-detail/report?storeId=18&period=month")

# Extract status code from last line
HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)
BODY=$(echo "$RESPONSE" | head -n -1)

echo "HTTP Status: $HTTP_CODE"
echo ""

if [ "$HTTP_CODE" = "200" ]; then
  echo "✓ API returned 200 OK"
  echo ""
  echo "=== Response Preview (first 100 lines) ==="
  echo "$BODY" | head -100
else
  echo "✗ API returned $HTTP_CODE"
  echo "Response:"
  echo "$BODY"
fi

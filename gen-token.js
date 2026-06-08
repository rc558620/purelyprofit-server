const jwt = require('jsonwebtoken');
const token = jwt.sign(
  { sub: '13619654022', memberships: [{ storeId: 18, subjectType: 'OWNER' }] },
  'purely-profit-dev-secret-key'
);
console.log(token);

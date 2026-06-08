const jwt = require('jsonwebtoken');
const http = require('http');

// 生成 JWT token
const token = jwt.sign(
  {
    sub: '13619654022',
    memberships: [
      {
        storeId: 18,
        subjectType: 'OWNER'
      }
    ]
  },
  'purely-profit-dev-secret-key'
);

console.log('Token:', token);

// 调用利润报表接口
const url = 'http://localhost:3000/api/profit-detail/report?storeId=18&period=month';
const options = {
  headers: {
    'Authorization': `Bearer ${token}`
  }
};

http.get(url, options, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    const parsed = JSON.parse(data);
    console.log('Response:', JSON.stringify(parsed, null, 2));
    
    // 检查产品列表中是否包含空间名称
    if (parsed.data && parsed.data.products) {
      console.log('\n=== Products List ===');
      parsed.data.products.forEach((product, i) => {
        console.log(`${i + 1}. ${product.name} - Amount: ${product.amount}`);
      });
    }
  });
}).on('error', (e) => {
  console.error('Error:', e);
});

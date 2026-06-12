import * as crypto from 'crypto';
import * as http from 'http';

// 使用内置 crypto 生成 JWT（无需安装 jsonwebtoken）
function generateJwt(payload: Record<string, unknown>, secret: string): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const b64 = (obj: object) =>
    Buffer.from(JSON.stringify(obj)).toString('base64url');
  const signingInput = `${b64(header)}.${b64(payload)}`;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(signingInput)
    .digest('base64url');
  return `${signingInput}.${signature}`;
}

const token = generateJwt(
  {
    sub: '13619654022',
    memberships: [
      {
        storeId: 18,
        subjectType: 'OWNER',
      },
    ],
  },
  'purely-profit-dev-secret-key',
);

console.log('Token:', token);

// 调用利润报表接口
const url =
  'http://localhost:3000/api/profit-detail/report?storeId=18&period=month';
const options = {
  headers: {
    Authorization: `Bearer ${token}`,
  },
};

http
  .get(url, options, (res) => {
    let data = '';
    res.on('data', (chunk) => {
      data += chunk;
    });
    res.on('end', () => {
      const parsed = JSON.parse(data);
      console.log('Response:', JSON.stringify(parsed, null, 2));

      // 检查产品列表中是否包含空间名称
      if (parsed.data && parsed.data.products) {
        console.log('\n=== Products List ===');
        parsed.data.products.forEach((product: any, i: number) => {
          console.log(`${i + 1}. ${product.name} - Amount: ${product.amount}`);
        });
      }
    });
  })
  .on('error', (e: any) => {
    console.error('Error:', e);
  });

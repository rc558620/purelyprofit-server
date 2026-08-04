// 为账号 13619654040 (userId=61, staffId=1, storeId=37) 生成合法 JWT token
import { createHmac } from 'node:crypto';
import 'dotenv/config';
import Redis from 'ioredis';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

const jwtSecret = process.env.JWT_SECRET?.trim();
if (!jwtSecret) throw new Error('缺少 JWT_SECRET');

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });
const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: Number.parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD || undefined,
  db: Number.parseInt(process.env.REDIS_DB || '0', 10),
  maxRetriesPerRequest: 2,
});

const toBase64Url = (v) => Buffer.from(v).toString('base64url');

function signJwt(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const signingInput = `${toBase64Url(JSON.stringify(header))}.${toBase64Url(JSON.stringify(payload))}`;
  const signature = createHmac('sha256', secret)
    .update(signingInput)
    .digest('base64url');
  return `${signingInput}.${signature}`;
}

async function main() {
  const staff = await prisma.staff.findFirst({
    where: { phone: '13619654040' },
    select: { id: true, userId: true, storeId: true, status: true, isActive: true, isSeatActive: true },
  });
  if (!staff) throw new Error('未找到 staff');
  console.log('staff:', JSON.stringify(staff));

  const key = `auth:token-version:${staff.userId}`;
  const raw = await redis.get(key);
  const sessionVersion = Number.parseInt(raw || '0', 10);
  console.log(`token version key=${key} value=${raw} -> ${sessionVersion}`);

  const payload = {
    sub: staff.userId,
    phone: '13619654040',
    accountScope: 'purely_profit',
    sessionVersion,
    staffId: staff.id,
    aud: 'purely_profit',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
  };
  const token = signJwt(payload, jwtSecret);
  console.log(`TOKEN=${token}`);
}

main()
  .catch((e) => {
    console.error('错误:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
    redis.disconnect();
  });

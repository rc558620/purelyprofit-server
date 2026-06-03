/**
 * 快速初始化 Owner 账号 + 门店数据
 * 用法：node scripts/seed-owner.mjs
 *
 * 默认参数（可按需修改）：
 *   手机号：13619654020
 *   密码：  Aa123456
 *   姓名：  老板
 *   门店名：测试门店
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import bcrypt from 'bcryptjs';

// 手动加载 .env（pnpm 项目 dotenv 不在顶层 node_modules）
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '../.env');
try {
  const envContent = readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
} catch { /* .env 不存在时忽略 */ }

const { Pool } = pg;

const PHONE = '13619654020';
const PASSWORD = 'jeffrey';
const NAME = '老板';
const STORE_NAME = '测试门店';
const STORE_ADDRESS = '测试地址';

const LOCAL_LOGIN_DOMAIN = 'purelyprofit.local';

function buildEmail(phone) {
  return `phone_${phone}@${LOCAL_LOGIN_DOMAIN}`;
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const email = buildEmail(PHONE);

  // 1. 检查是否已存在
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`⚠️  账号已存在（email: ${email}），跳过创建。`);
    return;
  }

  // 2. 创建用户
  const hashedPassword = await bcrypt.hash(PASSWORD, 10);
  const user = await prisma.user.create({
    data: { email, password: hashedPassword, name: NAME },
    select: { id: true, email: true },
  });
  console.log(`✅ 用户已创建 id=${user.id} email=${user.email}`);

  // 3. 创建门店 + staff(OWNER) + subscription（事务）
  const store = await prisma.$transaction(async (tx) => {
    const createdStore = await tx.store.create({
      data: { name: STORE_NAME, address: STORE_ADDRESS, ownerId: user.id, maxAccountSeats: 1 },
      select: { id: true, name: true },
    });

    await tx.storeSubscription.create({
      data: {
        storeId: createdStore.id,
        planCode: 'STARTER',
        planName: '入门版',
        status: 'ACTIVE',
        maxAccountSeats: 1,
        expiresAt: null,
      },
    });

    await tx.store.update({
      where: { id: createdStore.id },
      data: { maxAccountSeats: 1 },
    });

    await tx.staff.create({
      data: {
        storeId: createdStore.id,
        userId: user.id,
        email: user.email,
        name: NAME,
        role: 'OWNER',
        permissions: ['*'],
        status: 'ACTIVE',
        isSeatActive: true,
      },
    });

    return createdStore;
  });
  console.log(`✅ 门店已创建 id=${store.id} name=${store.name}`);

  console.log('');
  console.log('==============================');
  console.log(' 账号信息');
  console.log('==============================');
  console.log(` 手机号：${PHONE}`);
  console.log(` 密  码：${PASSWORD}`);
  console.log(` 姓  名：${NAME}`);
  console.log(` 门  店：${STORE_NAME}`);
  console.log('==============================');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());

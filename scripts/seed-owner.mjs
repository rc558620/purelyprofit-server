/**
 * 幂等准备发布 smoke 所需的 purely-profit / purely-club 账号、门店与访问关系。
 * 用法：node scripts/seed-owner.mjs
 *
 * 可选环境变量：
 *   SMOKE_LOGIN_PHONE
 *   SMOKE_LOGIN_PASSWORD
 *   SMOKE_LOGIN_NAME
 *   SMOKE_STORE_NAME
 *   SMOKE_STORE_ADDRESS
 *   SMOKE_STORE_CONTACT_NAME
 *   SMOKE_STORE_CONTACT_PHONE
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import bcrypt from 'bcryptjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '../.env');
loadEnvFile(envPath);

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  throw new Error('缺少 DATABASE_URL，无法准备 smoke 数据');
}

const PHONE = process.env.SMOKE_LOGIN_PHONE?.trim() || '13619654020';
const PASSWORD = process.env.SMOKE_LOGIN_PASSWORD?.trim() || 'jeffrey';
const NAME = process.env.SMOKE_LOGIN_NAME?.trim() || '老板';
const STORE_NAME = process.env.SMOKE_STORE_NAME?.trim() || '测试门店';
const STORE_ADDRESS = process.env.SMOKE_STORE_ADDRESS?.trim() || '测试地址';
const STORE_CONTACT_NAME = process.env.SMOKE_STORE_CONTACT_NAME?.trim() || NAME;
const STORE_CONTACT_PHONE = process.env.SMOKE_STORE_CONTACT_PHONE?.trim() || PHONE;
const LOCAL_LOGIN_DOMAIN = 'purelyprofit.local';
const DEFAULT_SUBSCRIPTION_PLAN_CODE = 'starter';
const DEFAULT_SUBSCRIPTION_PLAN_NAME = '入门版';

const pool = new Pool({ connectionString: databaseUrl });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

function loadEnvFile(filePath) {
  try {
    const envContent = readFileSync(filePath, 'utf8');
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      const eqIndex = trimmed.indexOf('=');
      if (eqIndex < 0) {
        continue;
      }

      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim().replace(/^['"]|['"]$/g, '');
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {
    // 忽略缺失 .env 的场景，后续按必填项兜底报错
  }
}

function parsePositiveInt(rawValue, fallbackValue) {
  const parsedValue = Number.parseInt(rawValue || '', 10);
  if (Number.isNaN(parsedValue) || parsedValue <= 0) {
    return fallbackValue;
  }
  return parsedValue;
}

function buildLegacyProfitPhoneEmail(phone) {
  return `phone_${phone}@${LOCAL_LOGIN_DOMAIN}`;
}

function buildProfitPhoneEmail(phone) {
  return `profit_phone_${phone}@${LOCAL_LOGIN_DOMAIN}`;
}

function buildProfitPhoneEmails(phone) {
  return [
    buildLegacyProfitPhoneEmail(phone),
    buildProfitPhoneEmail(phone),
  ];
}

function buildClubPhoneEmail(phone) {
  return `club_phone_${phone}@${LOCAL_LOGIN_DOMAIN}`;
}

function buildSmokeMetadata(profitUser, clubUser, store) {
  return {
    SMOKE_ACCOUNT_SCOPE: 'purely_profit',
    SMOKE_LOGIN_PHONE: PHONE,
    SMOKE_LOGIN_NAME: NAME,
    SMOKE_LOGIN_EMAIL: profitUser.email,
    SMOKE_PULSE_LOGIN_EMAIL: profitUser.email,
    SMOKE_CLUB_LOGIN_EMAIL: clubUser.email,
    SMOKE_STORE_ID: String(store.id),
    SMOKE_STORE_NAME: store.name,
    SMOKE_PROFIT_REPORT_PATH: `/profit-detail/report?storeId=${store.id}&period=month`,
    SMOKE_CLUB_PROFILE_PATH: '/club/member/profile',
    SMOKE_CLUB_CURRENT_STORE_PATH: '/club/stores/current',
    SMOKE_PULSE_SWITCH_STORE_PATH: '/pulse/session/current-store',
    SMOKE_PULSE_BOOTSTRAP_PATH: '/pulse/session/bootstrap',
  };
}

async function findExistingUser() {
  return prisma.user.findFirst({
    where: {
      email: {
        in: buildProfitPhoneEmails(PHONE),
      },
    },
    select: {
      id: true,
      email: true,
      name: true,
      store: {
        select: {
          id: true,
          ownerId: true,
          name: true,
          address: true,
          contactName: true,
          contactPhone: true,
        },
      },
      staffMembership: {
        select: {
          id: true,
          storeId: true,
          email: true,
          name: true,
          phone: true,
          role: true,
          permissions: true,
          status: true,
          isSeatActive: true,
          isActive: true,
        },
      },
    },
    orderBy: {
      id: 'asc',
    },
  });
}

async function ensureUser() {
  const existingUser = await findExistingUser();
  const hashedPassword = await bcrypt.hash(PASSWORD, 10);

  if (existingUser) {
    const updatedUser = await prisma.user.update({
      where: { id: existingUser.id },
      data: {
        password: hashedPassword,
        name: NAME,
      },
      select: {
        id: true,
        email: true,
        name: true,
        store: {
          select: {
            id: true,
            ownerId: true,
            name: true,
            address: true,
            contactName: true,
            contactPhone: true,
          },
        },
        staffMembership: {
          select: {
            id: true,
            storeId: true,
            email: true,
            name: true,
            phone: true,
            role: true,
            permissions: true,
            status: true,
            isSeatActive: true,
            isActive: true,
          },
        },
      },
    });
    console.log(
      `♻️ smoke 用户已存在，已同步密码与名称 id=${updatedUser.id} email=${updatedUser.email}`,
    );
    return updatedUser;
  }

  const createdUser = await prisma.user.create({
    data: {
      email: buildLegacyProfitPhoneEmail(PHONE),
      password: hashedPassword,
      name: NAME,
    },
    select: {
      id: true,
      email: true,
      name: true,
      store: {
        select: {
          id: true,
          ownerId: true,
          name: true,
          address: true,
          contactName: true,
          contactPhone: true,
        },
      },
      staffMembership: {
        select: {
          id: true,
          storeId: true,
          email: true,
          name: true,
          phone: true,
          role: true,
          permissions: true,
          status: true,
          isSeatActive: true,
          isActive: true,
        },
      },
    },
  });
  console.log(`✅ smoke 用户已创建 id=${createdUser.id} email=${createdUser.email}`);
  return createdUser;
}

async function findExistingClubUser() {
  return prisma.user.findFirst({
    where: {
      email: buildClubPhoneEmail(PHONE),
    },
    select: {
      id: true,
      email: true,
      name: true,
    },
  });
}

async function ensureClubUser() {
  const existingUser = await findExistingClubUser();
  const hashedPassword = await bcrypt.hash(PASSWORD, 10);

  if (existingUser) {
    const updatedUser = await prisma.user.update({
      where: { id: existingUser.id },
      data: {
        password: hashedPassword,
        name: NAME,
      },
      select: {
        id: true,
        email: true,
        name: true,
      },
    });
    console.log(
      `♻️ purely-club smoke 用户已存在，已同步密码与名称 id=${updatedUser.id} email=${updatedUser.email}`,
    );
    return updatedUser;
  }

  const createdUser = await prisma.user.create({
    data: {
      email: buildClubPhoneEmail(PHONE),
      password: hashedPassword,
      name: NAME,
    },
    select: {
      id: true,
      email: true,
      name: true,
    },
  });
  console.log(
    `✅ purely-club smoke 用户已创建 id=${createdUser.id} email=${createdUser.email}`,
  );
  return createdUser;
}

async function ensureStore(user) {
  if (user.store) {
    const updatedStore = await prisma.store.update({
      where: { id: user.store.id },
      data: {
        name: STORE_NAME,
        address: STORE_ADDRESS,
        contactName: STORE_CONTACT_NAME,
        contactPhone: STORE_CONTACT_PHONE,
      },
      select: {
        id: true,
        ownerId: true,
        name: true,
        address: true,
        contactName: true,
        contactPhone: true,
      },
    });
    console.log(`♻️ 已同步 smoke 门店 id=${updatedStore.id} name=${updatedStore.name}`);
    return updatedStore;
  }

  if (user.staffMembership?.storeId) {
    const boundStore = await prisma.store.findUnique({
      where: { id: user.staffMembership.storeId },
      select: {
        id: true,
        ownerId: true,
        name: true,
        address: true,
        contactName: true,
        contactPhone: true,
      },
    });
    if (boundStore) {
      console.log(
        `♻️ smoke 用户已绑定门店 id=${boundStore.id} name=${boundStore.name}，沿用现有门店`,
      );
      return boundStore;
    }
  }

  const createdStore = await prisma.store.create({
    data: {
      name: STORE_NAME,
      address: STORE_ADDRESS,
      contactName: STORE_CONTACT_NAME,
      contactPhone: STORE_CONTACT_PHONE,
      ownerId: user.id,
    },
    select: {
      id: true,
      ownerId: true,
      name: true,
      address: true,
      contactName: true,
      contactPhone: true,
    },
  });
  console.log(`✅ smoke 门店已创建 id=${createdStore.id} name=${createdStore.name}`);
  return createdStore;
}

async function ensureSubscription(user, store) {
  const existingSubscription = await prisma.storeSubscription.findUnique({
    where: { storeId: store.id },
    select: {
      id: true,
      status: true,
      planCode: true,
      planName: true,
    },
  });

  if (existingSubscription) {
    const updatedSubscription = await prisma.storeSubscription.update({
      where: { storeId: store.id },
      data: {
        status: 'active',
        planCode: existingSubscription.planCode || DEFAULT_SUBSCRIPTION_PLAN_CODE,
        planName: existingSubscription.planName || DEFAULT_SUBSCRIPTION_PLAN_NAME,
        expiresAt: null,
      },
      select: {
        id: true,
        status: true,
      },
    });
    console.log(
      `♻️ 已同步 smoke 订阅 id=${updatedSubscription.id} status=${updatedSubscription.status}`,
    );
    return updatedSubscription;
  }

  if (store.ownerId !== user.id) {
    console.log(
      `⚠️ 门店 ${store.id} 不属于当前 smoke 用户，跳过自动创建订阅，请确认该门店已有可用订阅`,
    );
    return null;
  }

  // 数据库存在 NOT NULL 列 max_account_seats 但 Prisma schema 未声明，
  // 必须用 raw SQL 插入以提供该列的值
  await prisma.$executeRaw`
    INSERT INTO store_subscriptions (store_id, plan_code, plan_name, status, max_account_seats, starts_at, created_at, updated_at)
    VALUES (${store.id}, ${DEFAULT_SUBSCRIPTION_PLAN_CODE}, ${DEFAULT_SUBSCRIPTION_PLAN_NAME}, 'active', 5, NOW(), NOW(), NOW())
  `;
  const createdSubscription = await prisma.storeSubscription.findUnique({
    where: { storeId: store.id },
    select: {
      id: true,
      status: true,
    },
  });
  console.log(
    `✅ smoke 订阅已创建 id=${createdSubscription.id} status=${createdSubscription.status}`,
  );
  return createdSubscription;
}

function resolveMemberDisplayName(user) {
  const trimmedName = user.name?.trim();
  if (trimmedName) {
    return trimmedName;
  }

  return `纯利会员${PHONE.slice(-4)}`;
}

async function ensureClubStoreAccess(user, store) {
  const displayName = resolveMemberDisplayName(user);

  // storeId_phone 已改为 partial unique index（仅对 deleted_at IS NULL 生效），
  // Prisma client 不再暴露该复合约束名，改用 findFirst + create/update 实现 upsert 语义
  const [member, marketingCustomer] = await prisma.$transaction(async (tx) => {
    const existingMember = await tx.member.findFirst({
      where: { storeId: store.id, phone: PHONE, deletedAt: null },
      select: { id: true, status: true },
    });
    const memberResult = existingMember
      ? await tx.member.update({
          where: { id: existingMember.id },
          data: { name: displayName, status: 'active' },
          select: { id: true, status: true },
        })
      : await tx.member.create({
          data: { storeId: store.id, name: displayName, phone: PHONE },
          select: { id: true, status: true },
        });

    const existingCustomer = await tx.marketingCustomer.findFirst({
      where: { storeId: store.id, phone: PHONE, deletedAt: null },
      select: { id: true },
    });
    const customerResult = existingCustomer
      ? await tx.marketingCustomer.update({
          where: { id: existingCustomer.id },
          data: { name: displayName },
          select: { id: true },
        })
      : await tx.marketingCustomer.create({
          data: { storeId: store.id, name: displayName, phone: PHONE },
          select: { id: true },
        });

    return [memberResult, customerResult];
  });

  console.log(
    `♻️ 已同步 purely-club 门店访问 member=${member.id} marketingCustomer=${marketingCustomer.id}`,
  );
}

async function ensureStaffMembership(user, store) {
  const staffPayload = {
    storeId: store.id,
    userId: user.id,
    email: user.email,
    name: NAME,
    phone: PHONE,
    role: 'owner',
    permissions: ['*'],
    status: 'active',
    isSeatActive: true,
    isActive: true,
  };

  if (user.staffMembership) {
    const updatedStaff = await prisma.staff.update({
      where: { id: user.staffMembership.id },
      data: staffPayload,
      select: {
        id: true,
        storeId: true,
        role: true,
        status: true,
        isSeatActive: true,
        isActive: true,
      },
    });
    console.log(`♻️ 已同步 smoke staffMembership id=${updatedStaff.id}`);
    return updatedStaff;
  }

  const createdStaff = await prisma.staff.create({
    data: staffPayload,
    select: {
      id: true,
      storeId: true,
      role: true,
      status: true,
      isSeatActive: true,
      isActive: true,
    },
  });
  console.log(`✅ smoke staffMembership 已创建 id=${createdStaff.id}`);
  return createdStaff;
}

async function main() {
  const profitUser = await ensureUser();
  const clubUser = await ensureClubUser();
  const store = await ensureStore(profitUser);

  await ensureSubscription(profitUser, store);
  await ensureStaffMembership(profitUser, store);
  await ensureClubStoreAccess(clubUser, store);

  console.log('');
  console.log('==============================');
  console.log(' smoke 数据准备完成');
  console.log('==============================');
  console.log(` 手机号：${PHONE}`);
  console.log(` 密  码：${PASSWORD}`);
  console.log(` 老板账号：${profitUser.email}`);
  console.log(` 会员账号：${clubUser.email}`);
  console.log(` 门店ID：${store.id}`);
  console.log(` 门店名：${store.name}`);
  console.log('==============================');

  const smokeMetadata = buildSmokeMetadata(profitUser, clubUser, store);
  for (const [key, value] of Object.entries(smokeMetadata)) {
    process.stdout.write(`${key}=${value}\n`);
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });

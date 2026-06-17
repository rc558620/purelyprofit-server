import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import Redis from 'ioredis';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');
const envPath = resolve(projectRoot, '.env');

loadEnvFile(envPath);

const configuredPhone = process.env.SMOKE_LOGIN_PHONE?.trim() || '';
const configuredEmail = process.env.SMOKE_LOGIN_EMAIL?.trim().toLowerCase() || '';
const accountScope = process.env.SMOKE_ACCOUNT_SCOPE?.trim() || 'purely_profit';
const configuredStoreId = parseOptionalPositiveInt(
  process.env.SMOKE_STORE_ID,
  'SMOKE_STORE_ID',
);
const jwtSecret = process.env.JWT_SECRET?.trim();
const localLoginDomain = 'purelyprofit.local';
const tokenVersionKeyPrefix = 'auth:token-version:';

if (!jwtSecret) {
  throw new Error('缺少 JWT_SECRET，无法生成业务级 smoke token');
}

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  throw new Error('缺少 DATABASE_URL，无法查询 smoke 用户');
}

const pool = new Pool({ connectionString: databaseUrl });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });
const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: Number.parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD || undefined,
  db: Number.parseInt(process.env.REDIS_DB || '0', 10),
  connectTimeout: Number.parseInt(process.env.REDIS_CONNECT_TIMEOUT_MS || '5000', 10),
  commandTimeout: Number.parseInt(process.env.REDIS_COMMAND_TIMEOUT_MS || '3000', 10),
  maxRetriesPerRequest: Number.parseInt(process.env.REDIS_MAX_RETRIES_PER_REQUEST || '3', 10),
  enableReadyCheck: true,
  lazyConnect: false,
});

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
      const value = trimmed
        .slice(eqIndex + 1)
        .trim()
        .replace(/^['"]|['"]$/g, '');
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {
    // 忽略缺失 .env 的场景，后续按必填项兜底报错
  }
}

function parseOptionalPositiveInt(rawValue, variableName) {
  const trimmedValue = rawValue?.trim();
  if (!trimmedValue) {
    return null;
  }

  const parsedValue = Number.parseInt(trimmedValue, 10);
  if (Number.isNaN(parsedValue) || parsedValue <= 0) {
    throw new Error(`${variableName} 必须是正整数`);
  }

  return parsedValue;
}

function toBase64Url(value) {
  return Buffer.from(value).toString('base64url');
}

function signJwt(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const signingInput = `${toBase64Url(JSON.stringify(header))}.${toBase64Url(JSON.stringify(payload))}`;
  const signature = createHmac('sha256', secret)
    .update(signingInput)
    .digest('base64url');
  return `${signingInput}.${signature}`;
}

function buildPhoneLoginEmails(scope, phone) {
  if (!phone) {
    return [];
  }

  if (scope === 'purely_club') {
    return [`club_phone_${phone}@${localLoginDomain}`];
  }

  return [
    `profit_phone_${phone}@${localLoginDomain}`,
    `phone_${phone}@${localLoginDomain}`,
  ];
}

function extractPhoneFromLoginEmail(email) {
  const patterns = [
    /^profit_phone_(\d{11})@purelyprofit\.local$/,
    /^phone_(\d{11})@purelyprofit\.local$/,
    /^club_phone_(\d{11})@purelyprofit\.local$/,
  ];

  for (const pattern of patterns) {
    const matched = pattern.exec(email);
    if (matched?.[1]) {
      return matched[1];
    }
  }

  return null;
}

function resolveUserLookup() {
  if (configuredEmail) {
    return {
      where: { email: configuredEmail },
      description: `email=${configuredEmail}`,
    };
  }

  const candidateEmails = buildPhoneLoginEmails(accountScope, configuredPhone);
  if (candidateEmails.length === 0) {
    throw new Error(
      '缺少 SMOKE_LOGIN_EMAIL 或 SMOKE_LOGIN_PHONE，无法定位 smoke 登录用户。可先执行 pnpm run smoke:prepare 生成元信息。',
    );
  }

  return {
    where: {
      email: {
        in: candidateEmails,
      },
    },
    description: `phone=${configuredPhone}`,
  };
}

async function resolveUser() {
  const lookup = resolveUserLookup();
  const user = await prisma.user.findFirst({
    where: lookup.where,
    select: {
      id: true,
      email: true,
      staffMembership: {
        select: {
          storeId: true,
          phone: true,
          permissions: true,
          status: true,
          isActive: true,
          isSeatActive: true,
        },
      },
    },
    orderBy: {
      id: 'asc',
    },
  });

  if (!user) {
    throw new Error(
      `未找到 smoke 登录用户，${lookup.description}。可先执行 pnpm run smoke:prepare 初始化账号。`,
    );
  }

  if (accountScope === 'purely_profit') {
    if (!user.staffMembership) {
      throw new Error(
        `smoke 用户 ${user.email} 未绑定 staffMembership，无法访问 purely-profit 接口。`,
      );
    }

    if (
      configuredStoreId !== null &&
      user.staffMembership.storeId !== configuredStoreId
    ) {
      throw new Error(
        `声明的 SMOKE_STORE_ID=${configuredStoreId} 与用户实际门店 ${user.staffMembership.storeId} 不一致。`,
      );
    }

    const hasReportPermission =
      user.staffMembership.permissions.includes('*') ||
      user.staffMembership.permissions.includes('report:view');
    if (!hasReportPermission) {
      throw new Error(
        `smoke 用户 ${user.email} 缺少 report:view 权限，无法校验利润报表接口。`,
      );
    }

    if (
      user.staffMembership.status !== 'ACTIVE' ||
      !user.staffMembership.isActive ||
      !user.staffMembership.isSeatActive
    ) {
      throw new Error(
        `smoke 用户 ${user.email} 的 staffMembership 未激活，无法访问 purely-profit 接口。`,
      );
    }
  }

  return user;
}

function resolveTokenPhone(user) {
  if (configuredPhone) {
    return configuredPhone;
  }

  const phoneFromEmail = extractPhoneFromLoginEmail(user.email);
  if (phoneFromEmail) {
    return phoneFromEmail;
  }

  const staffPhone = user.staffMembership?.phone?.trim();
  if (staffPhone) {
    return staffPhone;
  }

  throw new Error(
    `无法为 smoke 用户 ${user.email} 推导手机号；请显式提供 SMOKE_LOGIN_PHONE。`,
  );
}

async function resolveTokenVersion(userId) {
  const key = `${tokenVersionKeyPrefix}${userId}`;
  const rawVersion = await redis.get(key);
  const parsedVersion = Number.parseInt(rawVersion || '0', 10);
  return Number.isNaN(parsedVersion) ? 0 : parsedVersion;
}

async function main() {
  const user = await resolveUser();
  const phone = resolveTokenPhone(user);
  const storeId = configuredStoreId ?? user.staffMembership?.storeId ?? null;
  if (storeId === null) {
    throw new Error('缺少 SMOKE_STORE_ID，无法推导当前 smoke 门店。');
  }

  const tokenVersion = await resolveTokenVersion(user.id);
  const payload = {
    sub: user.id,
    phone,
    accountScope,
    sessionVersion: tokenVersion,
  };
  const profitReportPath = `/profit-detail/report?storeId=${storeId}&period=month`;

  const token = signJwt(payload, jwtSecret);
  process.stdout.write(
    `SMOKE_TOKEN=${token}\n` +
      `SMOKE_ACCOUNT_SCOPE=${accountScope}\n` +
      `SMOKE_LOGIN_PHONE=${phone}\n` +
      `SMOKE_LOGIN_EMAIL=${user.email}\n` +
      `SMOKE_STORE_ID=${storeId}\n` +
      `SMOKE_PROFIT_REPORT_PATH=${profitReportPath}\n` +
      'SMOKE_CLUB_PROFILE_PATH=/club/member/profile\n' +
      'SMOKE_CLUB_CURRENT_STORE_PATH=/club/stores/current\n' +
      'SMOKE_PULSE_SWITCH_STORE_PATH=/pulse/session/current-store\n' +
      'SMOKE_PULSE_BOOTSTRAP_PATH=/pulse/session/bootstrap\n',
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
    await redis.quit();
  });

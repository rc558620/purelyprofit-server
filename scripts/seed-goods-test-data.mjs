/**
 * 为开发/测试门店批量插入测试分类与测试商品，用于验证商品列表分页与服务端过滤。
 *
 * 用法：node scripts/seed-goods-test-data.mjs [storeId]
 *
 * 可选环境变量：
 *   SEED_STORE_ID           门店 ID（未提供时默认查找 smoke 账号 13619654020 的门店）
 *   SEED_CATEGORY_COUNT     新增分类数量（默认 10）
 *   SEED_PRODUCTS_PER_CATEGORY 每个分类新增商品数量（默认 3）
 *
 * 设计说明：
 * - 商品列表默认按 createdAt 倒序分页（每页 20）。为了让测试商品分散到不同分页，
 *   前 5 个分类用最近创建时间，中间 2 个用 2023 年，最后 3 个用 2020 年，
 *   这样切换"测试分类08~10"时可验证服务端过滤能一次拉取后面页的数据。
 * - 幂等：分类按 (storeId, name) 复用；商品按 (storeId, code) 跳过，重复运行不会产生重复数据。
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnvFile(resolve(__dirname, '../.env'));

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  throw new Error('缺少 DATABASE_URL，无法写入测试数据');
}

const pool = new Pool({ connectionString: databaseUrl });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const SMOKE_PHONE = '13619654020';
const SMOKE_EMAILS = [
  `phone_${SMOKE_PHONE}@purelyprofit.local`,
  `profit_phone_${SMOKE_PHONE}@purelyprofit.local`,
];

const CATEGORY_COUNT = parsePositiveInt(process.env.SEED_CATEGORY_COUNT, 10);
const PRODUCTS_PER_CATEGORY = parsePositiveInt(process.env.SEED_PRODUCTS_PER_CATEGORY, 3);
const CLI_STORE_ID = parsePositiveInt(process.argv[2], 0);
const ENV_STORE_ID = parsePositiveInt(process.env.SEED_STORE_ID, 0);

const CATEGORY_NAMES = Array.from(
  { length: CATEGORY_COUNT },
  (_, i) => `测试分类${String(i + 1).padStart(2, '0')}`,
);

const PRICE_VARIANTS = [
  { price: 800, costPrice: 500 },
  { price: 1500, costPrice: 900 },
  { price: 2800, costPrice: 1800 },
];

// 每个分类的商品创建时间基准（分类内多个商品依次 +1 天）
const CATEGORY_CREATED_AT = Array.from({ length: CATEGORY_COUNT }, (_, i) => {
  if (i < 5) {
    return () => daysAgo((i + 1) * 3);
  }
  if (i < 7) {
    return () => new Date(i === 5 ? '2023-06-15T08:00:00+08:00' : '2023-11-20T08:00:00+08:00');
  }
  const BASE_DATES = ['2020-01-10T08:00:00+08:00', '2020-05-22T08:00:00+08:00', '2020-10-18T08:00:00+08:00'];
  return () => new Date(BASE_DATES[i - 7]);
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

function parsePositiveInt(rawValue, fallbackValue) {
  const parsedValue = Number.parseInt(rawValue || '', 10);
  if (Number.isNaN(parsedValue) || parsedValue <= 0) {
    return fallbackValue;
  }
  return parsedValue;
}

function daysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function buildVariant(k) {
  const base = PRICE_VARIANTS[k % PRICE_VARIANTS.length];
  return {
    suffix: String.fromCharCode(65 + (k % 26)),
    price: base.price,
    costPrice: base.costPrice,
  };
}

async function resolveStoreId() {
  const storeId = CLI_STORE_ID || ENV_STORE_ID;
  if (storeId) {
    return storeId;
  }

  const user = await prisma.user.findFirst({
    where: { email: { in: SMOKE_EMAILS } },
    select: {
      store: { select: { id: true, name: true } },
      staffMembership: { select: { storeId: true } },
    },
    orderBy: { id: 'asc' },
  });
  if (user?.store) {
    return user.store.id;
  }
  if (user?.staffMembership?.storeId) {
    return user.staffMembership.storeId;
  }
  throw new Error('未找到可用门店，请通过 SEED_STORE_ID 或命令行参数指定门店 ID');
}

async function ensureCategory(storeId, name, createdAt) {
  const existing = await prisma.productCategory.findFirst({
    where: { storeId, name, deletedAt: null },
    select: { id: true },
  });
  if (existing) {
    return { id: existing.id, created: false };
  }
  const created = await prisma.productCategory.create({
    data: { storeId, name, createdAt },
    select: { id: true },
  });
  return { id: created.id, created: true };
}

async function ensureProduct(storeId, categoryId, categoryName, code, name, price, costPrice, createdAt) {
  const existing = await prisma.product.findFirst({
    where: { storeId, code, deletedAt: null },
    select: { id: true },
  });
  if (existing) {
    return { created: false };
  }
  await prisma.product.create({
    data: {
      storeId,
      categoryId,
      category: categoryName,
      code,
      name,
      price,
      costPrice,
      profit: price - costPrice,
      unit: '份',
      stock: 50,
      alertThreshold: 10,
      isActive: true,
      createdAt,
    },
  });
  return { created: true };
}

async function main() {
  const storeId = await resolveStoreId();
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { id: true, name: true },
  });
  if (!store) {
    throw new Error(`门店 ${storeId} 不存在`);
  }

  const beforeCategoryCount = await prisma.productCategory.count({
    where: { storeId, deletedAt: null },
  });
  const beforeProductCount = await prisma.product.count({
    where: { storeId, deletedAt: null },
  });

  console.log(`目标门店：${store.id} ${store.name}`);
  console.log(`现有数据：分类 ${beforeCategoryCount} 个，商品 ${beforeProductCount} 个`);

  let createdCategories = 0;
  let createdProducts = 0;
  let skippedProducts = 0;

  for (let i = 0; i < CATEGORY_COUNT; i += 1) {
    const name = CATEGORY_NAMES[i];
    const baseDate = CATEGORY_CREATED_AT[i]();
    const category = await ensureCategory(storeId, name, baseDate);
    if (category.created) {
      createdCategories += 1;
    }

    for (let k = 0; k < PRODUCTS_PER_CATEGORY; k += 1) {
      const variant = buildVariant(k);
      const code = `TST${String(i + 1).padStart(2, '0')}-${variant.suffix}`;
      const productName = `${name}·商品${variant.suffix}`;
      const productCreatedAt = addDays(baseDate, k);
      const result = await ensureProduct(
        storeId,
        category.id,
        name,
        code,
        productName,
        variant.price,
        variant.costPrice,
        productCreatedAt,
      );
      if (result.created) {
        createdProducts += 1;
      } else {
        skippedProducts += 1;
      }
    }
  }

  const totalProducts = await prisma.product.count({
    where: { storeId, deletedAt: null },
  });

  console.log('');
  console.log('========== 测试数据写入完成 ==========');
  console.log(`新增分类：${createdCategories} 个`);
  console.log(`新增商品：${createdProducts} 个，跳过已存在：${skippedProducts} 个`);
  console.log(`当前门店商品总数：${totalProducts}（列表默认每页 20 条，按创建时间倒序）`);
  console.log('提示：切换到"测试分类08~10"（2020 年创建、排在后面页）可验证服务端过滤一次拉取。');
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

/**
 * 批量上架商品到扫码点餐（复刻后端 ProductsScanOrderingSyncService.enable 的落库逻辑）。
 * 用法：node scripts/seed-scan-ordering-enable.mjs [storeId]
 *
 * 可选环境变量：
 *   SEED_STORE_ID          门店 ID（未提供时默认查找 smoke 账号 13619654020 的门店）
 *   SEED_CATEGORY_PREFIX   商品分类名前缀（默认"测试分类"，只处理该前缀分类下的商品）
 *
 * 幂等：已上架的商品会被更新为激活；已存在同名菜单商品且关联不同商品时跳过并告警。
 * 完成后会失效扫码菜单 Redis 缓存（scanordering:menu:{storeId}）。
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import Redis from 'ioredis';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnvFile(resolve(__dirname, '../.env'));

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  throw new Error('缺少 DATABASE_URL，无法上架扫码点餐商品');
}

const pool = new Pool({ connectionString: databaseUrl });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const SMOKE_PHONE = '13619654020';
const SMOKE_EMAILS = [
  `phone_${SMOKE_PHONE}@purelyprofit.local`,
  `profit_phone_${SMOKE_PHONE}@purelyprofit.local`,
];

const CATEGORY_PREFIX = process.env.SEED_CATEGORY_PREFIX?.trim() || '测试分类';
const CLI_STORE_ID = parsePositiveInt(process.argv[2], 0);
const ENV_STORE_ID = parsePositiveInt(process.env.SEED_STORE_ID, 0);

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
    // 忽略缺失 .env 的场景
  }
}

function parsePositiveInt(rawValue, fallbackValue) {
  const parsedValue = Number.parseInt(rawValue || '', 10);
  if (Number.isNaN(parsedValue) || parsedValue <= 0) {
    return fallbackValue;
  }
  return parsedValue;
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

/** 查找或创建扫码菜单分类（同名仅对未删除记录生效） */
async function resolveMenuCategory(storeId, name) {
  const normalized = name.trim();
  const existing = await prisma.scanOrderingMenuCategory.findFirst({
    where: { storeId, name: normalized, deletedAt: null },
    select: { id: true },
  });
  if (existing) {
    return { id: existing.id, created: false };
  }
  const last = await prisma.scanOrderingMenuCategory.findFirst({
    where: { storeId, deletedAt: null },
    orderBy: [{ sortOrder: 'desc' }, { id: 'desc' }],
    select: { sortOrder: true },
  });
  const created = await prisma.scanOrderingMenuCategory.create({
    data: {
      storeId,
      name: normalized || '默认分类',
      sortOrder: (last?.sortOrder ?? -1) + 1,
    },
    select: { id: true },
  });
  return { id: created.id, created: true };
}

/** 复刻 enable：将普通商品上架为扫码菜单商品 */
async function enableProduct(product, storeId) {
  const { id: categoryId } = await resolveMenuCategory(storeId, product.category);

  const existing = await prisma.scanOrderingMenuProduct.findFirst({
    where: {
      storeId,
      productId: product.id,
      deletedAt: null,
    },
    select: { id: true },
  });
  if (existing) {
    await prisma.scanOrderingMenuProduct.update({
      where: { id: existing.id },
      data: {
        isActive: true,
        deletedAt: null,
        categoryId,
        name: product.name,
        basePrice: product.price,
      },
    });
    return 'updated';
  }

  const conflict = await prisma.scanOrderingMenuProduct.findFirst({
    where: { storeId, name: product.name, deletedAt: null },
    select: { id: true, productId: true },
  });
  if (conflict && conflict.productId !== product.id) {
    return 'conflict';
  }
  if (conflict) {
    await prisma.scanOrderingMenuProduct.update({
      where: { id: conflict.id },
      data: {
        productId: product.id,
        categoryId,
        imageUrl: product.image,
        basePrice: product.price,
        isActive: true,
      },
    });
    return 'updated';
  }

  await prisma.scanOrderingMenuProduct.create({
    data: {
      storeId,
      productId: product.id,
      categoryId,
      name: product.name,
      imageUrl: product.image,
      basePrice: product.price,
      isActive: true,
    },
  });
  return 'created';
}

async function invalidateMenuCache(storeId) {
  const host = process.env.REDIS_HOST?.trim();
  if (!host) {
    console.warn('未配置 REDIS_HOST，跳过菜单缓存失效（如前端菜单无变化请手动检查）');
    return;
  }
  const port = parsePositiveInt(process.env.REDIS_PORT, 6379);
  const db = parsePositiveInt(process.env.REDIS_DB, 0);
  const password = process.env.REDIS_PASSWORD?.trim() || undefined;
  const redis = new Redis({ host, port, db, password, lazyConnect: true });
  try {
    await redis.connect();
    const key = `scanordering:menu:${storeId}`;
    await redis.del(key);
    console.log(`已失效扫码菜单缓存：${key}`);
  } catch (error) {
    console.warn(`失效菜单缓存失败（不影响落库）：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    try {
      await redis.quit();
    } catch {
      // ignore
    }
  }
}

async function main() {
  const storeId = await resolveStoreId();
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { id: true, name: true, businessMode: true },
  });
  if (!store) {
    throw new Error(`门店 ${storeId} 不存在`);
  }

  const products = await prisma.product.findMany({
    where: {
      storeId,
      deletedAt: null,
      category: { startsWith: CATEGORY_PREFIX },
    },
    orderBy: { id: 'asc' },
    select: { id: true, name: true, code: true, category: true, price: true, image: true },
  });
  console.log(`目标门店：${store.id} ${store.name}（businessMode=${store.businessMode}）`);
  console.log(`待上架商品（分类前缀"${CATEGORY_PREFIX}"）：${products.length} 个`);

  if (products.length === 0) {
    console.log('没有可上架的商品，退出。');
    return;
  }

  let created = 0;
  let updated = 0;
  let conflict = 0;

  for (const product of products) {
    const result = await enableProduct(product, storeId);
    if (result === 'created') {
      created += 1;
    } else if (result === 'updated') {
      updated += 1;
    } else {
      conflict += 1;
      console.warn(`跳过同名冲突：${product.code} ${product.name}`);
    }
  }

  console.log('');
  console.log('========== 上架完成 ==========');
  console.log(`新建菜单商品：${created} 个`);
  console.log(`更新为激活：${updated} 个`);
  console.log(`同名冲突跳过：${conflict} 个`);

  await invalidateMenuCache(storeId);
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

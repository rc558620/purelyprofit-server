/**
 * 压测数据构造 — 门店批次（stores + subscription + owner staff + employees + products + categories）
 *
 * 用法：
 *   node scripts/seed-loadtest-stores.mjs              # 造档 B 默认 500 门店
 *   node scripts/seed-loadtest-stores.mjs --count=100  # 造档 A 100 门店
 *   node scripts/seed-loadtest-stores.mjs --cleanup    # 清理本脚本造的数据
 *
 * 环境变量：
 *   LOADTEST_STORE_COUNT  门店数量（同 --count，默认 500）
 *
 * 安全设计：
 *   1. 禁止在 NODE_ENV=production 下执行
 *   2. 幂等标记：门店 name 前缀「压测门店」，staff email 后缀 @loadtest.local
 *   3. --cleanup 只清理带标记的数据，不影响真实业务数据
 *   4. 默认 dry-run 模式（只输出计划），需加 --yes 确认执行
 *
 * 数据量（档B 500 店）：
 *   - 500 Store + 500 StoreSubscription
 *   - 500 User(owner) + 500 Staff(owner)
 *   - 5000 Employee（10/店）
 *   - 5000 ProductCategory（10/店）
 *   - 100000 Product（200/店）
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import bcrypt from 'bcryptjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnvFile(resolve(__dirname, '../.env'));

// ── 环境保护 ──────────────────────────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  throw new Error('❌ 禁止在生产环境执行压测数据构造脚本');
}

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  throw new Error('缺少 DATABASE_URL，无法构造压测数据');
}

const pool = new Pool({ connectionString: databaseUrl });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// ── 参数解析 ──────────────────────────────────────────────────────
const args = process.argv.slice(2);
const CONFIRMED = args.includes('--yes');
const CLEANUP = args.includes('--cleanup');
const countArg = args.find((a) => a.startsWith('--count='));
const STORE_COUNT = parsePositiveInt(
  countArg?.split('=')[1] ?? process.env.LOADTEST_STORE_COUNT,
  500,
);

const STORE_PREFIX = '压测门店';
const OWNER_EMAIL_SUFFIX = '@loadtest.local';
const EMPLOYEES_PER_STORE = 10;
const CATEGORIES_PER_STORE = 10;
const PRODUCTS_PER_CATEGORY = 20; // 10 × 20 = 200 商品/店

const CATEGORY_NAMES = [
  '饮品', '小吃', '主食', '甜点', '套餐',
  '咖啡', '茶饮', '果汁', '冰品', '其他',
];

const PRODUCT_VARIANTS = [
  { price: 800, costPrice: 500 },
  { price: 1500, costPrice: 900 },
  { price: 2800, costPrice: 1800 },
  { price: 3500, costPrice: 2200 },
  { price: 5000, costPrice: 3000 },
];

// ── 主流程 ────────────────────────────────────────────────────────
async function main() {
  if (CLEANUP) {
    await runCleanup();
    return;
  }

  console.log('\n🏭 压测数据构造 — 门店批次\n');
  console.log(`  门店数量    ${STORE_COUNT}`);
  console.log(`  员工/店     ${EMPLOYEES_PER_STORE}`);
  console.log(`  商品/店     ${CATEGORIES_PER_STORE * PRODUCTS_PER_CATEGORY}`);
  console.log(`  模式        ${CONFIRMED ? '⚠️ 执行写入' : '🔍 dry-run（只输出计划）'}`);
  console.log('');

  if (!CONFIRMED) {
    console.log('ℹ️  这是 dry-run。确认无误后追加 --yes 执行写入。\n');
    return;
  }

  const startedAt = Date.now();
  let createdStores = 0;
  let createdUsers = 0;
  let createdStaffs = 0;
  let createdEmployees = 0;
  let createdCategories = 0;
  let createdProducts = 0;

  for (let i = 0; i < STORE_COUNT; i++) {
    const storeName = `${STORE_PREFIX}${String(i + 1).padStart(4, '0')}`;
    const ownerEmail = `loadtest_owner_${i + 1}${OWNER_EMAIL_SUFFIX}`;
    const ownerPhone = `139${String(i + 1).padStart(8, '0')}`;

    // 检查是否已存在（幂等）
    const existing = await prisma.store.findFirst({
      where: { name: storeName, deletedAt: null },
      select: { id: true },
    });
    if (existing) {
      continue;
    }

    // 创建 owner User
    const hashedPassword = await bcrypt.hash('loadtest123', 10);
    const user = await prisma.user.create({
      data: {
        email: ownerEmail,
        password: hashedPassword,
        name: `老板${i + 1}`,
        phone: ownerPhone,
      },
      select: { id: true },
    });
    createdUsers++;

    // 创建 Store
    const store = await prisma.store.create({
      data: {
        name: storeName,
        address: `压测地址${i + 1}`,
        contactName: `联系人${i + 1}`,
        contactPhone: ownerPhone,
        ownerId: user.id,
        businessMode: 'general',
      },
      select: { id: true },
    });
    createdStores++;

    // 创建 StoreSubscription（raw SQL，max_account_seats 列不在 Prisma schema 中）
    await prisma.$executeRaw`
      INSERT INTO store_subscriptions (store_id, plan_code, plan_name, status, max_account_seats, starts_at, created_at, updated_at)
      VALUES (${store.id}, 'starter', '入门版', 'active', 5, NOW(), NOW(), NOW())
    `;

    // 创建 Staff(owner)
    await prisma.staff.create({
      data: {
        storeId: store.id,
        userId: user.id,
        email: ownerEmail,
        name: `老板${i + 1}`,
        phone: ownerPhone,
        role: 'owner',
        permissions: ['*'],
        status: 'active',
        isSeatActive: true,
        isActive: true,
      },
    });
    createdStaffs++;

    // 创建员工
    for (let e = 0; e < EMPLOYEES_PER_STORE; e++) {
      await prisma.employee.create({
        data: {
          storeId: store.id,
          empNo: `LT${String(i + 1).padStart(4, '0')}-${String(e + 1).padStart(2, '0')}`,
          name: `员工${i + 1}-${e + 1}`,
          phone: `138${String(i * 10 + e + 1).padStart(8, '0')}`,
          position: '店员',
          department: '营业部',
          joinDate: new Date(),
          baseSalary: 500000,
          status: 'active',
        },
      });
      createdEmployees++;
    }

    // 创建商品分类 + 商品
    for (let c = 0; c < CATEGORIES_PER_STORE; c++) {
      const catName = CATEGORY_NAMES[c % CATEGORY_NAMES.length];
      const category = await prisma.productCategory.create({
        data: { storeId: store.id, name: `${catName}${c + 1}` },
        select: { id: true },
      });
      createdCategories++;

      for (let p = 0; p < PRODUCTS_PER_CATEGORY; p++) {
        const variant = PRODUCT_VARIANTS[p % PRODUCT_VARIANTS.length];
        const code = `LT${String(i + 1).padStart(4, '0')}-${c + 1}-${p + 1}`;
        await prisma.product.create({
          data: {
            storeId: store.id,
            categoryId: category.id,
            category: `${catName}${c + 1}`,
            code,
            name: `${catName}${c + 1}·商品${p + 1}`,
            price: variant.price,
            costPrice: variant.costPrice,
            profit: variant.price - variant.costPrice,
            unit: '份',
            stock: 100,
            alertThreshold: 10,
            isActive: true,
          },
        });
        createdProducts++;
      }
    }

    if ((i + 1) % 50 === 0) {
      const elapsed = Date.now() - startedAt;
      console.log(`  进度: ${i + 1}/${STORE_COUNT} 门店 (${elapsed}ms)`);
    }
  }

  const elapsed = Date.now() - startedAt;
  console.log('\n========== 压测门店数据构造完成 ==========');
  console.log(`  门店        ${createdStores}`);
  console.log(`  用户        ${createdUsers}`);
  console.log(`  员工关系    ${createdStaffs}`);
  console.log(`  员工        ${createdEmployees}`);
  console.log(`  商品分类    ${createdCategories}`);
  console.log(`  商品        ${createdProducts}`);
  console.log(`  耗时        ${elapsed}ms`);
  console.log('===========================================\n');
}

async function runCleanup() {
  console.log('\n🧹 压测门店数据清理\n');
  console.log(`  模式  ${CONFIRMED ? '⚠️ 执行删除' : '🔍 dry-run（只统计）'}`);

  // 查找压测门店
  const stores = await prisma.store.findMany({
    where: { name: { startsWith: STORE_PREFIX }, deletedAt: null },
    select: { id: true, name: true, ownerId: true },
    orderBy: { id: 'asc' },
  });

  const storeIds = stores.map((s) => s.id);
  const ownerIds = stores.map((s) => s.ownerId);

  console.log(`  压测门店    ${stores.length}`);
  console.log('');

  if (stores.length === 0) {
    console.log('✅ 没有需要清理的压测门店数据\n');
    return;
  }

  if (!CONFIRMED) {
    console.log('ℹ️  这是 dry-run。确认无误后追加 --yes 执行删除。\n');
    return;
  }

  console.log('开始删除…\n');

  // 按外键依赖逆序删除
  // products → product_categories → employees → staffs → store_subscriptions → stores → users
  const delProducts = await prisma.product.deleteMany({ where: { storeId: { in: storeIds } } });
  console.log(`  products              ${delProducts.count}`);
  const delCategories = await prisma.productCategory.deleteMany({ where: { storeId: { in: storeIds } } });
  console.log(`  product_categories    ${delCategories.count}`);
  const delEmployees = await prisma.employee.deleteMany({ where: { storeId: { in: storeIds } } });
  console.log(`  employees             ${delEmployees.count}`);
  const delStaffs = await prisma.staff.deleteMany({ where: { storeId: { in: storeIds } } });
  console.log(`  staffs                ${delStaffs.count}`);
  await prisma.$executeRaw`DELETE FROM store_subscriptions WHERE store_id = ANY(${storeIds}::int[])`;
  console.log('  store_subscriptions   cleaned');
  const delStores = await prisma.store.deleteMany({ where: { id: { in: storeIds } } });
  console.log(`  stores                ${delStores.count}`);
  const delUsers = await prisma.user.deleteMany({ where: { id: { in: ownerIds } } });
  console.log(`  users                 ${delUsers.count}`);

  console.log('\n✅ 清理完成\n');
}

// ── 工具 ──────────────────────────────────────────────────────────
function parsePositiveInt(rawValue, fallbackValue) {
  const parsedValue = Number.parseInt(rawValue || '', 10);
  return Number.isNaN(parsedValue) || parsedValue <= 0 ? fallbackValue : parsedValue;
}

function loadEnvFile(filePath) {
  try {
    const envContent = readFileSync(filePath, 'utf8');
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex < 0) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim().replace(/^['"]|['"]$/g, '');
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // 忽略缺失 .env
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

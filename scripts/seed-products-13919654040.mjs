/**
 * 为手机号 13919654040 的门店批量新增普通商品（商品管理页）：
 *   - 2 个分类
 *   - 30 个商品
 *
 * 写入目标表：product_categories + products（与商品管理页 /goods/product-list 一致）
 *
 * 用法：
 *   node scripts/seed-products-13919654040.mjs
 *
 * 幂等：分类按 (storeId, name) 复用；商品按 (storeId, code) 跳过。
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
  throw new Error('缺少 DATABASE_URL');
}

const pool = new Pool({ connectionString: databaseUrl });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const TARGET_PHONE = '13919654040';

// ---- 数据定义 ----
const CATEGORIES = [
  {
    name: '招牌美食',
    products: [
      { name: '招牌牛肉面', price: 2800, costPrice: 1500 },
      { name: '番茄鸡蛋面', price: 2200, costPrice: 1200 },
      { name: '红烧排骨饭', price: 3200, costPrice: 1800 },
      { name: '黄焖鸡米饭', price: 2600, costPrice: 1400 },
      { name: '宫保鸡丁饭', price: 2800, costPrice: 1600 },
      { name: '鱼香肉丝饭', price: 2700, costPrice: 1500 },
      { name: '麻辣香锅', price: 3800, costPrice: 2200 },
      { name: '酸菜鱼', price: 4200, costPrice: 2500 },
      { name: '水煮肉片', price: 4000, costPrice: 2400 },
      { name: '回锅肉盖饭', price: 3000, costPrice: 1700 },
      { name: '麻婆豆腐饭', price: 2400, costPrice: 1300 },
      { name: '糖醋里脊饭', price: 3300, costPrice: 1900 },
      { name: '咖喱牛肉饭', price: 3500, costPrice: 2000 },
      { name: '照烧鸡腿饭', price: 2900, costPrice: 1600 },
      { name: '黑椒牛柳饭', price: 3900, costPrice: 2300 },
    ],
  },
  {
    name: '饮品甜点',
    products: [
      { name: '招牌奶茶', price: 1600, costPrice: 600 },
      { name: '珍珠奶茶', price: 1800, costPrice: 700 },
      { name: '杨枝甘露', price: 2200, costPrice: 1000 },
      { name: '柠檬蜂蜜茶', price: 1500, costPrice: 500 },
      { name: '百香果茶', price: 1700, costPrice: 600 },
      { name: '芒果西米露', price: 1900, costPrice: 800 },
      { name: '红豆双皮奶', price: 1400, costPrice: 500 },
      { name: '提拉米苏', price: 2500, costPrice: 1200 },
      { name: '芝士蛋糕', price: 2300, costPrice: 1100 },
      { name: '芒果慕斯', price: 2400, costPrice: 1100 },
      { name: '焦糖布丁', price: 1600, costPrice: 600 },
      { name: '草莓奶昔', price: 2000, costPrice: 900 },
      { name: '抹茶拿铁', price: 2100, costPrice: 900 },
      { name: '冰美式', price: 1400, costPrice: 400 },
      { name: '鲜榨橙汁', price: 1800, costPrice: 700 },
    ],
  },
];

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
  } catch {}
}

async function resolveStoreId(phone) {
  const staff = await prisma.staff.findFirst({
    where: { phone },
    select: { storeId: true },
  });
  if (staff?.storeId) return staff.storeId;

  const emails = [
    `phone_${phone}@purelyprofit.local`,
    `profit_phone_${phone}@purelyprofit.local`,
  ];
  const user = await prisma.user.findFirst({
    where: { email: { in: emails } },
    select: {
      store: { select: { id: true } },
      staffMembership: { select: { storeId: true } },
    },
  });
  if (user?.store?.id) return user.store.id;
  if (user?.staffMembership?.storeId) return user.staffMembership.storeId;

  throw new Error(`未找到手机号 ${phone} 对应的门店`);
}

async function ensureCategory(storeId, name) {
  const existing = await prisma.productCategory.findFirst({
    where: { storeId, name, deletedAt: null },
    select: { id: true },
  });
  if (existing) return { id: existing.id, created: false };
  const created = await prisma.productCategory.create({
    data: { storeId, name },
    select: { id: true },
  });
  return { id: created.id, created: true };
}

async function ensureProduct(storeId, categoryId, categoryName, code, name, price, costPrice) {
  const existing = await prisma.product.findFirst({
    where: { storeId, code, deletedAt: null },
    select: { id: true },
  });
  if (existing) return false;

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
    },
  });
  return true;
}

async function main() {
  const storeId = await resolveStoreId(TARGET_PHONE);
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { id: true, name: true },
  });
  if (!store) throw new Error(`门店 ${storeId} 不存在`);

  console.log(`目标门店：${store.id} ${store.name}（手机号 ${TARGET_PHONE}）\n`);

  let createdCategories = 0;
  let createdProducts = 0;
  let skippedProducts = 0;

  for (let i = 0; i < CATEGORIES.length; i++) {
    const catData = CATEGORIES[i];
    const cat = await ensureCategory(storeId, catData.name);
    if (cat.created) createdCategories += 1;
    console.log(`分类「${catData.name}」${cat.created ? '已创建' : '已存在'} (id=${cat.id})`);

    for (let k = 0; k < catData.products.length; k++) {
      const prod = catData.products[k];
      const suffix = String.fromCharCode(65 + (k % 26));
      const code = `P${String(i + 1).padStart(2, '0')}-${suffix}`;
      const created = await ensureProduct(
        storeId,
        cat.id,
        catData.name,
        code,
        prod.name,
        prod.price,
        prod.costPrice,
      );
      if (created) {
        createdProducts += 1;
        console.log(`  + 「${prod.name}」¥${prod.price / 100}`);
      } else {
        skippedProducts += 1;
        console.log(`  = 「${prod.name}」已存在`);
      }
    }
    console.log('');
  }

  const totalCategories = await prisma.productCategory.count({
    where: { storeId, deletedAt: null },
  });
  const totalProducts = await prisma.product.count({
    where: { storeId, deletedAt: null },
  });

  console.log('========== 普通商品写入完成 ==========');
  console.log(`新增分类：${createdCategories} 个（门店现有分类 ${totalCategories} 个）`);
  console.log(
    `新增商品：${createdProducts} 个，跳过已存在 ${skippedProducts} 个（门店现有商品 ${totalProducts} 个）`,
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
  });

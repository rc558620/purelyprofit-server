/**
 * 为手机号 13919654040 的门店批量新增扫码点餐菜单数据：
 *   - 2 个分类
 *   - 30 个商品（其中 5 个带规格组）
 *
 * 写入逻辑严格对齐“商家手动新增”的服务端实现：
 *   src/purely-profit/operations/scan-ordering/scan-ordering-menu-category.service.ts
 *   src/purely-profit/operations/scan-ordering/scan-ordering-menu-product.service.ts
 *   src/purely-profit/operations/scan-ordering/scan-ordering-menu-spec.service.ts
 * 即只设置手动新增时 UI 会传的字段，其余字段全部走数据库默认值
 * （isActive=true、version=0、sortOrder=0、stockMode=unlimited、stockQuantity=null、
 *  selectionType=single、minSelections=1、maxSelections=null、isDefault=false 等）。
 *
 * 金额统一按“元”输入，落库按分（与 Money.fromInputYuan 一致，四舍五入）。
 *
 * 用法：
 *   node scripts/seed-scan-ordering-menu-13919654040.mjs
 *
 * 幂等：分类按 (storeId, name) 复用；商品按 (storeId, name) 跳过；
 * 已存在商品的规格组不再重复创建，重复运行不会产生脏数据。
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
  throw new Error('缺少 DATABASE_URL，无法写入菜单数据');
}

const pool = new Pool({ connectionString: databaseUrl });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const TARGET_PHONE = '13919654040';

/** 元 -> 分（与 Money.fromInputYuan 的四舍五入一致） */
function yuanToCents(yuan) {
  return Math.round(Number(yuan) * 100);
}

// ---- 菜单数据（仅描述手动新增时的核心字段） ----
const CATEGORIES = [
  {
    name: '招牌美食',
    sortOrder: 0,
    products: [
      { name: '招牌牛肉面', basePrice: 28 },
      { name: '番茄鸡蛋面', basePrice: 22 },
      { name: '红烧排骨饭', basePrice: 32 },
      { name: '黄焖鸡米饭', basePrice: 26 },
      { name: '宫保鸡丁饭', basePrice: 28, withSpec: true },
      { name: '鱼香肉丝饭', basePrice: 27 },
      { name: '麻辣香锅', basePrice: 38, withSpec: true },
      { name: '酸菜鱼', basePrice: 42 },
      { name: '水煮肉片', basePrice: 40 },
      { name: '回锅肉盖饭', basePrice: 30 },
      { name: '麻婆豆腐饭', basePrice: 24 },
      { name: '糖醋里脊饭', basePrice: 33 },
      { name: '咖喱牛肉饭', basePrice: 35 },
      { name: '照烧鸡腿饭', basePrice: 29 },
      { name: '黑椒牛柳饭', basePrice: 39 },
    ],
  },
  {
    name: '饮品甜点',
    sortOrder: 1,
    products: [
      { name: '招牌奶茶', basePrice: 16 },
      { name: '珍珠奶茶', basePrice: 18 },
      { name: '杨枝甘露', basePrice: 22, withSpec: true },
      { name: '柠檬蜂蜜茶', basePrice: 15 },
      { name: '百香果茶', basePrice: 17 },
      { name: '芒果西米露', basePrice: 19 },
      { name: '红豆双皮奶', basePrice: 14 },
      { name: '提拉米苏', basePrice: 25 },
      { name: '芝士蛋糕', basePrice: 23 },
      { name: '芒果慕斯', basePrice: 24 },
      { name: '焦糖布丁', basePrice: 16 },
      { name: '草莓奶昔', basePrice: 20 },
      { name: '抹茶拿铁', basePrice: 21, withSpec: true },
      { name: '冰美式', basePrice: 14 },
      { name: '鲜榨橙汁', basePrice: 18, withSpec: true },
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
      const value = trimmed
        .slice(eqIndex + 1)
        .trim()
        .replace(/^['"]|['"]$/g, '');
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // 忽略缺失 .env 的场景，后续按必填项兜底报错
  }
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

  throw new Error(`未找到手机号 ${phone} 对应的门店（staff.phone / user.email 均未匹配）`);
}

async function ensureCategory(storeId, name, sortOrder) {
  const existing = await prisma.scanOrderingMenuCategory.findFirst({
    where: { storeId, name, deletedAt: null },
    select: { id: true },
  });
  if (existing) return { id: existing.id, created: false };

  const created = await prisma.scanOrderingMenuCategory.create({
    data: { storeId, name, sortOrder: sortOrder ?? 0 },
    select: { id: true },
  });
  return { id: created.id, created: true };
}

async function ensureProduct(storeId, categoryId, name, basePrice) {
  const existing = await prisma.scanOrderingMenuProduct.findFirst({
    where: { storeId, name, deletedAt: null },
    select: { id: true, specGroups: { select: { id: true } } },
  });
  if (existing) {
    return { id: existing.id, created: false, hasSpecGroups: existing.specGroups.length > 0 };
  }

  const created = await prisma.scanOrderingMenuProduct.create({
    data: {
      storeId,
      categoryId,
      name,
      basePrice: yuanToCents(basePrice),
      stockMode: 'unlimited',
      stockQuantity: null,
    },
    select: { id: true },
  });
  return { id: created.id, created: true, hasSpecGroups: false };
}

async function ensureSpecGroup(productId, name) {
  const existing = await prisma.scanOrderingSpecGroup.findFirst({
    where: { menuProductId: productId, name },
    select: { id: true },
  });
  if (existing) return { id: existing.id, created: false };
  const created = await prisma.scanOrderingSpecGroup.create({
    data: { menuProductId: productId, name },
    select: { id: true },
  });
  return { id: created.id, created: true };
}

async function ensureSpecOption(groupId, name, extraPrice) {
  const existing = await prisma.scanOrderingSpecOption.findFirst({
    where: { groupId, name },
    select: { id: true },
  });
  if (existing) return false;
  await prisma.scanOrderingSpecOption.create({
    data: { groupId, name, extraPrice: yuanToCents(extraPrice ?? 0) },
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
  let createdSpecGroups = 0;
  let createdSpecOptions = 0;
  let specProductsTotal = 0;

  for (const category of CATEGORIES) {
    const cat = await ensureCategory(storeId, category.name, category.sortOrder);
    if (cat.created) createdCategories += 1;
    console.log(`分类「${category.name}」${cat.created ? '已创建' : '已存在'} (id=${cat.id})`);

    for (const product of category.products) {
      const prod = await ensureProduct(storeId, cat.id, product.name, product.basePrice);
      if (prod.created) {
        createdProducts += 1;
        console.log(`  + 商品「${product.name}」¥${product.basePrice} (id=${prod.id})`);
      } else {
        skippedProducts += 1;
        console.log(`  = 商品「${product.name}」已存在 (id=${prod.id})`);
      }

      if (product.withSpec) {
        specProductsTotal += 1;
        // 已存在且无规格组时，补建规格；新建商品必然无规格组
        if (!prod.hasSpecGroups) {
          const group = await ensureSpecGroup(prod.id, '规格');
          if (group.created) createdSpecGroups += 1;
          const options = [
            { name: '小份', extraPrice: 0 },
            { name: '中份', extraPrice: 2 },
            { name: '大份', extraPrice: 4 },
          ];
          for (const opt of options) {
            const added = await ensureSpecOption(group.id, opt.name, opt.extraPrice);
            if (added) createdSpecOptions += 1;
          }
          console.log(
            `    · 规格组「规格」${group.created ? '已创建' : '已存在'}，选项 +${options.length}（小份/中份/大份）`,
          );
        } else {
          console.log(`    · 规格组已存在，跳过`);
        }
      }
    }
    console.log('');
  }

  const totalCategories = await prisma.scanOrderingMenuCategory.count({
    where: { storeId, deletedAt: null },
  });
  const totalProducts = await prisma.scanOrderingMenuProduct.count({
    where: { storeId, deletedAt: null },
  });

  console.log('========== 菜单写入完成 ==========');
  console.log(`新增分类：${createdCategories} 个（门店现有分类 ${totalCategories} 个）`);
  console.log(
    `新增商品：${createdProducts} 个，跳过已存在 ${skippedProducts} 个（门店现有商品 ${totalProducts} 个）`,
  );
  console.log(`规格商品：${specProductsTotal} 个`);
  console.log(`新增规格组：${createdSpecGroups} 个，新增规格项：${createdSpecOptions} 个`);
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

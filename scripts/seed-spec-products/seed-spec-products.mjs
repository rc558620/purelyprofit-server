// 为账号 13619654022 的测试门店批量新增 10 个「带规格」的商品（Product + 规格宿主 + 规格组/选项）。
//
// 背景：非餐饮门店（推拿/美容）做自助下单 / 代客点单时，商品来自商品库（Product 表），
// 规格挂在「幽灵宿主」ScanOrderingMenuProduct（isActive=false）上，与餐饮共用一张表。
// 本脚本完全复刻后端「手动加商品」的写路径（products.service.create →
// products-scan-ordering-sync.syncSpecifications → createGhostMenuProduct），字段口径一致：
//   - price/costPrice/extraPrice 全部按「元」入参，落地为「分」；
//   - 利润 = 售价 − 成本价（服务端重算，须 > 0）；
//   - 商品分类按名称复用/创建（product_categories）；
//   - 规格宿主分类按名称复用/创建（scan_ordering_menu_categories）；
//   - 幽灵宿主 isActive=false（非餐饮不上架扫码点餐，仅承载规格）；
//   - 规格组为单选、必选 1 项，首选项默认选中；选项 isActive=true、stockQuantity 不写（恒为不限）。
//
// 幂等可重跑：同门店同名商品已存在则整体跳过（含规格）。
// 用法: node scripts/seed-spec-products/seed-spec-products.mjs
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const PHONE = '13619654022';

/** 元 → 分（与 Money.fromInputYuan 的四舍五入口径一致：HALF_UP，非负即 Math.round） */
const fen = (yuan) => Math.round(Number(yuan) * 100);

// 10 个常见非餐饮规格商品（推拿按摩 / 美容护肤），字段同手动加。
const SPEC_PRODUCTS = [
  // ---- 推拿按摩 ----
  {
    category: '推拿按摩',
    name: '经典中式推拿',
    price: 98,
    cost: 50,
    unit: '次',
    stock: 100,
    description: '传统中式推拿手法，疏通经络缓解全身疲劳',
    specGroups: [
      {
        name: '时长',
        selectMode: 'single',
        minSelect: 1,
        maxSelect: 1,
        options: [
          { name: '30分钟', priceDelta: 0, isDefault: true },
          { name: '60分钟', priceDelta: 50 },
          { name: '90分钟', priceDelta: 100 },
        ],
      },
      {
        name: '技师',
        selectMode: 'single',
        minSelect: 1,
        maxSelect: 1,
        options: [
          { name: '普通技师', priceDelta: 0, isDefault: true },
          { name: '高级技师', priceDelta: 30 },
          { name: '首席技师', priceDelta: 80 },
        ],
      },
    ],
  },
  {
    category: '推拿按摩',
    name: '泰式古法按摩',
    price: 128,
    cost: 70,
    unit: '次',
    stock: 80,
    description: '泰式拉伸配合穴位按压，舒展筋骨',
    specGroups: [
      {
        name: '时长',
        selectMode: 'single',
        minSelect: 1,
        maxSelect: 1,
        options: [
          { name: '60分钟', priceDelta: 0, isDefault: true },
          { name: '90分钟', priceDelta: 60 },
          { name: '120分钟', priceDelta: 120 },
        ],
      },
    ],
  },
  {
    category: '推拿按摩',
    name: '头部理疗SPA',
    price: 68,
    cost: 35,
    unit: '次',
    stock: 120,
    description: '头部穴位按摩配合精油，舒缓压力改善睡眠',
    specGroups: [
      {
        name: '时长',
        selectMode: 'single',
        minSelect: 1,
        maxSelect: 1,
        options: [
          { name: '30分钟', priceDelta: 0, isDefault: true },
          { name: '45分钟', priceDelta: 30 },
        ],
      },
    ],
  },
  {
    category: '推拿按摩',
    name: '肩颈舒缓按摩',
    price: 58,
    cost: 30,
    unit: '次',
    stock: 150,
    description: '重点舒缓肩颈紧绷肌群，久坐人群首选',
    specGroups: [
      {
        name: '技师',
        selectMode: 'single',
        minSelect: 1,
        maxSelect: 1,
        options: [
          { name: '普通技师', priceDelta: 0, isDefault: true },
          { name: '高级技师', priceDelta: 20 },
          { name: '首席技师', priceDelta: 50 },
        ],
      },
    ],
  },
  {
    category: '推拿按摩',
    name: '足底养生按摩',
    price: 88,
    cost: 45,
    unit: '次',
    stock: 90,
    description: '中药足浴搭配足底反射按摩，活血养生',
    specGroups: [
      {
        name: '时长',
        selectMode: 'single',
        minSelect: 1,
        maxSelect: 1,
        options: [
          { name: '40分钟', priceDelta: 0, isDefault: true },
          { name: '60分钟', priceDelta: 40 },
        ],
      },
      {
        name: '力度',
        selectMode: 'single',
        minSelect: 1,
        maxSelect: 1,
        options: [
          { name: '标准', priceDelta: 0, isDefault: true },
          { name: '加重', priceDelta: 15 },
        ],
      },
    ],
  },
  // ---- 美容护肤 ----
  {
    category: '美容护肤',
    name: '深层清洁护理',
    price: 88,
    cost: 45,
    unit: '次',
    stock: 80,
    description: '温和清洁毛孔，去除黑头粉刺',
    specGroups: [
      {
        name: '时长',
        selectMode: 'single',
        minSelect: 1,
        maxSelect: 1,
        options: [
          { name: '40分钟', priceDelta: 0, isDefault: true },
          { name: '60分钟', priceDelta: 40 },
        ],
      },
    ],
  },
  {
    category: '美容护肤',
    name: '玻尿酸补水导入',
    price: 168,
    cost: 90,
    unit: '次',
    stock: 60,
    description: '玻尿酸仪器导入，深层补水锁水',
    specGroups: [
      {
        name: '强度',
        selectMode: 'single',
        minSelect: 1,
        maxSelect: 1,
        options: [
          { name: '基础', priceDelta: 0, isDefault: true },
          { name: '加强', priceDelta: 50 },
          { name: '至臻', priceDelta: 100 },
        ],
      },
    ],
  },
  {
    category: '美容护肤',
    name: '全脸抗衰护理',
    price: 198,
    cost: 110,
    unit: '次',
    stock: 50,
    description: '射频提拉搭配抗皱精华，紧致轮廓',
    specGroups: [
      {
        name: '时长',
        selectMode: 'single',
        minSelect: 1,
        maxSelect: 1,
        options: [
          { name: '60分钟', priceDelta: 0, isDefault: true },
          { name: '90分钟', priceDelta: 80 },
        ],
      },
    ],
  },
  {
    category: '美容护肤',
    name: '精致美甲',
    price: 68,
    cost: 30,
    unit: '次',
    stock: 100,
    description: '基础护理配合款式绘制，指尖焕新',
    specGroups: [
      {
        name: '款式',
        selectMode: 'single',
        minSelect: 1,
        maxSelect: 1,
        options: [
          { name: '简约纯色', priceDelta: 0, isDefault: true },
          { name: '法式', priceDelta: 30 },
          { name: '穿戴甲', priceDelta: 50 },
        ],
      },
    ],
  },
  {
    category: '美容护肤',
    name: '全身焕肤SPA',
    price: 228,
    cost: 130,
    unit: '次',
    stock: 40,
    description: '全身磨砂焕肤，肌肤如新生',
    specGroups: [
      {
        name: '时长',
        selectMode: 'single',
        minSelect: 1,
        maxSelect: 1,
        options: [
          { name: '60分钟', priceDelta: 0, isDefault: true },
          { name: '90分钟', priceDelta: 80 },
        ],
      },
      {
        name: '部位',
        selectMode: 'single',
        minSelect: 1,
        maxSelect: 1,
        options: [
          { name: '全身', priceDelta: 0, isDefault: true },
          { name: '局部', priceDelta: 40 },
        ],
      },
    ],
  },
];

/** 商品分类按名称复用/创建（对应 ensureProductCategory） */
async function ensureProductCategory(storeId, name) {
  const trimmed = name.trim();
  const existing = await prisma.productCategory.findFirst({
    where: { storeId, name: trimmed, deletedAt: null },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await prisma.productCategory.create({
    data: { storeId, name: trimmed, icon: null },
    select: { id: true },
  });
  return created.id;
}

/** 扫码菜单分类按名称复用/创建（对应 ProductsScanOrderingSyncService.resolveCategory） */
async function ensureMenuCategory(storeId, name) {
  const trimmed = name.trim();
  const existing = await prisma.scanOrderingMenuCategory.findFirst({
    where: { storeId, name: trimmed, deletedAt: null },
    select: { id: true },
  });
  if (existing) return existing.id;
  const last = await prisma.scanOrderingMenuCategory.findFirst({
    where: { storeId, deletedAt: null },
    orderBy: [{ sortOrder: 'desc' }, { id: 'desc' }],
    select: { sortOrder: true },
  });
  const created = await prisma.scanOrderingMenuCategory.create({
    data: {
      storeId,
      name: trimmed || '默认分类',
      sortOrder: (last?.sortOrder ?? -1) + 1,
    },
    select: { id: true },
  });
  return created.id;
}

/** 生成唯一商品编号（对应 resolveProductCode 的缺省分支） */
async function resolveProductCode(storeId) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const generated = `PRD${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const conflict = await prisma.product.findFirst({
      where: { storeId, code: generated, deletedAt: null },
      select: { id: true },
    });
    if (!conflict) return generated;
  }
  throw new Error('商品编号生成失败');
}

/** 尽力失效扫码菜单缓存（对应 ProductsScanOrderingSyncService.invalidateCache） */
async function invalidateMenuCache(storeId) {
  if (!process.env.REDIS_URL) return;
  try {
    const Ioredis = (await import('ioredis')).default;
    const redis = new Ioredis(process.env.REDIS_URL);
    await redis.del(`scanordering:menu:${storeId}`);
    await redis.quit();
  } catch (e) {
    console.warn('  ! 缓存失效失败（忽略）:', e?.message ?? e);
  }
}

async function main() {
  const staff = await prisma.staff.findFirst({ where: { phone: PHONE } });
  if (!staff) throw new Error(`未找到 staff (phone=${PHONE})`);
  const storeId = staff.storeId;
  console.log(`staff: id=${staff.id} storeId=${storeId} role=${staff.role}`);

  const existingProducts = await prisma.product.findMany({
    where: { storeId, deletedAt: null },
    select: { id: true, name: true },
  });
  const existingByName = new Map(existingProducts.map((p) => [p.name, p.id]));
  console.log(`门店 ${storeId} 现有商品 ${existingProducts.length} 个`);

  let created = 0;
  let skipped = 0;

  for (const item of SPEC_PRODUCTS) {
    if (existingByName.has(item.name)) {
      skipped += 1;
      console.log(`  = 跳过已存在: ${item.name} (id=${existingByName.get(item.name)})`);
      continue;
    }

    const priceCents = fen(item.price);
    const costCents = fen(item.cost);
    const profitCents = priceCents - costCents;
    if (profitCents <= 0) {
      throw new Error(`利润须 > 0: ${item.name} (售价¥${item.price} 成本价¥${item.cost})`);
    }

    const categoryId = await ensureProductCategory(storeId, item.category);
    const code = await resolveProductCode(storeId);

    // 1) 商品库记录（对应 createProductRecord + buildCreateProductData）
    const product = await prisma.product.create({
      data: {
        storeId,
        categoryId,
        category: item.category.trim(),
        code,
        name: item.name.trim(),
        price: priceCents,
        profit: profitCents,
        costPrice: costCents,
        unit: item.unit,
        stock: item.stock ?? 0,
        alertThreshold: 10,
        image: null,
        description: item.description ?? null,
        isActive: true,
      },
      select: { id: true },
    });

    // 2) 幽灵宿主（对应 createGhostMenuProduct，isActive=false）
    const menuCategoryId = await ensureMenuCategory(storeId, item.category);
    const ghost = await prisma.scanOrderingMenuProduct.create({
      data: {
        storeId,
        productId: product.id,
        categoryId: menuCategoryId,
        name: item.name.trim(),
        imageUrl: null,
        basePrice: priceCents,
        isActive: false,
      },
      select: { id: true },
    });

    // 3) 规格组 + 选项（对应 syncSpecifications 的物理写入部分）
    await prisma.scanOrderingSpecGroup.createMany({
      data: item.specGroups.map((group, gi) => ({
        menuProductId: ghost.id,
        name: group.name.trim(),
        selectionType: group.selectMode === 'multi' ? 'multiple' : 'single',
        minSelections: group.minSelect,
        maxSelections: group.maxSelect,
        sortOrder: gi,
      })),
    });
    const dbGroups = await prisma.scanOrderingSpecGroup.findMany({
      where: { menuProductId: ghost.id },
      orderBy: { sortOrder: 'asc' },
      select: { id: true },
    });
    await prisma.scanOrderingSpecOption.createMany({
      data: item.specGroups.flatMap((group, gi) =>
        group.options.map((option, oi) => ({
          groupId: dbGroups[gi].id,
          name: option.name.trim(),
          extraPrice: fen(option.priceDelta),
          stockQuantity: null,
          sortOrder: oi,
          isDefault: option.isDefault ?? false,
          isActive: option.isActive ?? true,
        })),
      ),
    });

    created += 1;
    const specSummary = item.specGroups
      .map((g) => `${g.name}[${g.options.map((o) => o.name).join('/')}]`)
      .join(' ');
    console.log(
      `  + 规格商品: ${item.name} (商品id=${product.id}, 宿主id=${ghost.id}, ¥${item.price}, ${item.category}) ${specSummary}`,
    );
  }

  await invalidateMenuCache(storeId);

  const finalTotal = await prisma.product.count({ where: { storeId, deletedAt: null } });
  console.log('--- 汇总 ---');
  console.log(`新增规格商品 ${created} 个, 跳过已存在 ${skipped} 个`);
  console.log(`门店 ${storeId} 现有商品共 ${finalTotal} 个（新增前 ${existingProducts.length} 个）`);
}

try {
  await main();
} catch (e) {
  console.error('错误:', e);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
  await pool.end();
}

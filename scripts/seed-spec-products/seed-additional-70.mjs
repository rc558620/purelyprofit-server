// 为账号 13619654022 的测试门店再批量新增 70 个商品（其中 10 个带规格），
// 并创建 5 个「新分类」。复用 license 内「手动加商品」的写路径，字段口径与手动加一致：
//   - price/costPrice 按「元」入参落地为「分」，利润 = 售价 − 成本价（>0）；
//   - 商品分类按名称复用/创建；规格宿主分类按名称复用/创建；
//   - 规格商品：幽灵宿主 ScanOrderingMenuProduct(isActive=false) + 规格组/选项；
//   - 非规格商品：仅写入商品库 Product（与手动加非规格商品一致，不建幽灵宿主）。
//
// 幂等可重跑：同门店同名商品已存在则整体跳过（含规格）。
// 用法: node scripts/seed-spec-products/seed-additional-70.mjs
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const PHONE = '13619654022';

/** 元 → 分（与 Money.fromInputYuan 口径一致：HALF_UP，非负即 Math.round） */
const fen = (yuan) => Math.round(Number(yuan) * 100);

// 5 个新分类，每类 14 个商品（12 普通 + 2 规格），共 70。
// 普通商品只需基础字段；规格商品带 specGroups（单选必选、首选项默认、选项 stockQuantity 不写）。
const CATEGORY_PLAN = [
  {
    category: '美甲美睫',
    plain: [
      { name: '基础修甲', price: 39, cost: 15 },
      { name: '手部护理', price: 49, cost: 20 },
      { name: '脚趾美甲', price: 79, cost: 35 },
      { name: '光疗延长甲', price: 158, cost: 80 },
      { name: '手足护理套餐', price: 128, cost: 60 },
      { name: '卸甲服务', price: 20, cost: 8 },
      { name: '甲片修补', price: 30, cost: 12 },
      { name: '睫毛清洁', price: 25, cost: 10 },
      { name: '美睫嫁接', price: 198, cost: 90 },
      { name: '下睫毛加密', price: 98, cost: 45 },
      { name: '眉毛塑形', price: 58, cost: 25 },
      { name: '半永久纹眉', price: 388, cost: 180 },
    ],
    spec: [
      {
        name: '日式美甲',
        price: 168,
        cost: 80,
        specGroups: [
          {
            name: '款式',
            selectMode: 'single',
            minSelect: 1,
            maxSelect: 1,
            options: [
              { name: '简约纯色', priceDelta: 0, isDefault: true },
              { name: '法式', priceDelta: 30 },
              { name: '钻饰款', priceDelta: 80 },
            ],
          },
          {
            name: '时长',
            selectMode: 'single',
            minSelect: 1,
            maxSelect: 1,
            options: [
              { name: '60分钟', priceDelta: 0, isDefault: true },
              { name: '90分钟', priceDelta: 50 },
            ],
          },
        ],
      },
      {
        name: '孕睫术养护',
        price: 128,
        cost: 60,
        specGroups: [
          {
            name: '护理次数',
            selectMode: 'single',
            minSelect: 1,
            maxSelect: 1,
            options: [
              { name: '单次', priceDelta: 0, isDefault: true },
              { name: '疗程10次', priceDelta: 880 },
            ],
          },
        ],
      },
    ],
  },
  {
    category: '头皮养护',
    plain: [
      { name: '头部放松', price: 45, cost: 18 },
      { name: '毛囊检测', price: 29, cost: 10 },
      { name: '洗发护理', price: 38, cost: 15 },
      { name: '头皮去屑', price: 58, cost: 25 },
      { name: '发膜滋养', price: 68, cost: 30 },
      { name: '烫后修护', price: 88, cost: 40 },
      { name: '染后固色', price: 78, cost: 35 },
      { name: '男士理容', price: 48, cost: 20 },
      { name: '白发养护', price: 98, cost: 45 },
      { name: '头皮注氧', price: 128, cost: 60 },
      { name: '防脱理疗', price: 158, cost: 75 },
      { name: '养发套餐', price: 228, cost: 110 },
    ],
    spec: [
      {
        name: '头皮深层清洁',
        price: 98,
        cost: 45,
        specGroups: [
          {
            name: '方案',
            selectMode: 'single',
            minSelect: 1,
            maxSelect: 1,
            options: [
              { name: '基础', priceDelta: 0, isDefault: true },
              { name: '加强', priceDelta: 50 },
            ],
          },
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
        name: '头发养护SPA',
        price: 168,
        cost: 80,
        specGroups: [
          {
            name: '发质',
            selectMode: 'single',
            minSelect: 1,
            maxSelect: 1,
            options: [
              { name: '干性', priceDelta: 0, isDefault: true },
              { name: '油性', priceDelta: 0 },
              { name: '受损', priceDelta: 20 },
            ],
          },
          {
            name: '时长',
            selectMode: 'single',
            minSelect: 1,
            maxSelect: 1,
            options: [
              { name: '30分钟', priceDelta: 0, isDefault: true },
              { name: '60分钟', priceDelta: 60 },
            ],
          },
        ],
      },
    ],
  },
  {
    category: '身体SPA',
    plain: [
      { name: '背部舒缓', price: 68, cost: 30 },
      { name: '腿部放松', price: 58, cost: 25 },
      { name: '手臂按摩', price: 48, cost: 20 },
      { name: '精油开背', price: 88, cost: 40 },
      { name: '淋巴排毒', price: 118, cost: 55 },
      { name: '芳香泡浴', price: 138, cost: 65 },
      { name: '磨砂焕肤', price: 98, cost: 45 },
      { name: '妊娠纹修护', price: 158, cost: 75 },
      { name: '温感石疗', price: 168, cost: 80 },
      { name: '私密养护', price: 188, cost: 90 },
      { name: '香薰足浴', price: 58, cost: 25 },
      { name: '身体乳保养', price: 48, cost: 20 },
    ],
    spec: [
      {
        name: '全身精油SPA',
        price: 228,
        cost: 110,
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
            name: '力度',
            selectMode: 'single',
            minSelect: 1,
            maxSelect: 1,
            options: [
              { name: '标准', priceDelta: 0, isDefault: true },
              { name: '加重', priceDelta: 30 },
            ],
          },
        ],
      },
      {
        name: '热石理疗',
        price: 198,
        cost: 95,
        specGroups: [
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
          {
            name: '时长',
            selectMode: 'single',
            minSelect: 1,
            maxSelect: 1,
            options: [
              { name: '60分钟', priceDelta: 0, isDefault: true },
              { name: '90分钟', priceDelta: 60 },
            ],
          },
        ],
      },
    ],
  },
  {
    category: '采耳养生',
    plain: [
      { name: '耳部清洁', price: 38, cost: 15 },
      { name: '头部推拿', price: 58, cost: 25 },
      { name: '肩颈放松', price: 48, cost: 20 },
      { name: '耳穴压豆', price: 28, cost: 10 },
      { name: '鼻腔舒缓', price: 42, cost: 18 },
      { name: '面部拨筋', price: 68, cost: 30 },
      { name: '睡眠调理', price: 88, cost: 40 },
      { name: '肩背刮痧', price: 78, cost: 35 },
      { name: '足底反射', price: 66, cost: 30 },
      { name: '艾灸养生', price: 98, cost: 45 },
      { name: '拔罐理疗', price: 88, cost: 40 },
      { name: '养生套餐', price: 188, cost: 90 },
    ],
    spec: [
      {
        name: '精致采耳',
        price: 68,
        cost: 30,
        specGroups: [
          {
            name: '套餐',
            selectMode: 'single',
            minSelect: 1,
            maxSelect: 1,
            options: [
              { name: '基础', priceDelta: 0, isDefault: true },
              { name: '尊享', priceDelta: 40 },
            ],
          },
          {
            name: '时长',
            selectMode: 'single',
            minSelect: 1,
            maxSelect: 1,
            options: [
              { name: '30分钟', priceDelta: 0, isDefault: true },
              { name: '45分钟', priceDelta: 20 },
            ],
          },
        ],
      },
      {
        name: '鼻腔SPA',
        price: 88,
        cost: 40,
        specGroups: [
          {
            name: '方案',
            selectMode: 'single',
            minSelect: 1,
            maxSelect: 1,
            options: [
              { name: '基础', priceDelta: 0, isDefault: true },
              { name: '加强', priceDelta: 30 },
            ],
          },
        ],
      },
    ],
  },
  {
    category: '香薰疗愈',
    plain: [
      { name: '单方精油', price: 88, cost: 40 },
      { name: '复方精油', price: 98, cost: 45 },
      { name: '香薰扩香', price: 38, cost: 15 },
      { name: '情绪舒缓', price: 68, cost: 30 },
      { name: '助眠疗愈', price: 88, cost: 40 },
      { name: '元气唤醒', price: 78, cost: 35 },
      { name: '肩颈热敷', price: 58, cost: 25 },
      { name: '暖宫养护', price: 98, cost: 45 },
      { name: '手足温熏', price: 68, cost: 30 },
      { name: '香氛泡浴球', price: 28, cost: 10 },
      { name: '疗愈礼盒', price: 168, cost: 80 },
      { name: '会员体验', price: 198, cost: 95 },
    ],
    spec: [
      {
        name: '香薰精油按摩',
        price: 188,
        cost: 90,
        specGroups: [
          {
            name: '香型',
            selectMode: 'single',
            minSelect: 1,
            maxSelect: 1,
            options: [
              { name: '薰衣草', priceDelta: 0, isDefault: true },
              { name: '柑橘', priceDelta: 0 },
              { name: '檀香', priceDelta: 20 },
            ],
          },
          {
            name: '时长',
            selectMode: 'single',
            minSelect: 1,
            maxSelect: 1,
            options: [
              { name: '60分钟', priceDelta: 0, isDefault: true },
              { name: '90分钟', priceDelta: 60 },
            ],
          },
        ],
      },
      {
        name: '音钵疗愈',
        price: 158,
        cost: 75,
        specGroups: [
          {
            name: '时长',
            selectMode: 'single',
            minSelect: 1,
            maxSelect: 1,
            options: [
              { name: '45分钟', priceDelta: 0, isDefault: true },
              { name: '60分钟', priceDelta: 40 },
            ],
          },
          {
            name: '等级',
            selectMode: 'single',
            minSelect: 1,
            maxSelect: 1,
            options: [
              { name: '标准', priceDelta: 0, isDefault: true },
              { name: '深度', priceDelta: 50 },
            ],
          },
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
  let createdSpec = 0;
  let createdCategories = 0;
  const newCategoryNames = new Set();
  let skipped = 0;

  for (const plan of CATEGORY_PLAN) {
    const all = [
      ...plan.plain.map((p) => ({ ...p, category: plan.category })),
      ...plan.spec.map((p) => ({ ...p, category: plan.category })),
    ];

    for (const item of all) {
      if (existingByName.has(item.name)) {
        skipped += 1;
        console.log(`  = 跳过已存在: ${item.name}`);
        continue;
      }

      const priceCents = fen(item.price);
      const costCents = fen(item.cost);
      const profitCents = priceCents - costCents;
      if (profitCents <= 0) {
        throw new Error(`利润须 > 0: ${item.name} (售价¥${item.price} 成本价¥${item.cost})`);
      }

      const categoryId = await ensureProductCategory(storeId, item.category);
      if (!newCategoryNames.has(item.category)) {
        newCategoryNames.add(item.category);
      }
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
          unit: item.unit ?? '次',
          stock: item.stock ?? 50,
          alertThreshold: 10,
          image: null,
          description: item.description ?? `${item.name}，舒适体验`,
          isActive: true,
        },
        select: { id: true },
      });

      created += 1;

      // 2) 规格商品：幽灵宿主 + 规格组/选项（对应 createGhostMenuProduct + syncSpecifications）
      if (item.specGroups?.length) {
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

        createdSpec += 1;
        const specSummary = item.specGroups
          .map((g) => `${g.name}[${g.options.map((o) => o.name).join('/')}]`)
          .join(' ');
        console.log(
          `  + 规格商品: ${item.name} (商品id=${product.id}, 宿主id=${ghost.id}, ¥${item.price}, ${item.category}) ${specSummary}`,
        );
      } else {
        console.log(
          `  + 普通商品: ${item.name} (商品id=${product.id}, ¥${item.price}, ${item.category})`,
        );
      }
    }
  }

  await invalidateMenuCache(storeId);

  const finalTotal = await prisma.product.count({ where: { storeId, deletedAt: null } });
  console.log('--- 汇总 ---');
  console.log(`新增商品 ${created} 个 (其中规格商品 ${createdSpec} 个), 跳过已存在 ${skipped} 个`);
  console.log(`新增分类 ${newCategoryNames.size} 个: ${[...newCategoryNames].join('、')}`);
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

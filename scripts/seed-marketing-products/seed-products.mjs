// 为账号 13619654040 的餐饮门店 (storeId=37) 批量创建"普通商品"(Product)，并关联上架到扫码点餐菜单。
// 背景：扫码菜单商品已存在（productId=null，独立创建），但"商品管理"页 product-list 查询的是普通商品表
// （Product），门店 37 普通商品为 0，因此前端看不到商品。
// 方案：从 DB 现有扫码菜单分类/商品反推，对每个菜单商品：
//   1) 经 ProductsService.create() 创建普通商品（走真实业务逻辑：权限→配额→利润推导→分类→编号→入库）；
//   2) 将现有菜单商品绑定 productId（复用菜单商品，保留规格/库存等数据，避免重建）；
//   3) 调 ProductsScanOrderingSyncService.enable() 走真实上架逻辑（幂等：已关联则更新 isActive/categoryId/basePrice）。
// 幂等可重跑：普通商品已存在（同名）或菜单商品已绑定则跳过创建/绑定，仅做上架确认。
import 'dotenv/config';
import { createRequire } from 'node:module';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import Redis from 'ioredis';

const require = createRequire(import.meta.url);

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const { AccessControlService } = require('../../dist/src/purely-profit/access-control/access-control.service.js');
const { CommerceAccessService } = require('../../dist/src/purely-profit/commerce/commerce-access.service.js');
const { PlatformMembershipAccessService } = require('../../dist/src/purely-profit/member/platform-membership/platform-membership-access.service.js');
const { ProductsService } = require('../../dist/src/purely-profit/goods/products/products.service.js');
const { ProductsScanOrderingSyncService } = require('../../dist/src/purely-profit/goods/products/products-scan-ordering-sync.service.js');

const PHONE = '13619654040';

let redis;

/** 按分类/商品名推导普通商品单位 */
function resolveUnit(categoryName, productName) {
  if (categoryName === '饮品') {
    return ['可乐', '雪碧', '王老吉'].includes(productName) ? '瓶' : '杯';
  }
  if (categoryName === '酒水') return '瓶';
  if (categoryName === '烧烤') return '串';
  return '份';
}

async function main() {
  const staff = await prisma.staff.findFirst({ where: { phone: PHONE } });
  if (!staff) throw new Error(`未找到 staff (phone=${PHONE})`);
  console.log(`staff: id=${staff.id} storeId=${staff.storeId} role=${staff.role}`);

  const store = await prisma.store.findUnique({
    where: { id: staff.storeId },
    select: { id: true, name: true, businessMode: true },
  });
  if (!store) throw new Error(`门店不存在 storeId=${staff.storeId}`);
  console.log(`store: ${JSON.stringify(store)}`);
  if (store.businessMode !== 'catering') {
    throw new Error('仅餐饮门店支持扫码点餐上架');
  }

  // 与 JWT 鉴权链一致的 membership 上下文（同 seed-scan-menu.mjs）
  const accessControlService = new AccessControlService();
  const membership = accessControlService.buildMembershipContext(
    {
      id: staff.id,
      storeId: staff.storeId,
      role: staff.role,
      permissions: staff.permissions,
      isActive: staff.isActive,
      linkedEmployeeId: null,
    },
    null,
    'catering',
  );
  const user = { currentMembership: membership };

  const commerceAccessService = new CommerceAccessService(accessControlService);
  const platformMembershipAccessService = new PlatformMembershipAccessService(prisma);

  // Redis 薄封装：enable() 内部 invalidateCache 会 del 菜单缓存，顺带做真实清理
  redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: Number.parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    db: Number.parseInt(process.env.REDIS_DB || '0', 10),
    maxRetriesPerRequest: 1,
  });
  const redisSafe = {
    del: async (key) => {
      try {
        await redis.del(key);
      } catch {
        /* redis 不可用时静默降级 */
      }
    },
  };

  const scanOrderingSyncService = new ProductsScanOrderingSyncService(
    prisma,
    redisSafe,
  );
  // create() 路径不读取 config，仅 list() 需要，mock 即可
  const configMock = { get: () => undefined };
  const productsService = new ProductsService(
    prisma,
    configMock,
    commerceAccessService,
    platformMembershipAccessService,
    scanOrderingSyncService,
  );

  const storeId = staff.storeId;

  // 读取现有扫码菜单分类与商品（数据源：DB 反推，保证与菜单 1:1）
  const menuCategories = await prisma.scanOrderingMenuCategory.findMany({
    where: { storeId, deletedAt: null },
    select: { id: true, name: true },
    orderBy: { sortOrder: 'asc' },
  });
  const menuProducts = await prisma.scanOrderingMenuProduct.findMany({
    where: { storeId, deletedAt: null },
    select: {
      id: true,
      name: true,
      categoryId: true,
      basePrice: true,
      stockMode: true,
      stockQuantity: true,
      productId: true,
    },
    orderBy: { id: 'asc' },
  });
  console.log(`当前菜单: 分类 ${menuCategories.length} 个, 商品 ${menuProducts.length} 个`);
  if (menuProducts.length === 0) {
    console.warn('菜单无商品，无可同步项，退出');
    return;
  }
  const categoryNameById = new Map(menuCategories.map((c) => [c.id, c.name]));

  // 现有普通商品（name -> id），用于幂等跳过
  const existingProducts = await prisma.product.findMany({
    where: { storeId, deletedAt: null },
    select: { id: true, name: true },
  });
  const productIdByName = new Map(existingProducts.map((p) => [p.name, p.id]));
  console.log(`当前普通商品: ${existingProducts.length} 个`);

  let created = 0;
  let reused = 0;
  let bound = 0;
  let enabled = 0;

  for (const menu of menuProducts) {
    const categoryName = categoryNameById.get(menu.categoryId);
    if (!categoryName) {
      console.warn(`  ! 跳过无分类商品: ${menu.name}`);
      continue;
    }

    // 1) 解析/创建普通商品
    let productId = menu.productId;
    if (productId != null) {
      const boundProduct = await prisma.product.findUnique({
        where: { id: productId },
        select: { id: true },
      });
      if (!boundProduct) productId = null;
    }
    if (productId == null) {
      productId = productIdByName.get(menu.name) ?? null;
      if (productId != null) {
        const stillExists = await prisma.product.findUnique({
          where: { id: productId },
          select: { id: true },
        });
        if (!stillExists) productId = null;
      }
    }
    if (productId == null) {
      const unit = resolveUnit(categoryName, menu.name);
      const dto = {
        storeId,
        name: menu.name,
        category: categoryName,
        price: menu.basePrice / 100,
        unit,
        stock:
          menu.stockMode === 'finite' && menu.stockQuantity != null
            ? menu.stockQuantity
            : 0,
      };
      const createdProduct = await productsService.create(user, dto);
      productId = Number(createdProduct.id);
      productIdByName.set(menu.name, productId);
      created += 1;
      console.log(
        `  + 普通商品: ${menu.name} (id=${productId}, ¥${menu.basePrice / 100}, ${categoryName}/${unit})`,
      );
    } else {
      reused += 1;
    }

    // 2) 绑定菜单商品 -> 普通商品（复用菜单商品，不重建）
    if (menu.productId == null) {
      const bind = await prisma.scanOrderingMenuProduct.updateMany({
        where: { storeId, id: menu.id, productId: null, deletedAt: null },
        data: { productId },
      });
      if (bind.count > 0) {
        bound += 1;
        console.log(`  ~ 绑定菜单商品 #${menu.id}: ${menu.name} -> product#${productId}`);
      }
    }

    // 3) 走真实上架逻辑（幂等）
    const record = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, storeId: true, name: true, category: true, price: true, image: true },
    });
    if (!record) throw new Error(`商品记录不存在 id=${productId}`);
    await scanOrderingSyncService.enable(record, menu.categoryId);
    enabled += 1;
  }

  // 清理扫码菜单缓存
  try {
    await redis.del(`scanordering:menu:${storeId}`);
    console.log('已清理扫码菜单缓存 scanordering:menu:' + storeId);
  } catch {
    /* ignore */
  }

  const finalProducts = await prisma.product.count({
    where: { storeId, deletedAt: null },
  });
  const linked = await prisma.scanOrderingMenuProduct.count({
    where: { storeId, productId: { not: null }, deletedAt: null },
  });
  console.log('--- 汇总 ---');
  console.log(
    `新增普通商品 ${created} 个, 复用已有 ${reused} 个, 绑定菜单商品 ${bound} 个, 上架确认 ${enabled} 个`,
  );
  console.log(
    `门店 ${store.name}(id=${storeId}) 现有普通商品 ${finalProducts} 个, 已关联菜单商品 ${linked} 个`,
  );
}

main()
  .catch((e) => {
    console.error('错误:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
    redis?.disconnect();
  });

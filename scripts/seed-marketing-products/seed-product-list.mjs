// 以 SEED 数据源为账号 13619654040 的门店 (storeId=37) 重新录入"商品管理页"链路。
// 与手动录入效果一致：
//   1) 经 ProductsService.create() 创建普通商品（Product，product-list 的数据源）：
//      权限校验 → 会员配额 → 利润推导 → ensureProductCategory 建普通分类 → 自动编号 → 入库；
//   2) 对每个普通商品调 ProductsScanOrderingSyncService.enable(product, menuCategoryId) 走真实上架逻辑：
//      无同名菜单商品时自动创建并绑定 productId；有则 update 复用（1:1，不重建）。
// 幂等可重跑：普通商品同名已存在则复用，菜单商品已绑定则跳过创建。
// 用法: node scripts/seed-marketing-products/seed-product-list.mjs
import 'dotenv/config';
import { createRequire } from 'node:module';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import Redis from 'ioredis';
import { SEED } from './seed-data.mjs';

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

/** 与手动录入一致的单位推导（沿用 seed-products.mjs） */
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
  const storeId = staff.storeId;
  console.log(`staff: id=${staff.id} storeId=${storeId} role=${staff.role}`);

  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { id: true, name: true, businessMode: true },
  });
  if (!store) throw new Error(`门店不存在 storeId=${storeId}`);
  console.log(`store: ${JSON.stringify(store)}`);
  if (store.businessMode !== 'catering') {
    throw new Error('仅餐饮门店支持扫码点餐上架');
  }

  // 与 JWT 鉴权链一致的 membership 上下文
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

  const scanOrderingSyncService = new ProductsScanOrderingSyncService(prisma, redisSafe);
  const configMock = { get: () => undefined };
  const productsService = new ProductsService(
    prisma,
    configMock,
    commerceAccessService,
    platformMembershipAccessService,
    scanOrderingSyncService,
  );

  // 现有普通商品（name -> id）与已绑定菜单商品（productId -> 菜单id），用于幂等
  const existingProducts = await prisma.product.findMany({
    where: { storeId, deletedAt: null },
    select: { id: true, name: true },
  });
  const productIdByName = new Map(existingProducts.map((p) => [p.name, p.id]));
  const boundMenu = await prisma.scanOrderingMenuProduct.findMany({
    where: { storeId, productId: { not: null }, deletedAt: null },
    select: { id: true, productId: true },
  });
  const menuIdByProductId = new Map(boundMenu.map((m) => [m.productId, m.id]));
  console.log(
    `当前: 普通商品 ${existingProducts.length} 个, 已绑定菜单商品 ${boundMenu.length} 个`,
  );

  let created = 0;
  let reused = 0;
  let enabled = 0;
  let menuCreated = 0;

  for (const category of SEED) {
    // 先解析/创建菜单分类，保持与 SEED 的 sortOrder 顺序一致
    const menuCategory = await scanOrderingSyncService.resolveCategory(
      storeId,
      category.name,
    );

    for (const item of category.products) {
      // 1) 解析/创建普通商品（product-list 数据源）
      let productId = productIdByName.get(item.name) ?? null;
      if (productId != null) {
        const stillExists = await prisma.product.findUnique({
          where: { id: productId },
          select: { id: true },
        });
        if (!stillExists) productId = null;
      }
      if (productId == null) {
        const unit = resolveUnit(category.name, item.name);
        const dto = {
          storeId,
          name: item.name,
          category: category.name,
          price: item.basePrice,
          unit,
          stock: item.stockMode === 'finite' ? item.stockQuantity : 0,
        };
        const createdProduct = await productsService.create(user, dto);
        productId = Number(createdProduct.id);
        productIdByName.set(item.name, productId);
        created += 1;
        console.log(
          `  + 普通商品: ${item.name} (id=${productId}, ¥${item.basePrice}, ${category.name}/${unit}, stock=${dto.stock})`,
        );
      } else {
        reused += 1;
      }

      // 2) 走真实上架逻辑：enable() 自动创建/绑定菜单商品（1:1）
      if (menuIdByProductId.has(productId)) {
        // 已绑定，仅做上架确认
        await scanOrderingSyncService.enable(
          await prisma.product.findUnique({
            where: { id: productId },
            select: {
              id: true,
              storeId: true,
              name: true,
              category: true,
              price: true,
              image: true,
            },
          }),
          menuCategory.id,
        );
        enabled += 1;
        continue;
      }
      const record = await prisma.product.findUnique({
        where: { id: productId },
        select: {
          id: true,
          storeId: true,
          name: true,
          category: true,
          price: true,
          image: true,
        },
      });
      if (!record) throw new Error(`商品记录不存在 id=${productId}`);
      await scanOrderingSyncService.enable(record, menuCategory.id);
      enabled += 1;
      menuCreated += 1;
      console.log(`  ~ 上架菜单商品: ${item.name} (menuProduct->product#${productId})`);
    }
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
  const finalMenuProducts = await prisma.scanOrderingMenuProduct.count({
    where: { storeId, deletedAt: null },
  });
  const finalMenuCategories = await prisma.scanOrderingMenuCategory.count({
    where: { storeId, deletedAt: null },
  });
  const finalCategories = await prisma.productCategory.count({
    where: { storeId, deletedAt: null },
  });
  console.log('--- 汇总 ---');
  console.log(
    `新增普通商品 ${created} 个, 复用 ${reused} 个, 上架确认 ${enabled} 个(其中新建菜单商品 ${menuCreated} 个)`,
  );
  console.log(
    `门店 ${store.name}(id=${storeId}) 现有: 普通商品 ${finalProducts}, 普通分类 ${finalCategories}, 菜单商品 ${finalMenuProducts}, 菜单分类 ${finalMenuCategories}`,
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

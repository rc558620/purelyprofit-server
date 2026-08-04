// 清空指定门店的商品相关数据（普通商品/分类 + 扫码菜单分类/商品/规格），回到空白状态。
// 删除前校验依赖数据（扫码订单/库存日志/进货明细/销售明细引用），存在则中止并提示。
// 用法: node scripts/seed-marketing-products/cleanup-store-products.mjs [storeId]  默认 storeId=37
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import Redis from 'ioredis';

const STORE_ID = Number.parseInt(process.argv[2] || '37', 10);

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

let redis;

async function main() {
  redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: Number.parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    db: Number.parseInt(process.env.REDIS_DB || '0', 10),
    maxRetriesPerRequest: 1,
  });

  const menuProducts = await prisma.scanOrderingMenuProduct.findMany({
    where: { storeId: STORE_ID },
    select: { id: true },
  });
  const menuIds = menuProducts.map((m) => m.id);
  const productIds = (
    await prisma.product.findMany({
      where: { storeId: STORE_ID },
      select: { id: true },
    })
  ).map((p) => p.id);

  // 依赖校验：有任何业务引用则中止，避免留下脏数据/外键报错
  const scanOrderItems = await prisma.scanOrderItem.count({
    where: { storeId: STORE_ID },
  });
  const specGroups = await prisma.scanOrderingSpecGroup.count({
    where: { menuProductId: { in: menuIds } },
  });
  const specOptions = await prisma.scanOrderingSpecOption.count({
    where: { group: { menuProductId: { in: menuIds } } },
  });
  const inventoryLogs = await prisma.inventoryAdjustmentLog.count({
    where: { productId: { in: productIds } },
  });
  const purchaseItems = await prisma.purchaseOrderItem.count({
    where: { productId: { in: productIds } },
  });
  const saleItems = await prisma.saleOrderItem.count({
    where: { productId: { in: productIds } },
  });

  console.log(`门店 ${STORE_ID} 待清空数据:`);
  console.log(`  扫码菜单商品 ${menuIds.length}, 菜单分类待查, 规格组 ${specGroups}, 规格选项 ${specOptions}`);
  console.log(`  普通商品 ${productIds.length}, 库存日志 ${inventoryLogs}, 进货明细 ${purchaseItems}, 销售明细 ${saleItems}, 扫码订单 ${scanOrderItems}`);

  if (scanOrderItems + inventoryLogs + purchaseItems + saleItems > 0) {
    throw new Error(
      `存在业务数据引用（扫码订单 ${scanOrderItems} / 库存日志 ${inventoryLogs} / 进货明细 ${purchaseItems} / 销售明细 ${saleItems}），已中止删除。请确认后再手动处理。`,
    );
  }

  // 事务内按外键顺序删除（子表 → 父表）
  await prisma.$transaction([
    prisma.scanOrderingSpecOption.deleteMany({
      where: { group: { menuProductId: { in: menuIds } } },
    }),
    prisma.scanOrderingSpecGroup.deleteMany({
      where: { menuProductId: { in: menuIds } },
    }),
    prisma.scanOrderingMenuProduct.deleteMany({ where: { storeId: STORE_ID } }),
    prisma.scanOrderingMenuCategory.deleteMany({ where: { storeId: STORE_ID } }),
    prisma.product.deleteMany({ where: { storeId: STORE_ID } }),
    prisma.productCategory.deleteMany({ where: { storeId: STORE_ID } }),
  ]);

  try {
    await redis.del(`scanordering:menu:${STORE_ID}`);
    console.log('已清理扫码菜单缓存');
  } catch {
    /* ignore */
  }

  console.log('--- 清空完成 ---');
  console.log(
    `扫码菜单商品 ${menuIds.length} 个、菜单分类、规格 ${specGroups}/${specOptions}、普通商品 ${productIds.length} 个、普通分类 全部删除`,
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

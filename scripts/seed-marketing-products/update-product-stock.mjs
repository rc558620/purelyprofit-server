// 将门店 37 的全部普通商品库存统一设为 9999，并输出每个分类的商品分布（确认每个分类都有商品）。
// 用法: node scripts/seed-marketing-products/update-product-stock.mjs [storeId]  默认 37
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

const STORE_ID = Number.parseInt(process.argv[2] || '37', 10);

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  // 1) 每个分类下的商品分布
  const grouped = await prisma.product.groupBy({
    by: ['category'],
    where: { storeId: STORE_ID, deletedAt: null },
    _count: { id: true },
    orderBy: { category: 'asc' },
  });
  console.log(`门店 ${STORE_ID} 分类商品分布:`);
  let emptyCategories = 0;
  for (const g of grouped) {
    console.log(`  ${g.category}: ${g._count.id} 个`);
  }
  const allCategories = await prisma.productCategory.count({
    where: { storeId: STORE_ID, deletedAt: null },
  });
  if (grouped.length < allCategories) {
    emptyCategories = allCategories - grouped.length;
    console.warn(`  ! 有 ${emptyCategories} 个普通分类下没有商品`);
  }

  // 2) 批量更新库存为 9999
  const result = await prisma.product.updateMany({
    where: { storeId: STORE_ID, deletedAt: null },
    data: { stock: 9999 },
  });
  console.log(`--- 更新完成: 共更新 ${result.count} 个商品的库存为 9999 ---`);

  // 3) 抽查几个商品确认
  const samples = await prisma.product.findMany({
    where: { storeId: STORE_ID, deletedAt: null },
    select: { name: true, category: true, stock: true },
    orderBy: { id: 'asc' },
    take: 5,
  });
  console.log('抽查:', JSON.stringify(samples));
}

main()
  .catch((e) => {
    console.error('错误:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });

// 只读诊断：评估服务订单优惠统计（marketingPromotion.totalDiscount）受满减乘数量 bug 影响的历史数据量
// 用法：node scripts/diagnose-service-order-discount.mjs
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  // 服务订单结算走 balance 支付并写入 marketingConsumption（带 promotionId）；
  // 扫码点餐结算的 itemsSummary 以「扫码点餐订单」开头，需排除。
  const serviceOrders = await prisma.marketingConsumption.findMany({
    where: {
      promotionId: { not: null },
      itemsSummary: { not: { startsWith: '扫码点餐订单' } },
    },
    select: {
      id: true,
      storeId: true,
      customerId: true,
      amount: true,
      promotionId: true,
      itemsSummary: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`受影响的服务订单消费记录（promotionId 非空且非扫码点餐）：${serviceOrders.length} 条`);
  if (serviceOrders.length === 0) {
    console.log('结论：无历史受影响数据，营销活动 totalDiscount 无需订正。');
    return;
  }

  // 按活动分组统计
  const byPromotion = new Map();
  for (const order of serviceOrders) {
    const key = order.promotionId;
    const entry = byPromotion.get(key) ?? { count: 0, totalAmountFen: 0 };
    entry.count += 1;
    entry.totalAmountFen += order.amount;
    byPromotion.set(key, entry);
  }

  const promotions = await prisma.marketingPromotion.findMany({
    where: { id: { in: [...byPromotion.keys()] } },
    select: { id: true, name: true, storeId: true, totalDiscount: true },
  });
  const promotionMap = new Map(promotions.map((p) => [p.id, p]));

  console.log('\n按活动分组统计：');
  let grandTotalDiscountFen = 0;
  for (const [promotionId, stat] of byPromotion) {
    const promotion = promotionMap.get(promotionId);
    const name = promotion?.name ?? '(活动已删除)';
    const totalDiscount = promotion?.totalDiscount ?? 0;
    grandTotalDiscountFen += totalDiscount;
    console.log(
      `  - 活动#${promotionId}「${name}」：关联订单 ${stat.count} 笔，消费总额 ¥${(stat.totalAmountFen / 100).toFixed(2)}，当前 totalDiscount 累计 ¥${(totalDiscount / 100).toFixed(2)}`,
    );
  }

  console.log(`\n涉及营销活动 totalDiscount 累计值合计：¥${(grandTotalDiscountFen / 100).toFixed(2)}`);
  console.log('说明：由于草稿仅存 Redis 且 TTL 2 小时、消费表未保存数量/活动优惠快照，');
  console.log('历史订单的正确优惠额无法精确重算，只能按活动人工对账或接受统计口径误差。');
}

main()
  .catch((error) => {
    console.error('诊断失败：', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

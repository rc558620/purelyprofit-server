// 存量孤儿单清理脚本：把「会话已结束（checked_out/left/expired）但订单仍为 served」的
// 扫码点餐订单批量置为 completed，并补写系统状态历史。
//
// 产生背景：会话自动归档（auto_timeout）与用户重新扫码（left）只归档会话、
// 不处理会话内已出餐订单，导致订单长期停留在 served，清桌/列表无法闭环。
// 根因已修复（归档时同步置 completed），本脚本用于清理历史存量数据。
//
// 用法：node scripts/cleanup-orphan-served-orders.mjs [storeId]
// 可选传入 storeId 只清理指定门店；不传则清理全部。
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import pg from 'pg';

const storeIdFilter = process.argv[2]
  ? Number.parseInt(process.argv[2], 10)
  : null;
if (process.argv[2] && !Number.isInteger(storeIdFilter)) {
  console.error('❌ storeId 必须是整数');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  // 孤儿单：订单为 served 且所在会话已结束（checked_out/left/expired）
  const orphanOrders = await prisma.scanOrders.findMany({
    where: {
      status: 'served',
      deletedAt: null,
      session: {
        is: {
          status: { in: ['checked_out', 'left', 'expired'] },
        },
      },
      ...(storeIdFilter !== null ? { storeId: storeIdFilter } : {}),
    },
    select: { id: true, orderNo: true, storeId: true, sessionId: true },
    orderBy: { id: 'asc' },
  });

  if (orphanOrders.length === 0) {
    console.log('✅ 没有需要清理的孤儿 served 单');
    return;
  }

  console.log(`⚠️ 发现 ${orphanOrders.length} 笔孤儿 served 单，开始清理...\n`);
  let completedCount = 0;
  for (const order of orphanOrders) {
    const now = new Date();
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.scanOrders.updateMany({
        where: { id: order.id, status: 'served' },
        data: { status: 'completed', completedAt: now },
      });
      if (result.count === 0) return 0;
      await tx.scanOrderStatusHistory.create({
        data: {
          orderId: order.id,
          storeId: order.storeId,
          fromStatus: 'served',
          toStatus: 'completed',
          operatorType: 'system',
          reason: '存量孤儿单清理：会话已结束，订单自动完成',
        },
      });
      return 1;
    });
    if (updated > 0) {
      completedCount += 1;
      console.log(
        `  ✅ 订单 ${order.orderNo} (id=${order.id}, store=${order.storeId}, session=${order.sessionId ?? '-'}) → completed`,
      );
    }
  }

  console.log(
    `\n✅ 完成！共清理 ${completedCount}/${orphanOrders.length} 笔孤儿单`,
  );
  await prisma.$disconnect();
}

main()
  .catch((error) => {
    console.error('❌ 清理失败:', error.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

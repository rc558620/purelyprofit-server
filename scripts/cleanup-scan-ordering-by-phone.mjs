// 清理账号 13619654040 的扫码点餐桌台和订单数据
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

// 初始化数据库连接池
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const TARGET_PHONE = '13619654040';

async function main() {
  console.log(`🔍 开始清理账号 ${TARGET_PHONE} 的扫码点餐数据...\n`);

  // 1. 查找账号对应的 storeId
  const staff = await prisma.staff.findFirst({
    where: { phone: TARGET_PHONE },
    select: { id: true, storeId: true, name: true },
  });

  if (!staff) {
    console.log(`❌ 未找到手机号为 ${TARGET_PHONE} 的员工账号\n`);
    await prisma.$disconnect();
    return;
  }

  console.log(`✅ 找到员工：${staff.name} (ID: ${staff.id}, Store ID: ${staff.storeId})\n`);

  const storeId = staff.storeId;

  // 2. 查询该门店的扫码点餐桌台
  const tables = await prisma.scanOrderingTable.findMany({
    where: { storeId, deletedAt: null },
    select: {
      id: true,
      tableCode: true,
      name: true,
      status: true,
      isActive: true,
    },
  });

  console.log(`📊 找到 ${tables.length} 个桌台:\n`);
  for (const table of tables) {
    console.log(`├─ Table ID: ${table.id}`);
    console.log(`├─ Table Code: ${table.tableCode}`);
    console.log(`├─ Name: ${table.name}`);
    console.log(`├─ Status: ${table.status}`);
    console.log(`└─ Active: ${table.isActive}\n`);
  }

  // 3. 查询相关的订单
  const tableIds = tables.map((t) => t.id);
  const orders = await prisma.scanOrders.count({
    where: {
      tableId: { in: tableIds },
      storeId,
    },
  });

  console.log(`📦 找到 ${orders} 个订单\n`);

  // 4. 查询相关的会话
  const sessions = await prisma.scanOrderingSession.count({
    where: {
      tableId: { in: tableIds },
      storeId,
    },
  });

  console.log(` 找到 ${sessions} 个会话\n`);

  // 5. 确认删除
  console.log('⚠️  即将删除以上所有数据，按 Ctrl+C 取消，或等待 5 秒后继续...\n');
  await new Promise((resolve) => setTimeout(resolve, 5000));

  // 6. 删除订单明细（先删子表）
  console.log(' 开始删除订单明细...\n');
  const deletedItems = await prisma.scanOrderItem.deleteMany({
    where: {
      orderId: {
        in: await prisma.scanOrders.findMany({
          where: { tableId: { in: tableIds }, storeId },
          select: { id: true },
        }).then((orders) => orders.map((o) => o.id)),
      },
    },
  });
  console.log(`✅ 已删除 ${deletedItems.count} 个订单明细\n`);
  
  // 7. 删除订单状态历史
  console.log(' 开始删除订单状态历史...\n');
  const deletedHistories = await prisma.scanOrderStatusHistory.deleteMany({
    where: {
      orderId: {
        in: await prisma.scanOrders.findMany({
          where: { tableId: { in: tableIds }, storeId },
          select: { id: true },
        }).then((orders) => orders.map((o) => o.id)),
      },
    },
  });
  console.log(`✅ 已删除 ${deletedHistories.count} 个订单状态历史\n`);

  // 8. 删除订单
  console.log(' 开始删除订单...\n');
  const deletedOrders = await prisma.scanOrders.deleteMany({
    where: {
      tableId: { in: tableIds },
      storeId,
    },
  });
  console.log(`✅ 已删除 ${deletedOrders.count} 个订单\n`);

  // 8. 删除购物车项规格
  console.log(' 开始删除购物车项规格...\n');
  const deletedCartSpecs = await prisma.scanOrderingCartItemSpec.deleteMany({
    where: {
      cartItemId: {
        in: await prisma.scanOrderingCartItem.findMany({
          where: { sessionId: { in: await prisma.scanOrderingSession.findMany({ where: { tableId: { in: tableIds }, storeId }, select: { id: true } }).then((s) => s.map((x) => x.id)) } },
          select: { id: true },
        }).then((items) => items.map((i) => i.id)),
      },
    },
  });
  console.log(`✅ 已删除 ${deletedCartSpecs.count} 个购物车项规格\n`);

  // 9. 删除购物车项
  console.log(' 开始删除购物车项...\n');
  const deletedCartItems = await prisma.scanOrderingCartItem.deleteMany({
    where: {
      sessionId: {
        in: await prisma.scanOrderingSession.findMany({
          where: { tableId: { in: tableIds }, storeId },
          select: { id: true },
        }).then((s) => s.map((x) => x.id)),
      },
    },
  });
  console.log(`✅ 已删除 ${deletedCartItems.count} 个购物车项\n`);

  // 10. 删除服务呼叫
  console.log(' 开始删除服务呼叫...\n');
  const deletedServiceCalls = await prisma.scanOrderServiceCall.deleteMany({
    where: {
      sessionId: {
        in: await prisma.scanOrderingSession.findMany({
          where: { tableId: { in: tableIds }, storeId },
          select: { id: true },
        }).then((s) => s.map((x) => x.id)),
      },
    },
  });
  console.log(`✅ 已删除 ${deletedServiceCalls.count} 个服务呼叫\n`);

  // 11. 删除会话
  console.log('🧹 开始删除会话...\n');
  const deletedSessions = await prisma.scanOrderingSession.deleteMany({
    where: {
      tableId: { in: tableIds },
      storeId,
    },
  });
  console.log(`✅ 已删除 ${deletedSessions.count} 个会话\n`);
  
  // 12. 删除桌台二维码
  console.log(' 开始删除桌台二维码...\n');
  const deletedQrCodes = await prisma.scanOrderingTableQrCode.deleteMany({
    where: {
      tableId: { in: tableIds },
    },
  });
  console.log(`✅ 已删除 ${deletedQrCodes.count} 个桌台二维码\n`);

  // 13. 删除桌台（物理删除）
  console.log(' 开始删除桌台...\n');
  const deletedTables = await prisma.scanOrderingTable.deleteMany({
    where: {
      id: { in: tableIds },
      storeId,
    },
  });
  console.log(`✅ 已删除 ${deletedTables.count} 个桌台\n`);

  // 14. 验证清理结果
  const remainingTables = await prisma.scanOrderingTable.count({
    where: { storeId, deletedAt: null },
  });
  const remainingOrders = await prisma.scanOrders.count({
    where: { storeId },
  });
  const remainingSessions = await prisma.scanOrderingSession.count({
    where: { storeId },
  });

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('✅ 清理完成！\n');
  console.log(`├─ 剩余桌台数：${remainingTables}`);
  console.log(`─ 剩余订单数：${remainingOrders}`);
  console.log(`└─ 剩余会话数：${remainingSessions}\n`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  await prisma.$disconnect();
  await pool.end();
}

main()
  .catch((e) => {
    console.error('❌ 错误:', e);
    process.exit(1);
  })
  .finally();

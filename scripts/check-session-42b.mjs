import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// 1) 会话 21-24 概览
const sessions = await prisma.spaceSession.findMany({
  where: { id: { in: [21, 22, 23, 24] } },
  orderBy: { id: 'asc' },
  include: { sessionItems: { orderBy: { sortOrder: 'asc' } }, sessionRenewRecords: { orderBy: { id: 'asc' } } },
});
for (const s of sessions) {
  console.log(`SESSION ${s.id}: status=${s.status} start=${s.startTime.toISOString()} end=${s.endTime?.toISOString()} updatedAt=${s.updatedAt.toISOString()} saleOrderId=${s.saleOrderId} autoCheckout=${s.autoCheckout} hourlyRate=${s.hourlyRate} countdownMinutes=${s.countdownMinutes} prepaidAmount=${s.prepaidAmount} prepaidVoucherFace=${s.prepaidVoucherFaceAmount} groupon=${s.prepaidGrouponCode}/${s.prepaidGrouponPlatform} customerPaymentMethod=${s.prepaidCustomerPaymentMethod} timeFeeMode=${s.timeFeeMode} countdownFeeMode=${s.countdownFeeMode}`);
  console.log(`  items: ${JSON.stringify(s.sessionItems.map(i => ({ pid: i.productId, salePrice: i.salePrice, profit: i.profit, qty: i.quantity })))}`);
  console.log(`  renews: ${JSON.stringify(s.sessionRenewRecords.map(r => ({ id: r.id, amount: r.amount, voucherFace: r.voucherFaceAmount, pm: r.paymentMethod, minutes: r.addedMinutes })))}`);
}

// 2) 销售单 410-426
const orders = await prisma.saleOrder.findMany({
  where: { id: { in: [410, 411, 412, 413, 424, 425, 426] } },
  orderBy: { id: 'asc' },
  include: { items: true },
});
for (const o of orders) {
  console.log(`ORDER ${o.id}: storeId=${o.storeId} totalRevenue=${o.totalRevenue} totalProfit=${o.totalProfit} totalQuantity=${o.totalQuantity} paymentMethod=${o.paymentMethod} customerPaymentMethod=${o.customerPaymentMethod} groupon=${o.grouponCode}/${o.grouponPlatform} settlementChannel=${o.settlementChannel} date=${o.date.toISOString()} operatorStaffId=${o.operatorStaffId} note=${o.note}`);
  console.log(`  items: ${JSON.stringify(o.items.map(i => ({ pid: i.productId, name: i.productName, salePrice: i.salePrice, profit: i.profit, qty: i.quantity, category: i.categoryName })))}`);
}

// 3) 42 门店 8/11 当天所有销售单
const todayOrders = await prisma.saleOrder.findMany({
  where: { storeId: 42, date: { gte: new Date('2026-08-10T16:00:00Z') } },
  orderBy: { id: 'asc' },
  select: { id: true, totalRevenue: true, totalProfit: true, paymentMethod: true, note: true, date: true, operatorStaffId: true, customerPaymentMethod: true },
});
console.log('=== store 42 orders since 8/11 00:00 CST ===');
for (const o of todayOrders) console.log(JSON.stringify(o));

// 4) 42 门店当前 active 会话
const active = await prisma.spaceSession.findMany({ where: { storeId: 42, status: 'active' }, select: { id: true, spaceId: true, startTime: true, countdownMinutes: true, autoCheckout: true, hourlyRate: true } });
console.log('=== store 42 active sessions ===');
console.log(JSON.stringify(active));

await prisma.$disconnect();
await pool.end();

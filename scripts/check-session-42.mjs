import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });
const storeId = 42;
const sessions = await prisma.spaceSession.findMany({
  where: { storeId },
  orderBy: { id: 'desc' },
  take: 10,
  include: {
    sessionItems: { orderBy: { sortOrder: 'asc' } },
    sessionRenewRecords: { orderBy: { id: 'asc' } },
  },
});
console.log('=== space_sessions storeId=42 (最近10条) ===');
for (const s of sessions) {
  console.log(JSON.stringify({
    id: s.id, spaceId: s.spaceId, status: s.status, billingMode: s.billingMode,
    hourlyRate: s.hourlyRate, countdownMinutes: s.countdownMinutes,
    autoCheckout: s.autoCheckout, startTime: s.startTime, endTime: s.endTime, checkoutAt: s.checkoutAt,
    saleOrderId: s.saleOrderId, totalRevenue: s.totalRevenue, totalProfit: s.totalProfit,
    prepaidAmount: s.prepaidAmount, prepaidVoucherFaceAmount: s.prepaidVoucherFaceAmount,
    prepaidPaymentMethod: s.prepaidPaymentMethod, prepaidGrouponCode: s.prepaidGrouponCode,
    prepaidGrouponPlatform: s.prepaidGrouponPlatform, prepaidSettlementChannel: s.prepaidSettlementChannel,
    prepaidCustomerPaymentMethod: s.prepaidCustomerPaymentMethod,
    grouponCode: s.grouponCode, voucherCode: s.voucherCode, voucherFaceAmount: s.voucherFaceAmount,
    settlementStatus: s.settlementStatus, timeFeeMode: s.timeFeeMode, countdownFeeMode: s.countdownFeeMode,
    updatedAt: s.updatedAt,
    items: s.sessionItems.map(i => ({ productId: i.productId, name: i.productName, salePrice: i.salePrice, profit: i.profit, qty: i.quantity })),
    renews: s.sessionRenewRecords.map(r => ({ id: r.id, amount: r.amount, voucherFaceAmount: r.voucherFaceAmount, paymentMethod: r.paymentMethod, addedMinutes: r.addedMinutes, grouponCode: r.grouponCode, grouponPlatform: r.grouponPlatform, createdAt: r.createdAt })),
  }, null, 1));
}
await prisma.$disconnect();
await pool.end();

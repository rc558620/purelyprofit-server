import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });
const spaces = await prisma.space.findMany({
  where: { storeId: 42 },
  include: { type: { select: { id: true, name: true } } },
});
for (const s of spaces) {
  console.log(JSON.stringify({ id: s.id, name: s.name, typeId: s.typeId, typeName: s.type?.name, hourlyRate: s.hourlyRate, billingMode: s.billingMode, autoCheckout: s.autoCheckout, enableDirtyRoom: s.enableDirtyRoom, deletedAt: s.deletedAt }));
}
// 查 42 门店全部 active/历史 countdown 会话的 hourlyRate 分布
const rates = await prisma.spaceSession.groupBy({
  by: ['hourlyRate', 'spaceId'],
  where: { storeId: 42 },
  _count: { id: true },
});
console.log('=== 会话 hourlyRate 分布 ===');
for (const r of rates) console.log(JSON.stringify(r));
await prisma.$disconnect();
await pool.end();

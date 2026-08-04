// 探查账号 13619654040 的 staff 权限、用户关联与门店订阅状态
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const staff = await prisma.staff.findFirst({
    where: { phone: '13619654040' },
    select: {
      id: true,
      storeId: true,
      role: true,
      permissions: true,
      status: true,
      isActive: true,
      isSeatActive: true,
      userId: true,
      email: true,
    },
  });
  console.log('staff:', JSON.stringify(staff, null, 2));

  if (staff?.userId) {
    const user = await prisma.user.findUnique({
      where: { id: staff.userId },
      select: { id: true, email: true },
    });
    console.log('user:', JSON.stringify(user));
  }

  const sub = await prisma.storeSubscription.findUnique({
    where: { storeId: staff?.storeId ?? -1 },
    select: { id: true, status: true, planCode: true },
  });
  console.log('subscription:', JSON.stringify(sub));
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

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🔍 开始扫描 scan_ordering_sessions 脏数据...\n');

  // 查询所有无效的扫码会话
  const invalidSessions = await prisma.scanOrderingSession.findMany({
    where: {
      OR: [
        { deletedAt: { not: null } }, // 已删除的会话
        { expiresAt: { lt: new Date() } }, // 已过期的会话
        { status: 'left' }, // 已离开的会话
      ],
    },
    select: {
      id: true,
      tableId: true,
      clubUserId: true,
      storeId: true,
      status: true,
      deletedAt: true,
      expiresAt: true,
      createdAt: true,
      updatedAt: true,
      table: {
        select: {
          tableCode: true,
          status: true,
          isActive: true,
        },
      },
    },
  });

  if (invalidSessions.length === 0) {
    console.log('✅ 未找到无效的扫码会话\n');
    return;
  }

  console.log(`❌ 发现 ${invalidSessions.length} 个无效会话:\n`);
  
  for (const session of invalidSessions) {
    console.log(`├─ Session ID: ${session.id}`);
    console.log(`├─ Table ID: ${session.tableId}`);
    console.log(`├─ Table Code: ${session.table?.tableCode || 'N/A'}`);
    console.log(`├─ User ID: ${session.clubUserId || 'N/A'}`);
    console.log(`├─ Store ID: ${session.storeId}`);
    console.log(`├─ Status: ${session.status}`);
    console.log(`├─ Deleted At: ${session.deletedAt ? session.deletedAt.toISOString() : 'null'}`);
    console.log(`├─ Expires At: ${session.expiresAt.toISOString()}`);
    console.log(`└─ Table Status: ${session.table?.status} (active: ${session.table?.isActive})\n`);
  }

  console.log('\n🧹 开始软删除这些无效会话...\n');

  let deletedCount = 0;
  for (const session of invalidSessions) {
    try {
      // 如果已经软删除了，就跳过
      if (session.deletedAt) continue;

      await prisma.scanOrderingSession.update({
        where: { id: session.id },
        data: { 
          deletedAt: new Date(),
          status: 'left' as const,
        },
      });

      console.log(`✅ 已处理 Session ${session.id} (${session.table?.tableCode})`);
      deletedCount++;
    } catch (error) {
      console.error(`❌ 处理失败 Session ${session.id}:`, error.message);
    }
  }

  console.log(`\n✅ 完成！共处理 ${deletedCount} 个无效会话\n`);

  // 再次查询是否还有遗留的无效会话
  const remainingSessions = await prisma.scanOrderingSession.count({
    where: {
      OR: [
        { deletedAt: { not: null } },
        { expiresAt: { lt: new Date() } },
        { status: 'left' },
      ],
    },
  });

  console.log(`剩余无效会话数：${remainingSessions}\n`);

  await prisma.$disconnect();
}

main()
  .catch((e) => {
    console.error('❌ 错误:', e);
    process.exit(1);
  })
  .finally();

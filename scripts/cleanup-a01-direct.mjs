// Cleanup A01 dirty data - direct execution
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🔍 开始清理 A01 桌台的脏数据...\n');

  try {
    // 找到 A01 桌台
    const table = await prisma.scanOrderingTable.findFirst({
      where: { tableCode: 'A01' },
      select: { id: true },
    });

    if (!table) {
      console.log('❌ 未找到桌台 "A01"\n');
      return;
    }

    console.log(`✅ 找到桌台：${table.tableCode} (ID: ${table.id})\n`);

    // 查询所有关联到 A01 的会话
    const sessions = await prisma.scanOrderingSession.findMany({
      where: { tableId: table.id },
      select: { id: true, status: true, deletedAt: true, expiresAt: true },
    });

    if (sessions.length === 0) {
      console.log('✅ A01 没有任何会话记录\n');
      return;
    }

    console.log(`⚠️ 发现 ${sessions.length} 个关联会话:\n`);
    
    let deletedCount = 0;
    for (const session of sessions) {
      const info = `├─ Session ${session.id}: ${session.status}`;
      console.log(info);
      
      // 清理无效或已过期的会话
      if (!session.deletedAt && !session.expiresAt.gt(new Date())) {
        continue;
      }
      
      // 软删除
      await prisma.scanOrderingSession.update({
        where: { id: session.id },
        data: { 
          deletedAt: new Date(),
          status: 'left',
        },
      });
      deletedCount++;
    }

    console.log(`\n✅ 完成！共清理 ${deletedCount} 个无效会话\n`);

    // 再次验证
    const remaining = await prisma.scanOrderingSession.count({
      where: {
        tableId: table.id,
        deletedAt: null,
        status: 'active',
        expiresAt: { gt: new Date() },
      },
    });

    console.log(`剩余活跃会话数：${remaining}\n`);
    console.log('🎉 清理完成，现在可以重新扫码了！\n');

  } catch (error) {
    console.error('❌ 错误:', error.message);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main();

// Simple A01 table diagnostic script without dotenv
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log(`🔍 正在查询桌台 "A01" 的信息...\n`);

  try {
    const table = await prisma.scanOrderingTable.findFirst({
      where: { tableCode: 'A01' },
      select: {
        id: true,
        tableCode: true,
        name: true,
        status: true,
        isActive: true,
        deletedAt: true,
        store: {
          select: { id: true, name: true, businessMode: true },
        },
        qrCodes: {
          where: { 
            deletedAt: null,
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          },
          select: { id: true, tokenHash: true, expiresAt: true },
        },
        activeSessions: {
          where: { 
            deletedAt: null,
            status: 'active',
            expiresAt: { gt: new Date() },
          },
          select: { id: true, clubUserId: true, session: true, expiresAt: true },
        },
      },
    });

    if (!table) {
      console.log('❌ 未找到桌台 "A01"\n');
      return;
    }

    console.log(`✅ 找到桌台：${table.tableCode} (${table.name})\n`);
    console.log('📋 状态:');
    console.log(`├─ ID: ${table.id}`);
    console.log(`├─ 状态：${table.status}`);
    console.log(`├─ 是否激活：${table.isActive ? '是 ✓' : '否 ✗'}`);
    console.log(`├─ 已删除：${table.deletedAt ? '是 ✗' : '否 ✓'}`);
    console.log(`└─ 门店业态：${table.store.businessMode}\n`);

    if (table.qrCodes.length === 0) {
      console.log('❌ 无有效二维码\n');
    } else {
      console.log(`✅ ${table.qrCodes.length} 个有效二维码\n`);
    }

    if (table.activeSessions.length > 0) {
      console.log(`⚠️ 发现 ${table.activeSessions.length} 个活跃会话（脏数据！）:\n`);
      for (const s of table.activeSessions) {
        console.log(`├─ Session ID: ${s.id}`);
        console.log(`└─ User ID: ${s.clubUserId}\n`);
      }
      console.log('💡 这些会话需要清理才能重新扫码\n');
    } else {
      console.log('✅ 无活跃会话\n');
    }

  } catch (error) {
    console.error('❌ 错误:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();

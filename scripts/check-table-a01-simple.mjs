import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const tableCode = 'A01'; // 在这里输入你要查询的桌台编码
  
  console.log(`🔍 正在查询桌台 "${tableCode}" 的信息...\n`);

  try {
    const table = await prisma.scanOrderingTable.findFirst({
      where: {
        tableCode,
      },
      select: {
        id: true,
        tableCode: true,
        name: true,
        capacity: true,
        status: true,
        isActive: true,
        deletedAt: true,
        createdAt: true,
        updatedAt: true,
        store: {
          select: {
            id: true,
            name: true,
            businessMode: true,
          },
        },
        qrCodes: {
          where: {
            deletedAt: null,
            OR: [
              { expiresAt: null },
              { expiresAt: { gt: new Date() } },
            ],
          },
          select: {
            id: true,
            tokenHash: true,
            status: true,
            expiresAt: true,
            createdAt: true,
          },
        },
        activeSessions: {
          where: {
            deletedAt: null,
            status: 'active',
            expiresAt: { gt: new Date() },
          },
          select: {
            id: true,
            clubUserId: true,
            session: true,
            guestCount: true,
            lastActiveAt: true,
            expiresAt: true,
          },
        },
      },
    });

    if (!table) {
      console.log('❌ 未找到桌台 "A01"');
      return;
    }

    console.log(`✅ 找到桌台：${table.tableCode} (${table.name})\n`);
    console.log('📋 基本信息:');
    console.log(`├─ ID: ${table.id}`);
    console.log(`├─ 容量：${table.capacity}人`);
    console.log(`├─ 状态：${table.status}`);
    console.log(`├─ 是否激活：${table.isActive ? '是' : '否'}`);
    console.log(`├─ 删除时间：${table.deletedAt ? table.deletedAt.toISOString() : '无'} (应该是 null)`);
    console.log(`└─ 更新时间：${table.updatedAt.toISOString()}\n`);

    console.log(`🏪 关联门店:`);
    console.log(`├─ ID: ${table.store.id}`);
    console.log(`├─ 名称：${table.store.name}`);
    console.log(`└─ 业态：${table.store.businessMode} (应该是 catering)\n`);

    if (table.qrCodes.length > 0) {
      console.log(`✅ 有效二维码 (${table.qrCodes.length}个):\n`);
      for (const qr of table.qrCodes) {
        console.log(`├─ QR Code ID: ${qr.id}`);
        console.log(`├─ Token Hash: ${qr.tokenHash.slice(0, 20)}...`);
        console.log(`├─ 状态：${qr.status}`);
        console.log(`├─ 过期时间：${qr.expiresAt ? qr.expiresAt.toISOString() : '永不过期'}`);
        console.log(`└─ 创建时间：${qr.createdAt.toISOString()}\n`);
      }
    } else {
      console.log('❌ 未发现有效的二维码！这可能是问题所在。\n');
      console.log('💡 建议:');
      console.log('   1. 在后台管理系统重新生成该桌台的二维码');
      console.log('   2. 确保二维码的 expiresAt 字段为 NULL 或未来的时间');
    }

    if (table.activeSessions.length > 0) {
      console.log(`⚠️ 发现 ${table.activeSessions.length} 个活跃会话 (可能是脏数据):\n`);
      for (const session of table.activeSessions) {
        console.log(`├─ Session ID: ${session.id}`);
        console.log(`├─ User ID: ${session.clubUserId || 'N/A'}`);
        console.log(`├─ Session Token: ${session.session}`);
        console.log(`├─ 人数：${session.guestCount}`);
        console.log(`├─ 最后活动：${session.lastActiveAt.toISOString()}`);
        console.log(`└─ 过期时间：${session.expiresAt.toISOString()}\n`);
      }
      console.log('💡 建议:');
      console.log('   这些会话可能导致扫码冲突，需要手动清理');
    } else {
      console.log('✅ 无活跃会话\n');
    }

  } catch (error) {
    console.error('❌ 查询失败:', error.message);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main();

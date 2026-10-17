/**
 * 清理近30天交班记录种子数据（scripts/seed-handover-records-30d.mjs 的配套清理脚本）
 *
 * 默认只预览不删除，确认无误后加 --execute 才真正删除。
 *
 * 用法：node scripts/cleanup-handover-seed-30d.mjs [手机号] [--execute]
 *
 * 删除范围：指定门店中 createdAt >= 种子写入起始时刻 的交班记录
 * （种子脚本写入时使用的窗口起点，见 SEED_WINDOW_START_ISO），
 * 以及这些记录级联的附加项值。不会触碰该门店更早的历史记录与附加项配置。
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnvFile(resolve(__dirname, '../.env'));

const PHONE = process.argv[2]?.trim() || '13619654022';
const EXECUTE = process.argv.includes('--execute');

/**
 * 种子写入窗口起点：2026-10-17 那次写入使用的「上海时区今天-29 天 00:00」。
 * 只删除该时刻之后创建的交班记录，保证不影响门店原有历史数据。
 */
const SEED_WINDOW_START_ISO = '2026-09-17T16:00:00.000Z';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL?.trim() });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

function loadEnvFile(filePath) {
  try {
    for (const line of readFileSync(filePath, 'utf8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('=');
      if (i < 0) continue;
      process.env[t.slice(0, i).trim()] ??= t.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
    }
  } catch {}
}

const windowStart = new Date(SEED_WINDOW_START_ISO);

const user = await prisma.user.findFirst({
  where: { email: { contains: PHONE } },
  select: { id: true, name: true, store: { select: { id: true, name: true } } },
});
if (!user?.store) {
  console.error(`❌ 未找到手机号 ${PHONE} 对应的门店`);
  process.exit(1);
}

const storeId = user.store.id;
console.log(`门店: ${storeId}（${user.store.name}）`);
console.log(`删除范围: createdAt >= ${windowStart.toISOString()}（种子写入窗口起点）\n`);

// 先统计全量记录，再统计待删除范围，便于人工核对
const totalInStore = await prisma.storeHandoverRecord.count({ where: { storeId } });
const toDelete = await prisma.storeHandoverRecord.findMany({
  where: { storeId, createdAt: { gte: windowStart } },
  select: {
    id: true,
    status: true,
    createdAt: true,
    fromEmployeeId: true,
    handoverAt: true,
    shiftNameSnapshot: true,
    fromEmployeeNameSnapshot: true,
  },
  orderBy: { id: 'asc' },
});

console.log(`该门店交班记录总数: ${totalInStore}`);
console.log(`待删除: ${toDelete.length} 条`);
if (toDelete.length === 0) {
  console.log('\n没有需要清理的数据。');
} else {
  const ids = toDelete.map((r) => r.id);
  const statusCount = toDelete.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`  id 范围: ${ids[0]} ~ ${ids[ids.length - 1]}`);
  console.log(`  状态分布: ${Object.entries(statusCount).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  console.log(`  时间范围: ${toDelete[0].createdAt.toISOString()} ~ ${toDelete[toDelete.length - 1].createdAt.toISOString()}`);
  console.log(`  涉及交班人: ${[...new Set(toDelete.map((r) => r.fromEmployeeNameSnapshot))].join(', ')}`);

  const valueCount = await prisma.storeHandoverAdditionalValue.count({
    where: { recordId: { in: ids } },
  });
  console.log(`  级联附加项值: ${valueCount} 条`);

  // 门店更早的历史记录不受影响
  const kept = totalInStore - toDelete.length;
  console.log(`\n删除后该门店剩余记录: ${kept} 条（均为种子写入前的历史数据）`);

  if (kept > 0) {
    const keptRecords = await prisma.storeHandoverRecord.findMany({
      where: { storeId, createdAt: { lt: windowStart } },
      select: {
        id: true,
        status: true,
        createdAt: true,
        fromEmployeeNameSnapshot: true,
        shiftNameSnapshot: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    console.log('  保留的记录明细:');
    for (const r of keptRecords) {
      console.log(
        `    id=${r.id} status=${r.status} createdAt=${r.createdAt.toISOString()} `
        + `${r.fromEmployeeNameSnapshot}/${r.shiftNameSnapshot}`,
      );
    }
  }
}

if (!EXECUTE) {
  console.log('\n⚠️ 预览模式，未删除任何数据。确认无误后执行：');
  console.log(`   node scripts/cleanup-handover-seed-30d.mjs ${PHONE} --execute`);
} else {
  const ids = toDelete.map((r) => r.id);
  if (ids.length > 0) {
    // 先删附加项值（记录上虽已配置 ON DELETE CASCADE，显式删除更稳）
    const deletedValues = await prisma.storeHandoverAdditionalValue.deleteMany({
      where: { recordId: { in: ids } },
    });
    const deletedRecords = await prisma.storeHandoverRecord.deleteMany({
      where: { storeId, id: { in: ids } },
    });
    console.log(`\n✅ 已删除附加项值 ${deletedValues.count} 条`);
    console.log(`✅ 已删除交班记录 ${deletedRecords.count} 条`);
  }
  const remaining = await prisma.storeHandoverRecord.count({ where: { storeId } });
  console.log(`✅ 该门店剩余交班记录: ${remaining} 条`);
}

await prisma.$disconnect();
await pool.end();

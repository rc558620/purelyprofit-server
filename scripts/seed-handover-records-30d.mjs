/**
 * 交班记录种子数据脚本（近 30 天专用）
 *
 * 用途：给"交班记录"弹窗在「近 30 天」筛选下灌入足够多的已完成记录，
 * 用于验证滚动分页（每页 20 条，100 条 = 5 页）。
 *
 * 与 seed-handover-records.mjs 的区别：
 * - 全部落在最近 N 天（默认 30 天）内，并均匀分布到每一天，不做今日/近7天/近30天的概率分布
 * - 全部为 completed（弹窗列表只展示 completed）
 * - createdAt 与 handoverAt 均按「上海时区墙钟时间」换算成绝对时刻，
 *   保证落在服务端 30d 预设区间 [今天-29 天 00:00, 今天 23:59:59] 内
 *
 * 用法：node scripts/seed-handover-records-30d.mjs [手机号] [记录总数] [天数] [起始偏移天数]
 *
 * 默认：手机号 13619654055，记录总数 100，天数 30，起始偏移 0（含今天）
 *
 * 起始偏移天数：设为 1 时数据分布在「昨天 ~ 30 天前」，不落今天，
 * 用于避免种子数据影响今日交班页的营收统计起点（交班页会按"本班次内最近一次
 * 已完成交班"收窄统计起点，今天有交班记录会截断今日营收统计）。
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '../.env');
loadEnvFile(envPath);

const PHONE = process.argv[2]?.trim() || '13619654055';
const TOTAL = Number.parseInt(process.argv[3] || '100', 10);
const DAYS = Number.parseInt(process.argv[4] || '30', 10);
/** 起始偏移天数：0 = 含今天，1 = 从昨天开始（不落今天） */
const OFFSET_DAYS = Number.parseInt(process.argv[5] || '0', 10);

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL?.trim() });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

function loadEnvFile(filePath) {
  try {
    const envContent = readFileSync(filePath, 'utf8');
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex < 0) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim().replace(/^['"]|['"]$/g, '');
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {}
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * 把「上海时区 daysAgo 天前的 HH:mm」换算成绝对时刻（UTC 毫秒）。
 * 服务端按上海时区计算 30d 区间，直接用本地时区在 UTC±8 以外的机器上会串日。
 */
function buildShanghaiInstant(daysAgo, hour, minute) {
  const shanghaiNow = new Date(Date.now() + SHANGHAI_OFFSET_MS);
  const dayStartUtc = Date.UTC(
    shanghaiNow.getUTCFullYear(),
    shanghaiNow.getUTCMonth(),
    shanghaiNow.getUTCDate() - daysAgo,
  );
  // 上海 00:00 对应的绝对时刻
  const dayStartInstant = dayStartUtc - SHANGHAI_OFFSET_MS;
  return new Date(dayStartInstant + (hour * 60 + minute) * 60 * 1000);
}

/** 列出可用的账号，便于脚本提示正确的手机号 */
async function listCandidateAccounts() {
  const users = await prisma.user.findMany({
    where: { store: { isNot: null } },
    select: {
      id: true,
      name: true,
      email: true,
      store: { select: { id: true, name: true } },
    },
    take: 20,
    orderBy: { id: 'asc' },
  });

  console.log('\n可用的有门店账号：');
  for (const user of users) {
    const storeId = user.store?.id;
    const employeeCount = storeId
      ? await prisma.employee.count({
        where: { storeId, deletedAt: null, status: 'active' },
      })
      : 0;
    console.log(
      `  ${String(user.email).padEnd(24)} 门店=${storeId ?? '-'}(${user.store?.name ?? '-'}) 活跃员工=${employeeCount}`,
    );
  }
}

/** 根据附加项名称生成随机值 */
function generateAdditionalValue(itemName) {
  if (itemName === '备用金') {
    return String(Math.floor(Math.random() * 5 + 1) * 100);
  }
  if (itemName === '房卡') {
    return String(Math.floor(Math.random() * 10 + 1));
  }
  if (itemName === '钥匙') {
    return String(Math.floor(Math.random() * 5 + 1));
  }
  return String(Math.floor(Math.random() * 20 + 1));
}

async function main() {
  console.log(`🔍 查找手机号 ${PHONE} 对应的用户与门店...`);

  const user = await prisma.user.findFirst({
    where: { email: { contains: PHONE } },
    select: {
      id: true,
      name: true,
      email: true,
      store: { select: { id: true, name: true } },
      staffMembership: { select: { id: true } },
    },
  });

  if (!user) {
    console.error(`❌ 未找到手机号 ${PHONE} 对应的用户`);
    await listCandidateAccounts();
    throw new Error('ACCOUNT_NOT_FOUND');
  }

  const storeId = user.store?.id;
  if (!storeId) {
    console.error(`❌ 用户 ${user.id} 没有关联门店`);
    await listCandidateAccounts();
    throw new Error('STORE_NOT_FOUND');
  }

  const staffId = user.staffMembership?.id ?? null;
  console.log(`✅ 用户 id=${user.id} name=${user.name} 门店=${storeId}(${user.store.name})`);

  const employees = await prisma.employee.findMany({
    where: { storeId, deletedAt: null, status: 'active' },
    select: { id: true, name: true },
  });
  if (employees.length === 0) {
    throw new Error(`门店 ${storeId} 下没有活跃员工，无法创建交班记录`);
  }
  console.log(`📋 员工: ${employees.map((e) => `${e.id}:${e.name}`).join(', ')}`);

  const shiftDefs = await prisma.employeeShiftDefinition.findMany({
    where: { storeId },
    select: { id: true, name: true, defaultStartTime: true, defaultEndTime: true },
  });
  console.log(
    shiftDefs.length > 0
      ? `📋 排班定义: ${shiftDefs.map((s) => `${s.id}:${s.name}(${s.defaultStartTime}-${s.defaultEndTime})`).join(', ')}`
      : '📋 排班定义: 无（使用内置早班/晚班）',
  );

  let additionalItems = await prisma.storeHandoverAdditionalItem.findMany({
    where: { storeId },
    select: { id: true, name: true },
  });
  if (additionalItems.length === 0) {
    console.log('📦 创建交班附加项...');
    additionalItems = [];
    for (const name of ['备用金', '房卡', '钥匙']) {
      const item = await prisma.storeHandoverAdditionalItem.create({
        data: { storeId, name },
        select: { id: true, name: true },
      });
      additionalItems.push(item);
    }
  }

  const buildShiftInfo = () => {
    if (shiftDefs.length > 0) {
      const def = pickRandom(shiftDefs);
      return {
        shiftType: def.name.includes('早') ? 'morning' : 'late',
        shiftName: def.name,
        startTime: def.defaultStartTime,
        endTime: def.defaultEndTime,
      };
    }
    const shiftType = pickRandom(['morning', 'late']);
    return {
      shiftType,
      shiftName: shiftType === 'morning' ? '早班' : '晚班',
      startTime: shiftType === 'morning' ? '09:00' : '18:00',
      endTime: shiftType === 'morning' ? '16:00' : '22:00',
    };
  };

  const notes = [
    '正常交班',
    '今日营业正常',
    '客流量较大',
    '设备正常运转',
    '空调已关',
    '门窗已锁',
    '收银已核对',
    '现金已清点',
    null,
  ];

  console.log(`\n📝 生成 ${TOTAL} 条 completed 交班记录，均匀分布在最近 ${DAYS} 天...\n`);

  const perDayMap = new Map();
  let created = 0;

  for (let i = 0; i < TOTAL; i += 1) {
    // 轮询分配天数，保证每天都有记录（而不是随机聚集在某几天）
    const daysAgo = OFFSET_DAYS + DAYS - 1 - (i % DAYS);
    const shiftInfo = buildShiftInfo();
    // 交班时间 = 班次结束时间后 10~40 分钟
    const endHour = Number.parseInt(shiftInfo.endTime.slice(0, 2), 10) || 22;
    const endMinute = Number.parseInt(shiftInfo.endTime.slice(3, 5), 10) || 0;
    const handoverAt = buildShanghaiInstant(
      daysAgo,
      endHour,
      endMinute + 10 + Math.floor(Math.random() * 30),
    );

    const fromEmployee = pickRandom(employees);
    const otherEmployees = employees.filter((e) => e.id !== fromEmployee.id);
    const toEmployee = otherEmployees.length > 0 && Math.random() > 0.4
      ? pickRandom(otherEmployees)
      : null;

    try {
      const record = await prisma.storeHandoverRecord.create({
        data: {
          storeId,
          fromEmployeeId: fromEmployee.id,
          toEmployeeId: toEmployee?.id ?? null,
          fromSubAccountId: null,
          toSubAccountId: null,
          actorStaffId: staffId,
          fromEmployeeNameSnapshot: fromEmployee.name,
          shiftTypeSnapshot: shiftInfo.shiftType,
          shiftNameSnapshot: shiftInfo.shiftName,
          shiftStartTimeSnapshot: shiftInfo.startTime,
          shiftEndTimeSnapshot: shiftInfo.endTime,
          handoverMode: toEmployee === null ? 'self_main_account' : 'sub_account',
          status: 'completed',
          handoverAt,
          note: pickRandom(notes),
          createdAt: handoverAt,
          updatedAt: handoverAt,
        },
        select: { id: true },
      });

      created += 1;
      perDayMap.set(daysAgo, (perDayMap.get(daysAgo) ?? 0) + 1);

      // 附加项值写入失败不应影响记录本身（记录已落库）
      if (additionalItems.length > 0) {
        try {
          await prisma.storeHandoverAdditionalValue.createMany({
            data: additionalItems.map((item) => ({
              recordId: record.id,
              itemId: item.id,
              itemNameSnapshot: item.name,
              value: generateAdditionalValue(item.name),
            })),
          });
        } catch (error) {
          console.error(`  ⚠️ 附加项写入失败(record=${record.id}): ${error.message}`);
        }
      }

      if (created % 20 === 0) {
        console.log(`  已创建 ${created}/${TOTAL} 条...`);
      }
    } catch (error) {
      console.error(`  ⚠️ 创建失败: ${error.message}`);
    }
  }

  // 统计该门店在 30 天区间内实际可见的记录数
  const now = new Date();
  const shanghaiNow = new Date(now.getTime() + SHANGHAI_OFFSET_MS);
  const windowStart = new Date(
    Date.UTC(
      shanghaiNow.getUTCFullYear(),
      shanghaiNow.getUTCMonth(),
      shanghaiNow.getUTCDate() - 29,
    ) - SHANGHAI_OFFSET_MS,
  );
  const windowEnd = new Date(
    Date.UTC(
      shanghaiNow.getUTCFullYear(),
      shanghaiNow.getUTCMonth(),
      shanghaiNow.getUTCDate(),
      23,
      59,
      59,
      999,
    ) - SHANGHAI_OFFSET_MS,
  );
  const visibleTotal = await prisma.storeHandoverRecord.count({
    where: {
      storeId,
      status: 'completed',
      createdAt: { gte: windowStart, lte: windowEnd },
    },
  });

  console.log(`\n==============================`);
  console.log(` 近30天交班记录种子数据生成完成`);
  console.log(`==============================`);
  console.log(` 手机号：${PHONE}`);
  console.log(` 门店ID：${storeId}（${user.store.name}）`);
  console.log(` 本次创建：${created} 条`);
  console.log(` 30天区间内已完成记录总数：${visibleTotal} 条`);
  console.log(` 按每页 20 条 => 约 ${Math.max(1, Math.ceil(visibleTotal / 20))} 页（够滚动加载）`);
  console.log(` 按天分布（daysAgo:条数）：`);
  for (const daysAgo of [...perDayMap.keys()].sort((a, b) => b - a)) {
    console.log(`   -${String(daysAgo).padStart(2)} 天: ${perDayMap.get(daysAgo)} 条`);
  }
  console.log(`==============================`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });

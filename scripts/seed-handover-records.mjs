/**
 * 交班记录种子数据脚本
 * 为指定手机号账号生成 80 条交班记录，分布为今日 / 近7天 / 近30天
 *
 * 用法：node scripts/seed-handover-records.mjs [手机号] [记录总数]
 *
 * 默认：手机号 13619654055，记录总数 80
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
const TOTAL = Number.parseInt(process.argv[3] || '80', 10);

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL?.trim() });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

/** 交班记录分布：今日 / 近7天 / 近30天 */
const TODAY_COUNT = Math.round(TOTAL * 0.06); // ~5
const WEEK_COUNT = Math.round(TOTAL * 0.25); // ~20
const MONTH_COUNT = TOTAL - TODAY_COUNT - WEEK_COUNT; // ~55

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

/** 生成指定日期范围内的随机时间戳 */
function randomDateInRange(daysAgoStart, daysAgoEnd) {
  const now = new Date();
  const startMs = now.getTime() - daysAgoStart * 24 * 60 * 60 * 1000;
  const endMs = now.getTime() - daysAgoEnd * 24 * 60 * 60 * 1000;
  return new Date(startMs + Math.random() * (endMs - startMs));
}

/** 随机选一个数组元素 */
function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** 生成交班时间（根据班次类型） */
function buildHandoverAt(baseDate, shiftType) {
  const d = new Date(baseDate);
  // 交班时间一般在班次结束时间后 10~30 分钟
  if (shiftType === 'morning') {
    d.setHours(16, Math.floor(Math.random() * 30), 0, 0);
  } else {
    d.setHours(22, Math.floor(Math.random() * 30), 0, 0);
  }
  return d;
}

async function main() {
  console.log(`🔍 查找手机号 ${PHONE} 对应的用户与门店...`);

  // 查找用户和门店
  const user = await prisma.user.findFirst({
    where: { email: { contains: PHONE } },
    select: {
      id: true,
      name: true,
      email: true,
      store: { select: { id: true, name: true } },
      staffMembership: { select: { id: true, role: true } },
    },
  });

  if (!user) {
    throw new Error(`未找到手机号 ${PHONE} 对应的用户`);
  }

  const storeId = user.store?.id;
  if (!storeId) {
    throw new Error(`用户 ${user.id} 没有关联门店`);
  }

  const staffId = user.staffMembership?.id;
  console.log(`✅ 找到用户 id=${user.id} name=${user.name} 门店=${storeId}(${user.store.name}) staffId=${staffId}`);

  // 查找门店下所有员工
  const employees = await prisma.employee.findMany({
    where: { storeId, deletedAt: null, status: 'active' },
    select: { id: true, name: true },
  });

  if (employees.length === 0) {
    throw new Error(`门店 ${storeId} 下没有活跃员工，无法创建交班记录`);
  }

  console.log(`📋 门店下员工: ${employees.map((e) => `${e.id}:${e.name}`).join(', ')}`);

  // 查找排班定义
  const shiftDefs = await prisma.employeeShiftDefinition.findMany({
    where: { storeId },
    select: { id: true, name: true, defaultStartTime: true, defaultEndTime: true },
  });

  console.log(`📋 排班定义: ${shiftDefs.map((s) => `${s.id}:${s.name}(${s.defaultStartTime}-${s.defaultEndTime})`).join(', ')}`);

  // 确保有交班附加项（如果还没有就创建）
  let additionalItems = await prisma.storeHandoverAdditionalItem.findMany({
    where: { storeId },
    select: { id: true, name: true },
  });

  if (additionalItems.length === 0) {
    console.log('📦 创建交班附加项...');
    const itemNames = ['备用金', '房卡', '钥匙'];
    additionalItems = [];
    for (const name of itemNames) {
      const item = await prisma.storeHandoverAdditionalItem.create({
        data: { storeId, name },
        select: { id: true, name: true },
      });
      additionalItems.push(item);
    }
    console.log(`✅ 已创建 ${additionalItems.length} 个附加项: ${additionalItems.map((i) => i.name).join(', ')}`);
  }

  // 生成记录数据
  const shiftTypes = ['morning', 'late'];
  const shiftNames = { morning: '早班', late: '晚班' };
  const shiftStartTimes = { morning: '09:00', late: '18:00' };
  const shiftEndTimes = { morning: '16:00', late: '22:00' };

  // 如果有排班定义，优先使用
  const buildShiftInfo = () => {
    if (shiftDefs.length > 0) {
      const def = pickRandom(shiftDefs);
      const shiftType = def.name.includes('早') ? 'morning' : 'late';
      return {
        shiftType,
        shiftName: def.name,
        startTime: def.defaultStartTime,
        endTime: def.defaultEndTime,
        shiftDefinitionId: def.id,
      };
    }
    const shiftType = pickRandom(shiftTypes);
    return {
      shiftType,
      shiftName: shiftNames[shiftType],
      startTime: shiftStartTimes[shiftType],
      endTime: shiftEndTimes[shiftType],
      shiftDefinitionId: null,
    };
  };

  // 生成交班记录的日期分布
  const records = [];

  // 今日
  for (let i = 0; i < TODAY_COUNT; i++) {
    records.push({ daysAgoStart: 1, daysAgoEnd: 0 });
  }
  // 近7天（不含今日）
  for (let i = 0; i < WEEK_COUNT; i++) {
    records.push({ daysAgoStart: 7, daysAgoEnd: 1 });
  }
  // 近30天（不含近7天）
  for (let i = 0; i < MONTH_COUNT; i++) {
    records.push({ daysAgoStart: 30, daysAgoEnd: 7 });
  }

  // 打乱顺序，让时间更自然
  for (let i = records.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [records[i], records[j]] = [records[j], records[i]];
  }

  console.log(`\n📝 开始生成 ${TOTAL} 条交班记录...`);
  console.log(`   今日: ${TODAY_COUNT} 条`);
  console.log(`   近7天: ${WEEK_COUNT} 条`);
  console.log(`   近30天: ${MONTH_COUNT} 条\n`);

  let created = 0;
  let skipped = 0;

  for (const { daysAgoStart, daysAgoEnd } of records) {
    const baseDate = randomDateInRange(daysAgoStart, daysAgoEnd);
    const shiftInfo = buildShiftInfo();
    const handoverAt = buildHandoverAt(baseDate, shiftInfo.shiftType);
    const fromEmployee = pickRandom(employees);
    const toEmployee = Math.random() > 0.4 ? pickRandom(employees.filter((e) => e.id !== fromEmployee.id)) : null;

    // 决定交班模式
    const isSelfMain = toEmployee === null || Math.random() > 0.6;
    const handoverMode = isSelfMain ? 'self_main_account' : 'sub_account';

    // 状态：大部分已完成，少部分待处理/已取消
    const statusRoll = Math.random();
    const status = statusRoll < 0.85 ? 'completed' : statusRoll < 0.95 ? 'pending' : 'cancelled';

    // 随机备注
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
      null,
      null,
    ];
    const note = pickRandom(notes);

    const createdAt = new Date(handoverAt.getTime() - Math.random() * 5 * 60 * 1000);

    try {
      const record = await prisma.storeHandoverRecord.create({
        data: {
          storeId,
          fromEmployeeId: fromEmployee.id,
          toEmployeeId: toEmployee?.id ?? null,
          fromSubAccountId: null,
          toSubAccountId: null,
          actorStaffId: staffId ?? null,
          fromEmployeeNameSnapshot: fromEmployee.name,
          shiftTypeSnapshot: shiftInfo.shiftType,
          shiftNameSnapshot: shiftInfo.shiftName,
          shiftStartTimeSnapshot: shiftInfo.startTime,
          shiftEndTimeSnapshot: shiftInfo.endTime,
          handoverMode,
          status,
          handoverAt: status !== 'pending' ? handoverAt : null,
          note,
          createdAt,
          updatedAt: handoverAt,
        },
        select: { id: true },
      });

      // 为已完成记录添加附加项值
      if (status === 'completed' && additionalItems.length > 0) {
        const additionalValues = additionalItems.map((item) => ({
          recordId: record.id,
          itemId: item.id,
          value: generateAdditionalValue(item.name),
        }));

        await prisma.storeHandoverAdditionalValue.createMany({
          data: additionalValues,
        });
      }

      created++;
      if (created % 10 === 0) {
        console.log(`  已创建 ${created}/${TOTAL} 条...`);
      }
    } catch (error) {
      console.error(`  ⚠️ 创建失败: ${error.message}`);
      skipped++;
    }
  }

  console.log(`\n==============================`);
  console.log(` 交班记录种子数据生成完成`);
  console.log(`==============================`);
  console.log(` 手机号：${PHONE}`);
  console.log(` 门店ID：${storeId}`);
  console.log(` 成功创建：${created} 条`);
  console.log(` 跳过/失败：${skipped} 条`);
  console.log(`   - 今日：${TODAY_COUNT} 条`);
  console.log(`   - 近7天：${WEEK_COUNT} 条`);
  console.log(`   - 近30天：${MONTH_COUNT} 条`);
  console.log(`==============================`);
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

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });

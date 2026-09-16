/**
 * 存量脏数据修复：清理「子账号额度已关闭、但登录凭证仍有效」的子账号
 *
 * ── 背景 ──────────────────────────────────────────────────────────────────
 *
 * 平台侧（purelyPulse）把子账号额度配成 0 后，门店的子账号槽位会被回收，
 * 但历史上没有同步吊销员工 Staff 行的登录凭证，导致这些子账号仍能用原账号
 * 密码登录 purelyProfit。代码侧已修复（关闭额度即吊销凭证），本脚本用于
 * 把修复前遗留的存量数据一次性清理干净。
 *
 * ── 用法 ──────────────────────────────────────────────────────────────────
 *
 *   # dry-run（默认，只打印将被清理的账号，不写库）
 *   pnpm sub-account:revoke-orphaned
 *
 *   # 实际写库
 *   pnpm sub-account:revoke-orphaned --apply
 *
 *   # 只处理指定门店
 *   pnpm sub-account:revoke-orphaned --store=42
 *   pnpm sub-account:revoke-orphaned --store=42 --apply
 *
 * ── 处理内容（幂等，可重复执行）────────────────────────────────────────────
 *
 *   1. 禁用该门店子账号关联的 Staff 行：
 *      is_active=false / status=disabled / is_seat_active=false /
 *      login_account=NULL / permissions=[]
 *   2. 解绑 employee.linked_staff_id（员工档案保留，仍可排班 / 交班）
 *   3. 清空已分配的 store_sub_accounts 槽位（保留行：历史交班记录外键引用）
 *
 * 员工档案、User、Staff 行本身都不删除，店主重新分配槽位即得到全新子账号。
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

// Prisma 7 的 datasource 不写 url（见 prisma/schema.prisma），必须显式传驱动适配器
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const isApply = process.argv.includes('--apply');
const storeArg = process.argv.find((arg) => arg.startsWith('--store='));
const onlyStoreId = storeArg ? Number(storeArg.split('=')[1]) : null;

async function collectStoreDirtyAccounts(storeId) {
  const [slots, employees] = await Promise.all([
    prisma.storeSubAccount.findMany({
      where: {
        storeId,
        OR: [{ isAssigned: true }, { employeeId: { not: null } }],
      },
      select: { id: true, slotIndex: true, employeeId: true },
      orderBy: [{ slotIndex: 'asc' }],
    }),
    prisma.employee.findMany({
      where: { storeId, linkedStaffId: { not: null } },
      select: { id: true, name: true, linkedStaffId: true },
    }),
  ]);

  const staffIds = [
    ...new Set([
      ...slots.map((slot) => slot.employeeId),
      ...employees.map((employee) => employee.linkedStaffId),
    ]),
  ].filter((id) => typeof id === 'number' && id > 0);

  if (staffIds.length === 0) {
    return { slots, staff: [] };
  }

  const staff = await prisma.staff.findMany({
    where: { id: { in: staffIds }, storeId },
    select: {
      id: true,
      name: true,
      phone: true,
      loginAccount: true,
      isActive: true,
      status: true,
      isSeatActive: true,
    },
    orderBy: [{ id: 'asc' }],
  });

  return { slots, staff };
}

async function revokeStoreCredentials(storeId, staffIds) {
  await prisma.$transaction(async (tx) => {
    if (staffIds.length > 0) {
      await tx.staff.updateMany({
        where: { id: { in: staffIds }, storeId },
        data: {
          isActive: false,
          status: 'disabled',
          isSeatActive: false,
          loginAccount: null,
          permissions: [],
        },
      });
      await tx.employee.updateMany({
        where: { storeId, linkedStaffId: { in: staffIds } },
        data: { linkedStaffId: null },
      });
    }

    await tx.storeSubAccount.updateMany({
      where: {
        storeId,
        OR: [{ isAssigned: true }, { employeeId: { not: null } }],
      },
      data: {
        status: 'disabled',
        employeeId: null,
        isAssigned: false,
        assignedAt: null,
        canAccessHome: false,
        canUseHandover: false,
      },
    });
  });
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('❌ 无法找到 DATABASE_URL 环境变量');
    process.exit(1);
  }

  if (storeArg && (!Number.isInteger(onlyStoreId) || onlyStoreId <= 0)) {
    console.error('❌ --store 参数必须是正整数门店 ID');
    process.exit(1);
  }

  const profiles = await prisma.storeMembershipProfile.findMany({
    where: {
      ...(onlyStoreId ? { storeId: onlyStoreId } : {}),
      OR: [
        { pulseSubAccountQuota: null },
        { pulseSubAccountQuota: { lte: 0 } },
      ],
    },
    select: {
      storeId: true,
      pulseSubAccountQuota: true,
      store: { select: { name: true, deletedAt: true } },
    },
    orderBy: [{ storeId: 'asc' }],
  });

  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('  子账号凭证清理（配额已关闭门店）');
  console.log(`  模式: ${isApply ? '⚡ APPLY（写库）' : '🔍 DRY-RUN（只读）'}`);
  console.log(`  范围: ${onlyStoreId ? `门店 ${onlyStoreId}` : '全部门店'}`);
  console.log(`  配额已关闭门店数: ${profiles.length}`);
  console.log('═══════════════════════════════════════════════════════');

  let dirtyStoreCount = 0;
  let revokedStaffCount = 0;
  let clearedSlotCount = 0;

  for (const profile of profiles) {
    const { slots, staff } = await collectStoreDirtyAccounts(profile.storeId);
    const revocableStaff = staff.filter(
      (row) => row.isActive || row.loginAccount !== null,
    );

    if (slots.length === 0 && revocableStaff.length === 0) {
      continue;
    }

    dirtyStoreCount += 1;
    console.log('');
    console.log(
      `▶ 门店 ${profile.storeId}（${profile.store?.name ?? '未知门店'}）` +
        `${profile.store?.deletedAt ? ' [已注销]' : ''}  quota=${profile.pulseSubAccountQuota ?? 0}`,
    );

    for (const row of revocableStaff) {
      console.log(
        `   · Staff #${row.id} ${row.name} phone=${row.phone ?? '-'} ` +
          `loginAccount=${row.loginAccount ?? '-'} ` +
          `isActive=${row.isActive} status=${row.status} seat=${row.isSeatActive}`,
      );
    }

    if (slots.length > 0) {
      console.log(
        `   · 待清空槽位: ${slots.map((slot) => `#${slot.slotIndex}`).join(', ')}`,
      );
    }

    if (isApply) {
      await revokeStoreCredentials(
        profile.storeId,
        revocableStaff.map((row) => row.id),
      );
      console.log('   ✅ 已吊销凭证并清空槽位');
    }

    revokedStaffCount += revocableStaff.length;
    clearedSlotCount += slots.length;
  }

  console.log('');
  console.log('───────────────────────────────────────────────────────');
  console.log(`  待处理门店: ${dirtyStoreCount}`);
  console.log(`  待吊销 Staff 账号: ${revokedStaffCount}`);
  console.log(`  待清空槽位: ${clearedSlotCount}`);
  console.log(
    `  执行结果: ${isApply ? '已写库（可重复执行，幂等）' : '未写库，加 --apply 执行'}`,
  );
  console.log('───────────────────────────────────────────────────────');
}

main()
  .catch((error) => {
    console.error('❌ 执行失败:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });

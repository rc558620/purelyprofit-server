/**
 * 回填 C 端昵称到各门店顾客档案（marketing_customers.name / members.name）
 *
 * ── 背景 ──────────────────────────────────────────────────────────────────
 *
 * 商家端开台识别（member-card-identify）、持卡管理列表、顾客列表、护理档案标题
 * 都读 `marketing_customers.name`；而 C 端改昵称只写 `users.name`。
 * 代码侧已修复（AuthProfileService.writeName → syncNameToCustomerProfiles），
 * 但**修复前已经改过名的用户**，档案里仍是建档时的旧名（如「纯利会员4010」）。
 * 本脚本负责处理这批存量数据。
 *
 * ── 用法 ──────────────────────────────────────────────────────────────────
 *
 *   # dry-run（默认，只打印待同步记录，不写库）
 *   pnpm customer:backfill-name
 *
 *   # 实际写库
 *   pnpm customer:backfill-name --apply
 *
 *   # 限定用户 / 手机号（排查单条数据时用）
 *   BACKFILL_USER_IDS=42 pnpm customer:backfill-name
 *   BACKFILL_PHONES=15919654010 pnpm customer:backfill-name
 *
 * ── 归属规则（与 AuthProfileService 的同步逻辑完全对齐）──────────────────
 *
 *   1. 已绑定 club_user_id 的档案：按 club_user_id 精确定位；
 *   2. club_user_id 为空的孤儿档案：按手机号（users.wechat_phone 或登录邮箱中
 *      解析出的 club_phone_{phone}@ / phone_{phone}@）兜底；
 *   3. 只写 name 一列，不动 phone / 余额 / 积分。
 *
 * ── 安全保证 ──────────────────────────────────────────────────────────────
 *
 *   - 默认 dry-run，--apply 才写库；
 *   - 只处理 users.name 非空的账号，空昵称不会把档案名清成空串；
 *   - 逐条 updateMany + where id，不改动其它行；
 *   - 幂等：同步过的档案名已等于 users.name，重复执行不会改写任何数据。
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── 参数解析 ──────────────────────────────────────────────────────────────

const isApply = process.argv.includes('--apply');

const parseIdList = (raw) =>
  (raw ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0);

const userIdFilter = parseIdList(process.env.BACKFILL_USER_IDS);
const phoneFilter = (process.env.BACKFILL_PHONES ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

/** 登录邮箱里携带手机号的两种历史格式 */
const PHONE_PATTERNS = [/^club_phone_(\d+)@/, /^phone_(\d+)@/];

// ─── 数据库连接 ────────────────────────────────────────────────────────────

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) {
    return;
  }

  const envPath = resolve(__dirname, '..', '.env');
  if (!existsSync(envPath)) {
    return;
  }

  const match = readFileSync(envPath, 'utf-8').match(
    /^DATABASE_URL=["']?(.+?)["']?\s*$/m,
  );
  if (match) {
    process.env.DATABASE_URL = match[1];
  }
}

// ─── 工具 ──────────────────────────────────────────────────────────────────

/** 账号可能关联的手机号：微信绑定号 + 登录邮箱解析值 */
function resolveLinkedPhones(user) {
  const phones = [];
  if (user.wechatPhone) {
    phones.push(user.wechatPhone);
  }
  for (const pattern of PHONE_PATTERNS) {
    const matched = user.email?.match(pattern);
    if (matched?.[1]) {
      phones.push(matched[1]);
    }
  }
  return phones;
}

/**
 * 把一份档案列表按「userId → 期望姓名」比对出来。
 *
 * rows 需要带 userId（已绑定走 club_user_id，孤儿走手机号映射）。
 */
function diffRows(rows, userById) {
  const changes = [];
  for (const row of rows) {
    if (!row.userId) {
      continue;
    }
    const user = userById.get(row.userId);
    if (!user || !user.name || user.name === row.name) {
      continue;
    }
    changes.push({ id: row.id, storeId: row.storeId, from: row.name, to: user.name });
  }
  return changes;
}

// ─── 主逻辑 ────────────────────────────────────────────────────────────────

async function main() {
  loadDatabaseUrl();

  if (!process.env.DATABASE_URL) {
    console.error('❌ 无法找到 DATABASE_URL 环境变量');
    process.exit(1);
  }

  // Prisma 7 的 datasource 不写 url，必须显式传驱动适配器
  const { PrismaClient } = await import('@prisma/client');
  const { PrismaPg } = await import('@prisma/adapter-pg');
  const { default: pg } = await import('pg');

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    console.log('');
    console.log('═══════════════════════════════════════════════════════');
    console.log('  C 端昵称 → 门店顾客档案 / 会员档案 姓名回填');
    console.log(`  模式: ${isApply ? '⚡ APPLY（写库）' : '🔍 DRY-RUN（只读）'}`);
    if (userIdFilter.length > 0) {
      console.log(`  用户限定: ${userIdFilter.join(', ')}`);
    }
    if (phoneFilter.length > 0) {
      console.log(`  手机号限定: ${phoneFilter.join(', ')}`);
    }
    console.log('═══════════════════════════════════════════════════════');
    console.log('');

    const users = await prisma.user.findMany({
      where: {
        name: { not: null },
        ...(userIdFilter.length > 0 ? { id: { in: userIdFilter } } : {}),
      },
      select: { id: true, name: true, email: true, wechatPhone: true },
    });

    const userById = new Map(
      users
        .filter((user) => user.name && user.name.trim())
        .map((user) => [user.id, user]),
    );

    const phoneToUserId = new Map();
    for (const user of userById.values()) {
      for (const phone of resolveLinkedPhones(user)) {
        if (!phoneToUserId.has(phone)) {
          phoneToUserId.set(phone, user.id);
        }
      }
    }
    const candidatePhones = [...phoneToUserId.keys()];
    const matchPhoneFilter = (phone) =>
      phoneFilter.length === 0 || phoneFilter.includes(phone);

    // ─── marketing_customers ───────────────────────────────────────────────
    const boundCustomers = await prisma.marketingCustomer.findMany({
      where: {
        clubUserId: { not: null },
        deletedAt: null,
        ...(userIdFilter.length > 0 ? { clubUserId: { in: userIdFilter } } : {}),
      },
      select: { id: true, storeId: true, clubUserId: true, phone: true, name: true },
    });
    const orphanCustomers =
      candidatePhones.length === 0
        ? []
        : await prisma.marketingCustomer.findMany({
            where: {
              clubUserId: null,
              deletedAt: null,
              phone: { in: candidatePhones },
            },
            select: { id: true, storeId: true, clubUserId: true, phone: true, name: true },
          });

    const customerTargets = [
      ...boundCustomers.map((row) => ({ ...row, userId: row.clubUserId })),
      ...orphanCustomers.map((row) => ({
        ...row,
        userId: phoneToUserId.get(row.phone),
      })),
    ].filter((row) => matchPhoneFilter(row.phone ?? ''));

    const customerChanges = diffRows(customerTargets, userById);

    // ─── members ───────────────────────────────────────────────────────────
    const boundMembers = await prisma.member.findMany({
      where: {
        clubUserId: { not: null },
        deletedAt: null,
        ...(userIdFilter.length > 0 ? { clubUserId: { in: userIdFilter } } : {}),
      },
      select: { id: true, storeId: true, clubUserId: true, phone: true, name: true },
    });
    const orphanMembers =
      candidatePhones.length === 0
        ? []
        : await prisma.member.findMany({
            where: {
              clubUserId: null,
              deletedAt: null,
              phone: { in: candidatePhones },
            },
            select: { id: true, storeId: true, clubUserId: true, phone: true, name: true },
          });

    const memberTargets = [
      ...boundMembers.map((row) => ({ ...row, userId: row.clubUserId })),
      ...orphanMembers.map((row) => ({
        ...row,
        userId: phoneToUserId.get(row.phone),
      })),
    ].filter((row) => matchPhoneFilter(row.phone ?? ''));

    const memberChanges = diffRows(memberTargets, userById);

    if (customerChanges.length === 0 && memberChanges.length === 0) {
      console.log('  所有档案姓名已与 C 端昵称一致，无需回填。');
      console.log('');
      return;
    }

    console.log(`  待同步：marketing_customers ${customerChanges.length} 条 / members ${memberChanges.length} 条`);
    console.log('');

    for (const change of customerChanges) {
      console.log(
        `  ${isApply ? '✅' : '🔍'} customer #${change.id}（门店 ${change.storeId}）: 「${change.from}」→「${change.to}」`,
      );
    }
    for (const change of memberChanges) {
      console.log(
        `  ${isApply ? '✅' : '🔍'} member #${change.id}（门店 ${change.storeId}）: 「${change.from}」→「${change.to}」`,
      );
    }
    console.log('');

    if (!isApply) {
      console.log('  DRY-RUN 结束，未写库。确认无误后加 --apply 执行。');
      console.log('');
      return;
    }

    for (const change of customerChanges) {
      // eslint-disable-next-line no-await-in-loop
      await prisma.marketingCustomer.updateMany({
        where: { id: change.id, name: change.from },
        data: { name: change.to },
      });
    }
    for (const change of memberChanges) {
      // eslint-disable-next-line no-await-in-loop
      await prisma.member.updateMany({
        where: { id: change.id, name: change.from },
        data: { name: change.to },
      });
    }

    console.log('  ✅ 回填完成。');
    console.log('');
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('❌ 回填失败:', error);
  process.exit(1);
});

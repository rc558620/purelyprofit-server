/**
 * 回填 marketing_customers.club_user_id（孤儿顾客档案认领）
 *
 * ── 背景 ──────────────────────────────────────────────────────────────────
 *
 * 早期「邀请码 / 扫码入店」路径（ClubStoreAccessService.joinStoreByInviteCode）
 * 建档时没有写入 club_user_id，导致这批顾客档案只靠 phone 与 C 端账号关联。
 *
 * ClubAuthService.syncPhoneAcrossProfiles 换绑手机号时**只按 clubUserId 定位**，
 * 于是这些门店会被整店漏同步：
 *   - members.phone 留在旧号 → findAccessibleStores 匹配不到 → 用户当场失去该门店；
 *   - marketing_customers.phone 留在旧号 → 商家端营销里显示的还是旧手机号；
 *   - 用户下次到店消费会被当成新顾客，分裂出第二条档案 → 余额/积分看起来「清零」。
 *
 * 代码侧已修复（joinStoreByInviteCode 传 user.id + 绑定时补齐 + 换绑时认领），
 * 本脚本负责处理**存量数据**。
 *
 * ── 用法 ──────────────────────────────────────────────────────────────────
 *
 *   # dry-run（默认，只打印待认领记录，不写库）
 *   pnpm customer:backfill-club-user
 *
 *   # 实际写库
 *   pnpm customer:backfill-club-user --apply
 *
 *   # 限定门店 / 用户
 *   BACKFILL_STORE_IDS=101,102 pnpm customer:backfill-club-user
 *   BACKFILL_PHONES=13800138000 pnpm customer:backfill-club-user
 *
 * ── 认领条件（与 ClubAuthService.claimUnboundCustomers 完全对齐）────────────
 *
 *   1. club_user_id IS NULL 且 deleted_at IS NULL —— 未归属任何 club 用户；
 *   2. phone = 某个 club 用户的 users.wechat_phone（含 club_wechat:{openid} 占位值）；
 *   3. 该门店本用户**尚无**已绑定档案，避免撞
 *      uq_marketing_customers_store_club_user 部分唯一索引。
 *
 *   同一门店存在多条同号孤儿记录时只认领 id 最小的一条，其余原样打印出来，
 *   交给人工核对（可能是历史重复导入，连锁改写风险太大）。
 *
 * ── 安全保证 ──────────────────────────────────────────────────────────────
 *
 *   - 默认 dry-run，--apply 才写库；
 *   - 只写 club_user_id 一列，不动 phone / 余额 / 积分；
 *   - 逐条 updateMany + where club_user_id IS NULL 二次确认，防并发抢绑；
 *   - 幂等：认领过的记录不再满足 club_user_id IS NULL，重复执行不会改写任何数据。
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

const storeIdFilter = parseIdList(process.env.BACKFILL_STORE_IDS);
const phoneFilter = (process.env.BACKFILL_PHONES ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

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

  const stats = {
    candidateCount: 0,
    claimedCount: 0,
    noOwnerCount: 0,
    alreadyBoundCount: 0,
    duplicateCount: 0,
    failedCount: 0,
  };

  try {
    console.log('');
    console.log('═══════════════════════════════════════════════════════');
    console.log('  marketing_customers.club_user_id 回填');
    console.log(`  模式: ${isApply ? '⚡ APPLY（写库）' : '🔍 DRY-RUN（只读）'}`);
    if (storeIdFilter.length > 0) {
      console.log(`  门店限定: ${storeIdFilter.join(', ')}`);
    }
    if (phoneFilter.length > 0) {
      console.log(`  手机号限定: ${phoneFilter.join(', ')}`);
    }
    console.log('═══════════════════════════════════════════════════════');
    console.log('');

    const where = {
      clubUserId: null,
      deletedAt: null,
      phone: { not: null },
      ...(storeIdFilter.length > 0 ? { storeId: { in: storeIdFilter } } : {}),
      ...(phoneFilter.length > 0 ? { phone: { in: phoneFilter } } : {}),
    };

    const unboundCustomers = await prisma.marketingCustomer.findMany({
      where,
      select: { id: true, storeId: true, phone: true },
      orderBy: [{ storeId: 'asc' }, { id: 'asc' }],
    });

    if (unboundCustomers.length === 0) {
      console.log('  没有待认领的孤儿顾客档案，无需回填。');
      console.log('');
      return;
    }

    // 该手机号的 club 用户是否存在（wechat_phone 在 users 表唯一）
    const ownerIdByPhone = new Map();
    for (const phone of new Set(unboundCustomers.map((item) => item.phone))) {
      // eslint-disable-next-line no-await-in-loop
      const user = await prisma.user.findFirst({
        where: { wechatPhone: phone },
        select: { id: true },
      });
      if (user) {
        ownerIdByPhone.set(phone, user.id);
      }
    }

    // 已绑定档案的门店集合：(userId → Set<storeId>)，用于避开唯一索引冲突
    const boundStoreIdsByUser = new Map();

    for (const customer of unboundCustomers) {
      stats.candidateCount += 1;

      const userId = ownerIdByPhone.get(customer.phone);
      if (!userId) {
        stats.noOwnerCount += 1;
        console.log(
          `  ⏭️  #${customer.id} 门店 ${customer.storeId}：${customer.phone} 没有对应的 club 账号，跳过`,
        );
        continue;
      }

      let boundStoreIds = boundStoreIdsByUser.get(userId);
      if (!boundStoreIds) {
        // eslint-disable-next-line no-await-in-loop
        const boundCustomers = await prisma.marketingCustomer.findMany({
          where: { clubUserId: userId },
          select: { storeId: true },
        });
        boundStoreIds = new Set(boundCustomers.map((item) => item.storeId));
        boundStoreIdsByUser.set(userId, boundStoreIds);
      }

      if (boundStoreIds.has(customer.storeId)) {
        stats.alreadyBoundCount += 1;
        console.log(
          `  ⏭️  #${customer.id} 门店 ${customer.storeId}：用户 ${userId} 在该门店已有绑定档案，跳过`,
        );
        continue;
      }

      // 同一门店的多条同号孤儿只认领一条，其余留给人工
      const duplicates = unboundCustomers.filter(
        (item) =>
          item.storeId === customer.storeId &&
          item.phone === customer.phone &&
          item.id !== customer.id,
      );
      if (duplicates.length > 0 && customer.id > Math.min(...duplicates.map((item) => item.id))) {
        stats.duplicateCount += 1;
        continue;
      }

      try {
        if (isApply) {
          // eslint-disable-next-line no-await-in-loop
          const result = await prisma.marketingCustomer.updateMany({
            where: { id: customer.id, clubUserId: null },
            data: { clubUserId: userId },
          });
          if (result.count === 0) {
            stats.failedCount += 1;
            console.log(
              `  ⚠️  #${customer.id} 门店 ${customer.storeId}：并发写入导致未命中，跳过`,
            );
            continue;
          }
        }
        stats.claimedCount += 1;
        boundStoreIds.add(customer.storeId);
        console.log(
          `  ${isApply ? '✅' : '📝'} #${customer.id} 门店 ${customer.storeId} → club 用户 ${userId}` +
            `${duplicates.length > 0 ? `（该门店另有 ${duplicates.length} 条重复档案待人工核对）` : ''}`,
        );
      } catch (error) {
        stats.failedCount += 1;
        console.error(
          `  💥 #${customer.id} 处理失败: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    console.log('');
    console.log('═══════════════════════════════════════════════════════');
    console.log('  回填结果摘要');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`  孤儿候选数:      ${stats.candidateCount}`);
    console.log(`  无对应 club 账号: ${stats.noOwnerCount}`);
    console.log(`  门店已绑定:      ${stats.alreadyBoundCount}`);
    console.log(`  同店重复跳过:    ${stats.duplicateCount}`);
    console.log(`  ${isApply ? '实际认领' : '待认领'}数:      ${stats.claimedCount}`);
    console.log(`  失败数:          ${stats.failedCount}`);
    console.log('');
    if (!isApply && stats.claimedCount > 0) {
      console.log('  ⚠️  以上为 dry-run 结果，未写库。');
      console.log('      确认无误后执行 --apply 写入数据库。');
      console.log('');
    }
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('脚本执行失败:', error);
  process.exit(1);
});

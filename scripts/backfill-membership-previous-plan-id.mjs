/**
 * 会员档案「原档位」回填脚本（store_membership_profiles.previous_plan_id）
 *
 * ── 用途 ──────────────────────────────────────────────────────────────────
 *
 *   「已被设为免费」的档案（current_plan_id 为空）在修复前降级时没有转存原档位，
 *   previous_plan_id 为空 → resolveStoredMembershipLevel 回落成 'free' → 曾开通
 *   子账号功能的门店被错判成年度档：AGES(永久) 门店的续费页只剩年度卡，拿不到
 *   ¥398 的 AGES 续费入口。本脚本按历史成交记录反推「原档位」并回填。
 *
 * ── 判据（只处理同时满足的行）─────────────────────────────────────────────
 *
 *   current_plan_id IS NULL       —— 当前不是在册会员（在册会员一律不动）
 *   previous_plan_id IS NULL      —— 幂等：已回填 / 已由新代码转存过的不动
 *   pulse_sub_account_quota > 0   —— 续费档位保护只在「曾开通子账号功能」时生效
 *                                    （featureOwned = pulse_sub_account_quota > 0），
 *                                    其余门店续费页恒为月/季/年，回填无收益，只统计不入库
 *
 * ── 原档位推断来源（按优先级）─────────────────────────────────────────────
 *
 *   1. 最近一笔 status = 'paid' 的会员订单的 plan_id
 *   2. 无已支付订单时，回落最近一条首购锁定价（store_membership_locked_prices）的 plan_id
 *      锁定价只在「曾开通子账号功能」时写入，且关闭配额时会被清空，故仅作备选
 *
 *   两者都取不到 → 无法判断，列入「需人工核对」清单，不写库。
 *
 * ── 用法 ──────────────────────────────────────────────────────────────────
 *
 *   pnpm membership:backfill-previous-plan                        # dry-run（默认，只读）
 *   pnpm membership:backfill-previous-plan -- --apply             # 写库
 *   pnpm membership:backfill-previous-plan -- --database-url=...   # 指定库（预发/生产）
 *
 *   连接串来源（优先级）：
 *     1. --database-url=postgres://...  显式指定，预发/生产用
 *        预发/生产：set -a && source /etc/purelyprofit-server/production.env && set +a
 *                  pnpm run membership:backfill-previous-plan -- --database-url="$DATABASE_URL"
 *     2. 仓库根目录 .env 的 DATABASE_URL（本地开发默认）
 *   本脚本不直接读取环境变量（仓规 Rule 6：统一走配置入口），只能显式传参或依赖 .env
 *
 * ── 安全保证 ──────────────────────────────────────────────────────────────
 *
 *   - 默认 dry-run，不写库；--apply 才真正更新
 *   - 只写 previous_plan_id，不碰 current_plan_id / expires_at / starts_at / 配额
 *   - 不覆盖已有的 previous_plan_id，重复执行幂等
 *   - previous_plan_id 只影响「续费页可见档位」，不会激活会员、不发放任何权益；
 *     要恢复会员仍需在续费页正常下单支付
 *
 * ── 前置条件 ──────────────────────────────────────────────────────────────
 *
 *   迁移 20260916093000_add_store_membership_previous_plan_id 已部署。
 *   该迁移刻意不回填历史数据（清空后的 current_plan_id 无法在 SQL 里可靠还原），
 *   本脚本就是它的配套数据修复，建议 dry-run 核对清单后再 --apply。
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const isApply = process.argv.includes('--apply');

// ─── 工具 ─────────────────────────────────────────────────────────────────

/** 续费页文案：回填后该门店会看到哪张续费卡 */
function describeRenewalCard(planId) {
  return planId === 'lifetime' ? 'AGES(永久) 卡' : '年度卡';
}

function formatDate(value) {
  return value instanceof Date && !Number.isNaN(value.getTime())
    ? value.toISOString().slice(0, 10)
    : '—';
}

function resolveDatabaseUrl() {
  const fromArg = process.argv.find((arg) => arg.startsWith('--database-url='));
  if (fromArg) {
    return fromArg.slice('--database-url='.length).trim();
  }

  // 本地开发：读仓库根目录 .env（不写回环境变量，见文件头 Rule 6 说明）
  const envPath = resolve(__dirname, '..', '.env');
  if (existsSync(envPath)) {
    const match = readFileSync(envPath, 'utf-8').match(
      /^DATABASE_URL=["']?(.+?)["']?\s*$/m,
    );
    if (match) {
      return match[1];
    }
  }

  return null;
}

/** 打印目标库（只取 host + db，不含账号密码），避免误连生产 */
function describeTargetDatabase(databaseUrl) {
  try {
    const parsed = new URL(databaseUrl);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return '(无法解析连接串)';
  }
}

// ─── 原档位推断 ───────────────────────────────────────────────────────────

/** 锁定价来源可读化（purchase = 门店首购时写入，admin = 运营补偿写入） */
function describeLockedPriceSource(source) {
  if (source === 'purchase') {
    return '首购锁定';
  }
  if (source === 'admin') {
    return '运营设置';
  }
  return String(source);
}

/**
 * 反推门店的原档位。
 *
 * 只取「已支付」订单：pending / failed / refunded 不代表门店曾拥有该档位。
 * paidAt 为空的脏数据无法参与排序（DESC 下 NULL 会排在最前），显式排除后回落锁定价，
 * 避免把一笔时间不明的老订单当成最近成交。
 */
async function resolveOriginalPlan(prisma, storeId) {
  const latestPaidOrder = await prisma.storeMembershipOrder.findFirst({
    where: { storeId, status: 'paid', paidAt: { not: null } },
    orderBy: [{ paidAt: 'desc' }, { id: 'desc' }],
    select: { id: true, planId: true, planName: true, paidAt: true },
  });

  if (latestPaidOrder) {
    return {
      planId: latestPaidOrder.planId,
      source: `订单 #${latestPaidOrder.id}`,
      evidence: `${latestPaidOrder.planName ?? '-'} · ${formatDate(latestPaidOrder.paidAt)}`,
    };
  }

  const latestLockedPrice = await prisma.storeMembershipLockedPrice.findFirst({
    where: { storeId },
    orderBy: [{ lockedAt: 'desc' }, { id: 'desc' }],
    select: { id: true, planId: true, source: true, lockedAt: true },
  });

  if (latestLockedPrice) {
    return {
      planId: latestLockedPrice.planId,
      source: `锁定价 #${latestLockedPrice.id}`,
      evidence: `${describeLockedPriceSource(latestLockedPrice.source)} · ${formatDate(latestLockedPrice.lockedAt)}`,
    };
  }

  return null;
}

/** 缺少新增列时给出可执行的提示，而不是抛 Prisma 原始错误 */
function isMissingSchemaError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    error?.code === 'P2022' ||
    message.includes('previous_plan_id') ||
    message.includes('previousPlanId') ||
    message.includes('pulse_sub_account_quota')
  );
}

// ─── 主逻辑 ───────────────────────────────────────────────────────────────

async function main() {
  const databaseUrl = resolveDatabaseUrl();
  if (!databaseUrl) {
    console.error('未拿到数据库连接串，请用下列方式之一重试：');
    console.error('  1) 在仓库根目录 .env 中配置 DATABASE_URL（本地开发）');
    console.error(
      '  2) 显式传参：pnpm run membership:backfill-previous-plan -- --database-url="postgres://..."',
    );
    process.exit(1);
  }

  // Prisma 7 的 datasource 不写 url（见 prisma/schema.prisma），必须显式传驱动适配器
  const { PrismaClient } = await import('@prisma/client');
  const { PrismaPg } = await import('@prisma/adapter-pg');
  const { default: pg } = await import('pg');

  const pool = new pg.Pool({ connectionString: databaseUrl });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  const stats = {
    candidates: 0,
    inferable: 0,
    updated: 0,
    unresolved: [],
    failed: [],
    skippedNoSubAccount: 0,
  };

  try {
    console.log('');
    console.log('═══════════════════════════════════════════════════════');
    console.log('  会员档案原档位（previous_plan_id）回填脚本');
    console.log(`  模式: ${isApply ? 'APPLY（写库）' : 'DRY-RUN（只读）'}`);
    console.log(`  目标库: ${describeTargetDatabase(databaseUrl)}`);
    console.log('═══════════════════════════════════════════════════════');
    console.log('');

    // 1. 候选：已被设为免费、且尚未转存原档位的「曾开通子账号功能」门店
    const profiles = await prisma.storeMembershipProfile.findMany({
      where: {
        currentPlanId: null,
        previousPlanId: null,
        pulseSubAccountQuota: { gt: 0 },
      },
      select: {
        storeId: true,
        expiresAt: true,
        store: { select: { name: true } },
      },
      orderBy: { storeId: 'asc' },
    });

    stats.candidates = profiles.length;
    console.log(`候选档案（已设为免费 + 曾开通子账号功能）：${profiles.length} 条`);
    console.log('');

    // 2. 同形态但未开通子账号功能的档案：续费页档位不受 previous_plan_id 影响，只统计
    stats.skippedNoSubAccount = await prisma.storeMembershipProfile.count({
      where: {
        currentPlanId: null,
        previousPlanId: null,
        OR: [
          { pulseSubAccountQuota: null },
          { pulseSubAccountQuota: { lte: 0 } },
        ],
      },
    });

    if (profiles.length > 0) {
      console.log(
        '| 门店ID | 门店名称 | 原档位 | 依据 | 到期时间 | 回填后续费页 |',
      );
      console.log(
        '|--------|----------|--------|------|----------|--------------|',
      );
    }

    for (const profile of profiles) {
      const resolved = await resolveOriginalPlan(prisma, profile.storeId);
      const storeName = profile.store?.name ?? '(未知门店)';

      if (!resolved) {
        stats.unresolved.push(profile.storeId);
        console.log(
          `| ${profile.storeId} | ${storeName} | — | 无订单/无锁定价 | ${formatDate(profile.expiresAt)} | 待人工核对 |`,
        );
        continue;
      }

      stats.inferable++;

      if (isApply) {
        try {
          await prisma.storeMembershipProfile.update({
            where: { storeId: profile.storeId },
            data: { previousPlanId: resolved.planId },
          });
          stats.updated++;
        } catch (error) {
          stats.failed.push(profile.storeId);
          console.error(
            `| ${profile.storeId} | ${storeName} | ${resolved.planId} | ${resolved.source} | ${formatDate(profile.expiresAt)} | 更新失败: ${error.message} |`,
          );
          continue;
        }
      }

      console.log(
        `| ${profile.storeId} | ${storeName} | ${resolved.planId} | ${resolved.source}（${resolved.evidence}） | ${formatDate(profile.expiresAt)} | ${describeRenewalCard(resolved.planId)} |`,
      );
    }

    console.log('');
    console.log('═══════════════════════════════════════════════════════');
    console.log('  回填结果摘要');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`  候选档案:            ${stats.candidates}`);
    console.log(`  可推断原档位:        ${stats.inferable}`);
    console.log(
      `  ${isApply ? '实际更新' : '待更新'}数:        ${isApply ? stats.updated : stats.inferable}`,
    );
    console.log(
      `  无法推断（人工核对）: ${stats.unresolved.length > 0 ? stats.unresolved.join(', ') : '无'}`,
    );
    console.log(
      `  更新失败:            ${stats.failed.length > 0 ? stats.failed.join(', ') : '无'}`,
    );
    console.log(
      `  未纳入（无子账号功能，回填无收益）: ${stats.skippedNoSubAccount}`,
    );
    console.log('');

    if (!isApply && stats.inferable > 0) {
      console.log('  以上为 dry-run 结果，未写库。');
      console.log('  核对「回填后续费页」列符合预期后执行 --apply 写入。');
    }

    if (stats.unresolved.length > 0) {
      console.log('');
      console.log('  无法推断的门店没有付费记录，请人工确认其原档位后单独 UPDATE：');
      console.log(
        "    UPDATE store_membership_profiles SET previous_plan_id = '<原档位>', updated_at = NOW() AT TIME ZONE 'UTC'",
      );
      console.log(
        `      WHERE store_id IN (${stats.unresolved.join(', ')}) AND current_plan_id IS NULL AND previous_plan_id IS NULL;`,
      );
    }

    console.log('');
    console.log('  回填后可用 platform-membership/plans 验证：AGES 门店应只看到 AGES 卡。');
    console.log('');
  } catch (error) {
    if (isMissingSchemaError(error)) {
      console.error('原始错误：', error.message);
      console.error('');
      console.error('目标列不存在，请先部署迁移：');
      console.error('  pnpm prisma:migrate:deploy');
      // 用 exitCode 而不是 process.exit，保证 finally 里能正常释放连接
      process.exitCode = 1;
      return;
    }

    throw error;
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

try {
  await main();
} catch (error) {
  console.error('脚本执行失败:', error);
  process.exit(1);
}

/**
 * 重算顾客累计消费 / 消费次数（与展示端统一口径）
 *
 * ── 背景 ──────────────────────────────────────────────────────────────────
 *
 * 展示侧（营销顾客详情/列表、会员护理档案）统一改为「消费流水聚合 − 退款单冲减」：
 *   - 累计消费 = SUM(marketing_consumptions.amount) − 已退款团购券 (refund_amount_fen + points_deduct_fen)
 *   - 消费次数 = 正向流水笔数 − 已退款团购券笔数
 *
 * 但 `marketing_customers.total_spent / visit_count` 这些物化字段由各写入链路维护，
 * 历史上存在两类漂移：
 *   1. 团购券退款只回退物化、不冲减展示口径 → 物化比流水少（退款部分）；
 *   2. 团购券/服务订单结算时物化只加实付、不含积分抵扣 → 物化比流水少（积分抵扣部分）。
 *
 * 代码侧已修复（物化与流水同口径、扫码点餐补物化），本脚本负责处理**存量数据**：
 * 按统一口径重算受影响顾客的 total_spent / visit_count / last_visit_at / tier。
 *
 * ── 用法 ──────────────────────────────────────────────────────────────────
 *
 *   # dry-run（默认，只打印重算差异，不写库）
 *   pnpm marketing:backfill-consumption-refunds
 *
 *   # 实际写库
 *   pnpm marketing:backfill-consumption-refunds --apply
 *
 *   # 重算全部有流水的顾客（默认只处理有退款单的顾客）
 *   pnpm marketing:backfill-consumption-refunds --all-customers
 *
 *   # 限定门店 / 顾客
 *   BACKFILL_STORE_IDS=42 pnpm marketing:backfill-consumption-refunds
 *   BACKFILL_CUSTOMER_IDS=324 pnpm marketing:backfill-consumption-refunds
 *
 * ── 安全保证 ──────────────────────────────────────────────────────────────
 *
 *   - 默认 dry-run，--apply 才写库；
 *   - 幂等：重算结果只取决于流水与退款单，重复执行结果不变；
 *   - 只更新 4 个派生字段，不动余额 / 积分 / 流水；
 *   - 退款只统计 payment_channel = 'balance'（与消费流水的写入链路对称）。
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── 参数解析 ──────────────────────────────────────────────────────────────

const isApply = process.argv.includes('--apply');
const allCustomers = process.argv.includes('--all-customers');

const parseIdList = (raw) =>
  (raw ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0);

const storeIdFilter = parseIdList(process.env.BACKFILL_STORE_IDS);
const customerIdFilter = parseIdList(process.env.BACKFILL_CUSTOMER_IDS);

/** 默认等级阈值（元），与 marketing-member-level.config.ts 保持一致 */
const DEFAULT_LEVEL_THRESHOLDS = { gold: 5000, diamond: 10000 };

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

// ─── 等级阈值 ──────────────────────────────────────────────────────────────

/** 读取门店会员等级设置里的 tier 阈值（分），与 queryCustomerTierThresholds 同口径 */
async function resolveTierThresholds(prisma, storeId) {
  const record = await prisma.marketingMemberLevelSetting.findUnique({
    where: { storeId },
    select: { levels: true },
  });
  const rawLevels =
    record?.levels &&
    typeof record.levels === 'object' &&
    Array.isArray(record.levels.levels)
      ? record.levels.levels
      : null;

  const pick = (id, fallback) => {
    const match = rawLevels?.find((level) => level.id === id);
    return typeof match?.spendThreshold === 'number'
      ? match.spendThreshold
      : fallback;
  };

  // gold tier 门槛 ← platinum 阈值；diamond tier 门槛 ← diamond 阈值（单位：元）
  return {
    gold: pick('platinum', DEFAULT_LEVEL_THRESHOLDS.gold) * 100,
    diamond: pick('diamond', DEFAULT_LEVEL_THRESHOLDS.diamond) * 100,
  };
}

const calcTier = (totalSpentCents, thresholds) => {
  if (totalSpentCents >= thresholds.diamond) return 'diamond';
  if (totalSpentCents >= thresholds.gold) return 'gold';
  return 'regular';
};

const formatYuan = (cents) => (cents / 100).toFixed(2);

// ─── 口径计算 ──────────────────────────────────────────────────────────────

/** 与 computeCustomerConsumptionStats 完全同口径 */
async function computeNextMetrics(prisma, customerId) {
  const [sum, positive, refunds] = await Promise.all([
    prisma.marketingConsumption.aggregate({
      where: { customerId },
      _sum: { amount: true },
    }),
    prisma.marketingConsumption.aggregate({
      where: { customerId, amount: { gt: 0 } },
      _max: { createdAt: true },
      _count: { _all: true },
    }),
    prisma.clubVoucherOrder.aggregate({
      where: {
        customerId,
        status: 'refunded',
        paymentChannel: 'balance',
        refundAmountFen: { not: null },
      },
      _sum: { refundAmountFen: true, pointsDeductFen: true },
      _count: { _all: true },
    }),
  ]);

  const refundedCents =
    (refunds._sum.refundAmountFen ?? 0) + (refunds._sum.pointsDeductFen ?? 0);

  return {
    totalSpent: Math.max((sum._sum.amount ?? 0) - refundedCents, 0),
    visitCount: Math.max(positive._count._all - refunds._count._all, 0),
    lastVisitAt: positive._max.createdAt ?? null,
  };
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

  const stats = { customerCount: 0, correctedCount: 0 };

  try {
    console.log('');
    console.log('═══════════════════════════════════════════════════════');
    console.log('  顾客累计消费 / 消费次数 重算（流水聚合 − 退款单）');
    console.log(`  模式: ${isApply ? '⚡ APPLY（写库）' : '🔍 DRY-RUN（只读）'}`);
    if (allCustomers) {
      console.log('  范围: 全部有消费流水的顾客');
    } else {
      console.log('  范围: 有已退款团购券的顾客（--all-customers 可全量）');
    }
    if (storeIdFilter.length > 0) {
      console.log(`  门店限定: ${storeIdFilter.join(', ')}`);
    }
    if (customerIdFilter.length > 0) {
      console.log(`  顾客限定: ${customerIdFilter.join(', ')}`);
    }
    console.log('═══════════════════════════════════════════════════════');
    console.log('');

    const customerWhere = {
      deletedAt: null,
      ...(storeIdFilter.length > 0 ? { storeId: { in: storeIdFilter } } : {}),
      ...(customerIdFilter.length > 0 ? { id: { in: customerIdFilter } } : {}),
    };

    let customerIds;

    if (allCustomers) {
      const customers = await prisma.marketingCustomer.findMany({
        where: {
          ...customerWhere,
          consumptions: { some: {} },
        },
        select: { id: true },
        orderBy: { id: 'asc' },
      });
      customerIds = customers.map((item) => item.id);
    } else {
      const refundedOrders = await prisma.clubVoucherOrder.findMany({
        where: {
          status: 'refunded',
          paymentChannel: 'balance',
          refundAmountFen: { not: null },
          customerId:
            customerIdFilter.length > 0
              ? { in: customerIdFilter }
              : { not: null },
          ...(storeIdFilter.length > 0
            ? { storeId: { in: storeIdFilter } }
            : {}),
        },
        select: { customerId: true },
      });
      customerIds = [
        ...new Set(
          refundedOrders
            .map((item) => item.customerId)
            .filter((id) => typeof id === 'number'),
        ),
      ];
    }

    stats.customerCount = customerIds.length;
    if (customerIds.length === 0) {
      console.log('  没有命中的顾客，无需重算。');
      console.log('');
      return;
    }

    const thresholdsByStore = new Map();
    const corrections = [];

    for (const customerId of customerIds) {
      // eslint-disable-next-line no-await-in-loop
      const customer = await prisma.marketingCustomer.findUnique({
        where: { id: customerId },
        select: {
          id: true,
          storeId: true,
          totalSpent: true,
          visitCount: true,
          lastVisitAt: true,
        },
      });
      if (!customer) continue;

      // eslint-disable-next-line no-await-in-loop
      const next = await computeNextMetrics(prisma, customerId);

      if (!thresholdsByStore.has(customer.storeId)) {
        // eslint-disable-next-line no-await-in-loop
        const thresholds = await resolveTierThresholds(prisma, customer.storeId);
        thresholdsByStore.set(customer.storeId, thresholds);
      }
      const nextTier = calcTier(
        next.totalSpent,
        thresholdsByStore.get(customer.storeId),
      );

      if (
        customer.totalSpent === next.totalSpent &&
        customer.visitCount === next.visitCount &&
        customer.lastVisitAt?.getTime() === next.lastVisitAt?.getTime()
      ) {
        continue;
      }

      corrections.push({
        customerId,
        current: {
          totalSpent: customer.totalSpent,
          visitCount: customer.visitCount,
        },
        next: { ...next, tier: nextTier },
      });
    }

    stats.correctedCount = corrections.length;

    if (corrections.length === 0) {
      console.log(`  检查顾客: ${stats.customerCount}，物化字段已与统一口径一致。`);
      console.log('');
      return;
    }

    console.log(`  检查顾客: ${stats.customerCount}`);
    console.log(`  需要修正: ${corrections.length}`);
    console.log('');
    console.log('  ── 重算明细 ──');
    for (const item of corrections) {
      console.log(
        `    customer ${item.customerId}: ` +
          `¥${formatYuan(item.current.totalSpent)} / ${item.current.visitCount} 次` +
          ` → ¥${formatYuan(item.next.totalSpent)} / ${item.next.visitCount} 次 (tier=${item.next.tier})`,
      );
    }
    console.log('');

    if (!isApply) {
      console.log('  🔍 DRY-RUN 结束，未写库。加 --apply 执行。');
      console.log('');
      return;
    }

    await prisma.$transaction(
      async (tx) => {
        for (const item of corrections) {
          // eslint-disable-next-line no-await-in-loop
          await tx.marketingCustomer.update({
            where: { id: item.customerId },
            data: {
              totalSpent: item.next.totalSpent,
              visitCount: item.next.visitCount,
              lastVisitAt: item.next.lastVisitAt,
              tier: item.next.tier,
            },
          });
        }
      },
      { timeout: 120_000 },
    );

    console.log('  ✅ 重算完成');
    console.log(`     修正顾客: ${stats.correctedCount}`);
    console.log('');
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('');
  console.error('❌ 重算失败:', error);
  process.exit(1);
});

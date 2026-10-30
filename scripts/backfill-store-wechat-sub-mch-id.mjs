/**
 * 门店微信收款「子商户号」回填脚本（服务商模式改造 · P1）
 *
 * ── 背景 ──────────────────────────────────────────────────────────────────
 * 原直连模式下门店填的是自己的商户号（store_wechat_pay_configs.mch_id），
 * 服务商模式下该语义迁移到 sub_mch_id。迁移 SQL 已做一次性回填，
 * 本脚本用于**迁移之后新增/遗漏的记录**补齐，或迁移失败后手工重跑。
 *
 * ── 用法 ──────────────────────────────────────────────────────────────────
 *
 *   # dry-run（默认，只打印待回填门店，不写库）
 *   pnpm wechat:partner:sub-mchid:backfill
 *
 *   # 实际写库
 *   pnpm wechat:partner:sub-mchid:backfill --apply
 *
 * ── 安全保证 ──────────────────────────────────────────────────────────────
 *   - 默认 dry-run，--apply 才写库
 *   - 只回填 sub_mch_id 为空且 mch_id 非空的记录，**不覆盖**已配置的子商户号
 *   - 重复执行幂等
 *   - 回填后置 bind_status = pending，仍需走授权校验才可收款
 *
 * ── 说明 ──────────────────────────────────────────────────────────────────
 * ⚠️ 本脚本直读 process.env.DATABASE_URL，会命中 check-f0rest-rules 的 Rule 6。
 *    这是**有意为之**并与既有基线一致：ops 脚本不进入 Nest 容器，拿不到 ConfigService，
 *    scripts/backfill-store-business-mode.mjs、scripts/backfill-marketing-consumption-refunds.mjs
 *    两个既有脚本同样是 exit=1。请勿为了「过规则」把它改成读配置文件。
 *    同理，`pnpm exec eslint <本文件>` 会报「not found by the project service」，
 *    因为该目录不在 tsconfig 覆盖范围内；项目自己的 lint 只扫 src / apps / libs / test
 *    下的 TS 文件，本来就不包含 ops 脚本，属既有基线行为。
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const isApply = process.argv.includes('--apply');

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  const envPath = resolve(__dirname, '..', '.env');
  if (existsSync(envPath)) {
    const match = readFileSync(envPath, 'utf-8').match(
      /^DATABASE_URL=["']?(.+?)["']?\s*$/m,
    );
    if (match) {
      process.env.DATABASE_URL = match[1];
    }
  }
  return process.env.DATABASE_URL;
}

async function createPrismaClient() {
  const { PrismaClient } = await import('@prisma/client');
  const { PrismaPg } = await import('@prisma/adapter-pg');
  const { default: pg } = await import('pg');

  const pool = new pg.Pool({ connectionString: loadDatabaseUrl() });
  return { prisma: new PrismaClient({ adapter: new PrismaPg(pool) }), pool };
}

async function main() {
  if (!loadDatabaseUrl()) {
    console.error('❌ 无法找到 DATABASE_URL 环境变量');
    process.exit(1);
  }

  const { prisma, pool } = await createPrismaClient();

  try {
    const targets = await prisma.storeWechatPayConfig.findMany({
      where: {
        OR: [{ subMchId: null }, { subMchId: '' }],
        NOT: { mchId: '' },
      },
      select: { storeId: true, mchId: true, subMchId: true },
      orderBy: { storeId: 'asc' },
    });

    console.log('');
    console.log('═══════════════════════════════════════════════════════');
    console.log('  门店微信收款子商户号回填脚本');
    console.log(
      `  模式: ${isApply ? '⚡ APPLY（写库）' : '🔍 DRY-RUN（只读）'}`,
    );
    console.log(`  待回填记录数: ${targets.length}`);
    console.log('═══════════════════════════════════════════════════════');

    for (const record of targets) {
      console.log(
        `  storeId=${record.storeId} mch_id=${record.mchId} → sub_mch_id=${record.mchId}`,
      );
    }

    if (!isApply) {
      console.log('');
      console.log('🔍 DRY-RUN 未写库，确认无误后追加 --apply 执行');
      return;
    }

    let updated = 0;
    for (const record of targets) {
      await prisma.storeWechatPayConfig.update({
        where: { storeId: record.storeId },
        data: { subMchId: record.mchId, bindStatus: 'pending' },
      });
      updated += 1;
    }

    console.log('');
    console.log(
      `✅ 已回填 ${updated} 条门店收款配置（bind_status 重置为 pending）`,
    );
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

await main();

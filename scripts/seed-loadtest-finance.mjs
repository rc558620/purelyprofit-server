/**
 * 压测数据构造 — 财务流水批次（FinanceCashFlowRecord）
 *
 * 用法：
 *   node scripts/seed-loadtest-finance.mjs              # 造档 B 默认 30 天数据
 *   node scripts/seed-loadtest-finance.mjs --days=7     # 造 7 天数据
 *   node scripts/seed-loadtest-finance.mjs --cleanup    # 清理本脚本造的数据
 *
 * 前置依赖：需先执行 seed-loadtest-stores.mjs（门店）
 *
 * 环境变量：
 *   LOADTEST_FINANCE_DAYS    覆盖天数（同 --days，默认 30）
 *   LOADTEST_FINANCE_PER_DAY 每店每天流水条数（默认 30）
 *
 * 安全设计：
 *   1. 禁止在 NODE_ENV=production 下执行
 *   2. 幂等标记：finance_cash_flow_records.note = 'loadtest'
 *   3. --cleanup 只清理带标记的数据
 *   4. 默认 dry-run 模式，需加 --yes 确认执行
 *   5. 使用 raw SQL 分批 INSERT（5000 行/批），避免 Prisma createMany 内存溢出
 *
 * 数据量（档B 500 店 × 30 天 × 30 条/日 = 45 万行）：
 *   - 450000 FinanceCashFlowRecord
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnvFile(resolve(__dirname, '../.env'));

if (process.env.NODE_ENV === 'production') {
  throw new Error('❌ 禁止在生产环境执行压测数据构造脚本');
}

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  throw new Error('缺少 DATABASE_URL，无法构造压测数据');
}

const pool = new Pool({ connectionString: databaseUrl });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const args = process.argv.slice(2);
const CONFIRMED = args.includes('--yes');
const CLEANUP = args.includes('--cleanup');
const daysArg = args.find((a) => a.startsWith('--days='));
const DAYS = parsePositiveInt(
  daysArg?.split('=')[1] ?? process.env.LOADTEST_FINANCE_DAYS,
  30,
);
const RECORDS_PER_DAY = parsePositiveInt(
  process.env.LOADTEST_FINANCE_PER_DAY,
  30,
);

const STORE_PREFIX = '压测门店';
const LOADTEST_NOTE = 'loadtest';
const BATCH_SIZE = 5000;

const DIRECTIONS = ['income', 'expense'];
const INCOME_CATEGORIES = ['sales', 'platform_settlement', 'transfer_in', 'other_income'];
const EXPENSE_CATEGORIES = ['purchase', 'rent', 'utilities', 'salary', 'marketing', 'tax', 'platform_fee', 'transfer_out', 'other_expense'];
const PAYMENTS = ['cash', 'wechat', 'alipay', 'card', 'bank', 'other'];

// ── 主流程 ────────────────────────────────────────────────────────
async function main() {
  if (CLEANUP) {
    await runCleanup();
    return;
  }

  console.log('\n💰 压测数据构造 — 财务流水批次\n');
  console.log(`  覆盖天数    ${DAYS}`);
  console.log(`  流水/店/日  ${RECORDS_PER_DAY}`);
  console.log(`  模式        ${CONFIRMED ? '⚠️ 执行写入' : '🔍 dry-run'}`);
  console.log('');

  // 查找压测门店
  const stores = await prisma.store.findMany({
    where: { name: { startsWith: STORE_PREFIX }, deletedAt: null },
    select: { id: true, name: true },
    orderBy: { id: 'asc' },
  });

  if (stores.length === 0) {
    throw new Error('未找到压测门店，请先执行 seed-loadtest-stores.mjs');
  }

  const totalRecords = stores.length * DAYS * RECORDS_PER_DAY;
  console.log(`  压测门店    ${stores.length}`);
  console.log(`  预计流水    ${totalRecords}`);
  console.log('');

  if (!CONFIRMED) {
    console.log('ℹ️  这是 dry-run。确认无误后追加 --yes 执行写入。\n');
    return;
  }

  const startedAt = Date.now();
  let created = 0;
  const now = new Date();
  const storeIds = stores.map((s) => s.id);

  // 按天生成，分批 raw SQL INSERT
  let batchValues = [];

  for (let dayOffset = 0; dayOffset < DAYS; dayOffset++) {
    const businessDate = new Date(now.getTime() - dayOffset * 24 * 60 * 60 * 1000);
    businessDate.setUTCHours(0, 0, 0, 0);

    for (const store of stores) {
      for (let recordIdx = 0; recordIdx < RECORDS_PER_DAY; recordIdx++) {
        const direction = DIRECTIONS[recordIdx % 2];
        const categories = direction === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
        const category = categories[recordIdx % categories.length];
        const payment = PAYMENTS[recordIdx % PAYMENTS.length];
        const amount = Math.floor(Math.random() * 50000) + 1000;
        const createdAt = new Date(businessDate.getTime() + Math.random() * 20 * 60 * 60 * 1000 + 8 * 60 * 60 * 1000);
        const title = `${direction === 'income' ? '收入' : '支出'}-${category}-${recordIdx + 1}`;

        batchValues.push([
          store.id,
          null, // sale_order_id
          null, // sale_order_refund_id
          null, // operator_staff_id
          direction,
          category,
          title,
          amount,
          payment,
          LOADTEST_NOTE,
          businessDate,
          createdAt,
          createdAt,
        ]);

        // 达到批量大小时执行 INSERT
        if (batchValues.length >= BATCH_SIZE) {
          await flushBatch(batchValues);
          created += batchValues.length;
          batchValues = [];
        }
      }
    }

    // 每天结束后 flush 剩余
    if (batchValues.length > 0) {
      await flushBatch(batchValues);
      created += batchValues.length;
      batchValues = [];
    }

    const elapsed = Date.now() - startedAt;
    console.log(`  进度: day ${dayOffset + 1}/${DAYS}, records=${created} (${elapsed}ms)`);
  }

  const elapsed = Date.now() - startedAt;
  console.log('\n========== 压测财务流水数据构造完成 ==========');
  console.log(`  流水        ${created}`);
  console.log(`  耗时        ${elapsed}ms`);
  console.log('===============================================\n');
}

async function flushBatch(values) {
  if (values.length === 0) return;

  // 构建批量 INSERT
  const colCount = 13;
  const placeholders = values
    .map(
      (_, idx) =>
        `(${Array.from({ length: colCount }, (_, c) => `$${idx * colCount + c + 1}`).join(', ')})`,
    )
    .join(', ');

  const flatParams = values.flat();

  const sql = `
    INSERT INTO finance_cash_flow_records (
      store_id, sale_order_id, sale_order_refund_id, operator_staff_id,
      direction, category, title, amount, payment, note, date, created_at, updated_at
    ) VALUES ${placeholders}
  `;

  await prisma.$executeRawUnsafe(sql, ...flatParams);
}

async function runCleanup() {
  console.log('\n🧹 压测财务流水数据清理\n');
  console.log(`  模式  ${CONFIRMED ? '⚠️ 执行删除' : '🔍 dry-run'}`);

  // 查找压测门店
  const stores = await prisma.store.findMany({
    where: { name: { startsWith: STORE_PREFIX }, deletedAt: null },
    select: { id: true },
  });
  const storeIds = stores.map((s) => s.id);

  // 统计压测流水
  const count = await prisma.financeCashFlowRecord.count({
    where: { storeId: { in: storeIds }, note: LOADTEST_NOTE },
  });

  console.log(`  压测流水  ${count}`);
  console.log('');

  if (count === 0) {
    console.log('✅ 没有需要清理的压测财务流水数据\n');
    return;
  }

  if (!CONFIRMED) {
    console.log('ℹ️  这是 dry-run。确认无误后追加 --yes 执行删除。\n');
    return;
  }

  console.log('开始删除…\n');

  const deleted = await prisma.financeCashFlowRecord.deleteMany({
    where: { storeId: { in: storeIds }, note: LOADTEST_NOTE },
  });
  console.log(`  finance_cash_flow_records  ${deleted.count}`);

  console.log('\n✅ 清理完成\n');
}

// ── 工具 ──────────────────────────────────────────────────────────
function parsePositiveInt(rawValue, fallbackValue) {
  const parsedValue = Number.parseInt(rawValue || '', 10);
  return Number.isNaN(parsedValue) || parsedValue <= 0 ? fallbackValue : parsedValue;
}

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
  } catch {
    // 忽略缺失 .env
  }
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

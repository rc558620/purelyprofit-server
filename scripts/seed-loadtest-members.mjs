/**
 * 压测数据构造 — 会员批次（Member + MarketingCustomer）
 *
 * 用法：
 *   node scripts/seed-loadtest-members.mjs              # 造档 B 默认 500 会员/店
 *   node scripts/seed-loadtest-members.mjs --count=100  # 造档 A 100 会员/店
 *   node scripts/seed-loadtest-members.mjs --cleanup    # 清理本脚本造的数据
 *
 * 前置依赖：需先执行 seed-loadtest-stores.mjs 创建压测门店
 *
 * 环境变量：
 *   LOADTEST_MEMBER_COUNT  每店会员数量（同 --count，默认 500）
 *
 * 安全设计：
 *   1. 禁止在 NODE_ENV=production 下执行
 *   2. 幂等标记：会员 phone 前缀「139」，MarketingCustomer remark='loadtest'
 *   3. --cleanup 只清理带标记的数据
 *   4. 默认 dry-run 模式，需加 --yes 确认执行
 *
 * 数据量（档B 500 店 × 500 会员/店 = 25 万行）：
 *   - 250000 Member + 250000 MarketingCustomer
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
const countArg = args.find((a) => a.startsWith('--count='));
const MEMBERS_PER_STORE = parsePositiveInt(
  countArg?.split('=')[1] ?? process.env.LOADTEST_MEMBER_COUNT,
  500,
);

const STORE_PREFIX = '压测门店';
const MEMBER_PHONE_PREFIX = '139';
const LOADTEST_REMARK = 'loadtest';

// ── 主流程 ────────────────────────────────────────────────────────
async function main() {
  if (CLEANUP) {
    await runCleanup();
    return;
  }

  console.log('\n👥 压测数据构造 — 会员批次\n');
  console.log(`  每店会员    ${MEMBERS_PER_STORE}`);
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

  console.log(`  压测门店    ${stores.length}`);
  console.log(`  预计总量    ${stores.length * MEMBERS_PER_STORE} 会员\n`);

  if (!CONFIRMED) {
    console.log('ℹ️  这是 dry-run。确认无误后追加 --yes 执行写入。\n');
    return;
  }

  const startedAt = Date.now();
  let created = 0;
  let skipped = 0;
  const BATCH_SIZE = 1000;

  for (const store of stores) {
    // 检查是否已有压测会员（幂等）
    const existingCount = await prisma.member.count({
      where: {
        storeId: store.id,
        phone: { startsWith: MEMBER_PHONE_PREFIX },
        deletedAt: null,
        note: LOADTEST_REMARK,
      },
    });

    if (existingCount >= MEMBERS_PER_STORE) {
      skipped += existingCount;
      continue;
    }

    const toCreate = MEMBERS_PER_STORE - existingCount;

    // 分批创建
    for (let batch = 0; batch < toCreate; batch += BATCH_SIZE) {
      const batchEnd = Math.min(batch + BATCH_SIZE, toCreate);
      const members = [];
      const customers = [];

      for (let i = batch; i < batchEnd; i++) {
        const globalIndex = existingCount + i;
        const phone = `${MEMBER_PHONE_PREFIX}${String(store.id).padStart(4, '0')}${String(globalIndex + 1).padStart(6, '0')}`;
        const name = `压测会员${store.id}-${globalIndex + 1}`;

        members.push({
          storeId: store.id,
          name,
          phone,
          status: 'active',
          note: LOADTEST_REMARK,
        });
      }

      // 批量插入 Member
      await prisma.member.createMany({ data: members, skipDuplicates: true });
      created += members.length;

      // 为这批 Member 创建 MarketingCustomer
      // 查回刚插入的 Member（按 phone 匹配）
      const phones = members.map((m) => m.phone);
      const insertedMembers = await prisma.member.findMany({
        where: { storeId: store.id, phone: { in: phones }, deletedAt: null },
        select: { id: true, phone: true, name: true },
      });

      for (const m of insertedMembers) {
        customers.push({
          storeId: store.id,
          memberId: m.id,
          name: m.name ?? `压测会员`,
          phone: m.phone ?? undefined,
          tier: 'regular',
          status: 'active',
          balance: Math.floor(Math.random() * 50000),
          points: Math.floor(Math.random() * 1000),
          totalSpent: Math.floor(Math.random() * 100000),
          visitCount: Math.floor(Math.random() * 50),
          remark: LOADTEST_REMARK,
        });
      }

      // 批量插入 MarketingCustomer
      if (customers.length > 0) {
        await prisma.marketingCustomer.createMany({
          data: customers,
          skipDuplicates: true,
        });
      }
    }

    if ((stores.indexOf(store) + 1) % 50 === 0) {
      const elapsed = Date.now() - startedAt;
      console.log(`  进度: ${stores.indexOf(store) + 1}/${stores.length} 门店, ${created} 会员 (${elapsed}ms)`);
    }
  }

  const elapsed = Date.now() - startedAt;
  console.log('\n========== 压测会员数据构造完成 ==========');
  console.log(`  新增会员    ${created}`);
  console.log(`  跳过已存在  ${skipped}`);
  console.log(`  耗时        ${elapsed}ms`);
  console.log('===========================================\n');
}

async function runCleanup() {
  console.log('\n🧹 压测会员数据清理\n');
  console.log(`  模式  ${CONFIRMED ? '⚠️ 执行删除' : '🔍 dry-run'}`);

  // 查找压测门店
  const stores = await prisma.store.findMany({
    where: { name: { startsWith: STORE_PREFIX }, deletedAt: null },
    select: { id: true },
  });
  const storeIds = stores.map((s) => s.id);

  // 查找压测 Member（按 note 标记）
  const memberCount = await prisma.member.count({
    where: {
      storeId: { in: storeIds },
      note: LOADTEST_REMARK,
      deletedAt: null,
    },
  });

  // 查找压测 MarketingCustomer（按 remark 标记）
  const customerCount = await prisma.marketingCustomer.count({
    where: {
      storeId: { in: storeIds },
      remark: LOADTEST_REMARK,
      deletedAt: null,
    },
  });

  console.log(`  压测 Member            ${memberCount}`);
  console.log(`  压测 MarketingCustomer ${customerCount}`);
  console.log('');

  if (memberCount === 0 && customerCount === 0) {
    console.log('✅ 没有需要清理的压测会员数据\n');
    return;
  }

  if (!CONFIRMED) {
    console.log('ℹ️  这是 dry-run。确认无误后追加 --yes 执行删除。\n');
    return;
  }

  console.log('开始删除…\n');

  // 先删 MarketingCustomer（有 memberId FK），再删 Member
  const delCustomers = await prisma.marketingCustomer.deleteMany({
    where: {
      storeId: { in: storeIds },
      remark: LOADTEST_REMARK,
    },
  });
  console.log(`  marketing_customers  ${delCustomers.count}`);

  const delMembers = await prisma.member.deleteMany({
    where: {
      storeId: { in: storeIds },
      note: LOADTEST_REMARK,
    },
  });
  console.log(`  members              ${delMembers.count}`);

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

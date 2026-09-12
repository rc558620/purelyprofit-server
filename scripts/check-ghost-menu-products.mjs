/**
 * 幽灵宿主回归检查（商品多规格改造 · Stage 0）
 *
 * 背景：非餐饮门店放开规格配置后，商品编辑保存会走 syncSpecifications。
 * 若「空规格短路」失效，未配置规格的商品每次编辑都会静默生成一条
 * ScanOrderingMenuProduct（isActive=false，仅作规格容器），即「幽灵宿主」，
 * 并可能连带创建同名 MenuCategory。本脚本用于把这件事量化并可回归。
 *
 * 幽灵宿主判定：deletedAt = null AND isActive = false AND productId != null
 *
 * 用法：
 *   node scripts/check-ghost-menu-products.mjs
 *       打印当前各门店的宿主与规格统计
 *   node scripts/check-ghost-menu-products.mjs --save baseline.json
 *       保存基线快照（上线前执行）
 *   node scripts/check-ghost-menu-products.mjs --diff baseline.json
 *       与基线对比，输出增量；幽灵宿主增加时以退出码 1 判定失败
 *   node scripts/check-ghost-menu-products.mjs --store 42
 *       只看指定门店
 *   node scripts/check-ghost-menu-products.mjs --list-ghosts
 *       列出幽灵宿主明细（供人工核对 / 清理脚本使用）
 *
 * 典型回归流程：
 *   1. node scripts/check-ghost-menu-products.mjs --save before.json
 *   2. 在商品列表编辑若干「不配置规格」的商品并保存
 *   3. node scripts/check-ghost-menu-products.mjs --diff before.json
 *      → 期望所有门店 delta 均为 0
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnvFile(resolve(__dirname, '../.env'));

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  throw new Error('缺少 DATABASE_URL，无法执行幽灵宿主检查');
}

const pool = new Pool({ connectionString: databaseUrl });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// ─── 参数解析 ────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const readFlag = (name) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : undefined;
};
const hasFlag = (name) => argv.includes(`--${name}`);

const savePath = readFlag('save');
const diffPath = readFlag('diff');
const storeFilter = readFlag('store');
const listGhosts = hasFlag('list-ghosts');

// ─── 采集 ────────────────────────────────────────────────────────────────
/** 单个门店的宿主与规格统计 */
async function collectStore(store) {
  const base = { storeId: store.id, deletedAt: null };

  const [menuProducts, ghostHosts, activeHosts, specGroups, specOptions] =
    await Promise.all([
      prisma.scanOrderingMenuProduct.count({ where: base }),
      // 幽灵宿主：未软删 + 未上架 + 挂着普通商品（即仅作规格容器存在）
      prisma.scanOrderingMenuProduct.count({
        where: { ...base, isActive: false, productId: { not: null } },
      }),
      prisma.scanOrderingMenuProduct.count({ where: { ...base, isActive: true } }),
      prisma.scanOrderingSpecGroup.count({
        where: { product: { storeId: store.id, deletedAt: null } },
      }),
      prisma.scanOrderingSpecOption.count({
        where: { group: { product: { storeId: store.id, deletedAt: null } } },
      }),
    ]);

  return {
    storeId: store.id,
    storeName: store.name,
    businessMode: store.businessMode ?? 'general',
    menuProducts,
    ghostHosts,
    activeHosts,
    specGroups,
    specOptions,
  };
}

async function collectAll() {
  const stores = await prisma.store.findMany({
    where: storeFilter
      ? { id: Number.parseInt(storeFilter, 10) }
      : { id: { gt: 0 } },
    select: { id: true, name: true, businessMode: true },
    orderBy: { id: 'asc' },
  });

  const rows = [];
  for (const store of stores) {
    // 串行即可：门店数量有限，避免并发打满连接池
    rows.push(await collectStore(store));
  }
  return rows;
}

// ─── 输出 ────────────────────────────────────────────────────────────────
const pad = (value, width) => String(value).padStart(width);
const padEnd = (value, width) => String(value).padEnd(width);

function printTable(rows) {
  const header = [
    padEnd('门店ID', 8),
    padEnd('业态', 10),
    padEnd('门店名称', 20),
    pad('宿主总数', 9),
    pad('幽灵宿主', 10),
    pad('已上架', 8),
    pad('规格组', 8),
    pad('规格项', 8),
  ].join('');
  console.log(header);
  console.log('-'.repeat(header.length));
  for (const row of rows) {
    console.log(
      [
        padEnd(row.storeId, 8),
        padEnd(row.businessMode, 10),
        padEnd(row.storeName.slice(0, 18), 20),
        pad(row.menuProducts, 9),
        pad(row.ghostHosts, 10),
        pad(row.activeHosts, 8),
        pad(row.specGroups, 8),
        pad(row.specOptions, 8),
      ].join(''),
    );
  }
  const total = rows.reduce(
    (acc, row) => ({
      menuProducts: acc.menuProducts + row.menuProducts,
      ghostHosts: acc.ghostHosts + row.ghostHosts,
      activeHosts: acc.activeHosts + row.activeHosts,
      specGroups: acc.specGroups + row.specGroups,
      specOptions: acc.specOptions + row.specOptions,
    }),
    { menuProducts: 0, ghostHosts: 0, activeHosts: 0, specGroups: 0, specOptions: 0 },
  );
  console.log('-'.repeat(header.length));
  console.log(
    [
      padEnd('合计', 38),
      pad(total.menuProducts, 9),
      pad(total.ghostHosts, 10),
      pad(total.activeHosts, 8),
      pad(total.specGroups, 8),
      pad(total.specOptions, 8),
    ].join(''),
  );
  return total;
}

async function printGhostDetails() {
  const ghosts = await prisma.scanOrderingMenuProduct.findMany({
    where: {
      deletedAt: null,
      isActive: false,
      productId: { not: null },
      ...(storeFilter ? { storeId: Number.parseInt(storeFilter, 10) } : {}),
    },
    select: {
      id: true,
      storeId: true,
      productId: true,
      name: true,
      createdAt: true,
      _count: { select: { specGroups: true } },
    },
    orderBy: [{ storeId: 'asc' }, { id: 'asc' }],
    take: 200,
  });

  if (ghosts.length === 0) {
    console.log('\n当前没有幽灵宿主。');
    return;
  }
  console.log('\n幽灵宿主明细（最多 200 条）：');
  for (const ghost of ghosts) {
    console.log(
      `  #${ghost.id} store=${ghost.storeId} productId=${ghost.productId} ` +
        `规格组=${ghost._count.specGroups} 名称=${ghost.name} 创建于=${ghost.createdAt.toISOString()}`,
    );
  }
  console.log(
    '\n注意：餐饮门店的 isActive=false 可能来自正常的「下架扫码点餐」，需人工区分。',
  );
}

// ─── 对比 ────────────────────────────────────────────────────────────────
const DELTA_FIELDS = [
  'menuProducts',
  'ghostHosts',
  'activeHosts',
  'specGroups',
  'specOptions',
];

function printDiff(baseline, current) {
  const baseMap = new Map(baseline.stores.map((row) => [row.storeId, row]));
  const currMap = new Map(current.map((row) => [row.storeId, row]));
  const allIds = [...new Set([...baseMap.keys(), ...currMap.keys()])].sort(
    (a, b) => a - b,
  );

  console.log(
    `基线采集于 ${baseline.capturedAt}（${baseline.stores.length} 家门店），当前 ${current.length} 家`,
  );
  console.log('');

  let ghostIncreased = 0;
  let changedStores = 0;

  for (const storeId of allIds) {
    const before = baseMap.get(storeId);
    const after = currMap.get(storeId);
    if (!before || !after) {
      console.log(
        `  门店 ${storeId}：${before ? '当前已不存在' : '基线中不存在'}（新增/删除，需人工确认）`,
      );
      changedStores += 1;
      continue;
    }

    const deltas = DELTA_FIELDS.map((field) => ({
      field,
      delta: after[field] - before[field],
    }));
    const changed = deltas.filter((item) => item.delta !== 0);

    if (changed.length === 0) continue;
    changedStores += 1;

    const ghostDelta = after.ghostHosts - before.ghostHosts;
    if (ghostDelta > 0) ghostIncreased += 1;

    const label = `[${storeId}] ${after.storeName}（${after.businessMode}）`;
    console.log(
      `  ${label} ${ghostDelta > 0 ? '❌' : '⚠️'} ` +
        changed.map((item) => `${item.field} ${item.delta > 0 ? '+' : ''}${item.delta}`).join('  '),
    );
  }

  console.log('');
  if (changedStores === 0) {
    console.log('✅ 与基线完全一致，未产生任何新增宿主。');
    return 0;
  }
  if (ghostIncreased > 0) {
    console.log(
      `❌ ${ghostIncreased} 家门店的幽灵宿主增加了——空规格短路可能失效，请检查 syncSpecifications。`,
    );
    console.log('   提示：餐饮门店的 isActive=false 也可能来自正常下架，需结合业态判断。');
    return 1;
  }
  console.log(
    `⚠️ ${changedStores} 家门店有变化，但幽灵宿主未增加（可能是正常配置规格 / 上下架）。`,
  );
  return 0;
}

// ─── 主流程 ──────────────────────────────────────────────────────────────
async function main() {
  const rows = await collectAll();

  if (savePath) {
    const snapshot = {
      capturedAt: new Date().toISOString(),
      stores: rows,
    };
    writeFileSync(savePath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
    console.log(`基线快照已写入 ${savePath}（${rows.length} 家门店）`);
  }

  printTable(rows);

  if (listGhosts) {
    await printGhostDetails();
  }

  if (diffPath) {
    const baseline = JSON.parse(readFileSync(diffPath, 'utf8'));
    if (!baseline?.stores) {
      throw new Error(`${diffPath} 不是有效的基线快照文件`);
    }
    console.log('');
    return printDiff(baseline, rows);
  }

  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error('检查失败：', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });

function loadEnvFile(filePath) {
  try {
    const envContent = readFileSync(filePath, 'utf8');
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      const eqIndex = trimmed.indexOf('=');
      if (eqIndex < 0) {
        continue;
      }

      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed
        .slice(eqIndex + 1)
        .trim()
        .replace(/^['"]|['"]$/g, '');
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {
    // 忽略缺失 .env 的场景，后续按必填项兜底报错
  }
}

/**
 * 幽灵宿主清理（商品多规格改造 · Stage 0 回滚预案）
 *
 * 幽灵宿主 = ScanOrderingMenuProduct 中 isActive=false 且挂着普通商品的记录。
 * 非餐饮门店放开规格配置后，若「空规格短路」失效，每次编辑商品都会静默多出一条。
 * 回滚代码不会删除这些数据，需要本脚本清理。
 *
 * 用法：
 *   node scripts/cleanup-ghost-menu-products.mjs
 *       预演（默认 dry-run）：只打印将被清理的宿主，不写库
 *   node scripts/cleanup-ghost-menu-products.mjs --apply
 *       实际清理：软删宿主（deletedAt）+ 物理删其规格组与选项
 *   node scripts/cleanup-ghost-menu-products.mjs --apply --hard
 *       物理删宿主（规格表无 deletedAt 字段，仍然只能物理删）
 *   node scripts/cleanup-ghost-menu-products.mjs --store 42
 *       只处理指定门店
 *   node scripts/cleanup-ghost-menu-products.mjs --include-catering
 *       连餐饮门店一起处理（默认跳过：餐饮的 isActive=false 多为正常下架）
 *   node scripts/cleanup-ghost-menu-products.mjs --with-specs
 *       连「带规格」的宿主一起清理（默认只清无规格的纯幽灵）
 *
 * 安全设计：
 * - 默认 dry-run，必须显式 --apply 才写库
 * - 默认跳过餐饮门店（下架的菜单商品是正常业务数据）
 * - 默认跳过带规格的宿主（那是有业务含义的配置）
 */

import { readFileSync } from 'node:fs';
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
  throw new Error('缺少 DATABASE_URL，无法清理幽灵宿主');
}

const pool = new Pool({ connectionString: databaseUrl });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// ─── 参数解析 ────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const hasFlag = (name) => argv.includes(`--${name}`);
const readFlag = (name) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : undefined;
};

const apply = hasFlag('apply');
const hard = hasFlag('hard');
const includeCatering = hasFlag('include-catering');
const withSpecs = hasFlag('with-specs');
const storeFilter = readFlag('store');

// ─── 主流程 ──────────────────────────────────────────────────────────────
async function main() {
  const storeWhere = storeFilter
    ? { id: Number.parseInt(storeFilter, 10) }
    : { id: { gt: 0 } };

  const stores = await prisma.store.findMany({
    where: storeWhere,
    select: { id: true, name: true, businessMode: true },
    orderBy: { id: 'asc' },
  });

  const targets = [];
  const skipped = [];

  for (const store of stores) {
    const hosts = await prisma.scanOrderingMenuProduct.findMany({
      where: {
        storeId: store.id,
        deletedAt: null,
        isActive: false,
        productId: { not: null },
      },
      select: {
        id: true,
        productId: true,
        name: true,
        createdAt: true,
        _count: { select: { specGroups: true } },
      },
      orderBy: { id: 'asc' },
    });

    for (const host of hosts) {
      const isCatering = (store.businessMode ?? 'general') === 'catering';
      const reason =
        (isCatering && !includeCatering)
          ? '餐饮门店跳过（可能来自正常下架；加 --include-catering 强制处理）'
          : (host._count.specGroups > 0 && !withSpecs)
            ? '带规格跳过（加 --with-specs 强制处理）'
            : null;

      if (reason) {
        skipped.push({ store, host, reason });
        continue;
      }
      targets.push({ store, host });
    }
  }

  if (targets.length === 0) {
    console.log('没有需要清理的幽灵宿主。');
    printSkipped(skipped);
    return;
  }

  console.log(`${apply ? '将清理' : '预演：将清理'} ${targets.length} 条幽灵宿主` +
    `${hard ? '（物理删除）' : '（软删宿主 + 物理删规格）'}：\n`);
  for (const { store, host } of targets) {
    console.log(
      `  #${host.id} store=${store.id}(${store.businessMode}) productId=${host.productId} ` +
        `规格组=${host._count.specGroups} 名称=${host.name} 创建于=${host.createdAt.toISOString()}`,
    );
  }

  printSkipped(skipped);

  if (!apply) {
    console.log('\n这是预演，未写库。确认无误后加 --apply 执行。');
    return;
  }

  let cleaned = 0;
  for (const { host } of targets) {
    await prisma.$transaction(async (tx) => {
      // 规格表没有 deletedAt 字段，只能物理删（先选项后组）
      await tx.scanOrderingSpecOption.deleteMany({
        where: { group: { menuProductId: host.id } },
      });
      await tx.scanOrderingSpecGroup.deleteMany({
        where: { menuProductId: host.id },
      });
      if (hard) {
        await tx.scanOrderingMenuProduct.delete({ where: { id: host.id } });
      } else {
        await tx.scanOrderingMenuProduct.update({
          where: { id: host.id },
          data: { deletedAt: new Date() },
        });
      }
    });
    cleaned += 1;
  }

  console.log(`\n已清理 ${cleaned} 条幽灵宿主。`);
  console.log('提示：清理后建议刷新扫码点餐菜单缓存（重启服务或等 TTL 过期）。');
}

function printSkipped(skipped) {
  if (skipped.length === 0) return;
  console.log(`\n跳过 ${skipped.length} 条：`);
  for (const { store, host, reason } of skipped) {
    console.log(`  #${host.id} store=${store.id} ${reason}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('清理失败：', error);
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

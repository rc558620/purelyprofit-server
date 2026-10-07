/**
 * 压测数据构造 — 订单批次（SaleOrder + SaleOrderItem）
 *
 * 用法：
 *   node scripts/seed-loadtest-orders.mjs              # 造档 B 默认 30 天数据
 *   node scripts/seed-loadtest-orders.mjs --days=7     # 造 7 天数据
 *   node scripts/seed-loadtest-orders.mjs --cleanup    # 清理本脚本造的数据
 *
 * 前置依赖：需先执行 seed-loadtest-stores.mjs（门店+商品）
 *
 * 环境变量：
 *   LOADTEST_ORDER_DAYS    覆盖天数（同 --days，默认 30）
 *   LOADTEST_ORDERS_PER_DAY  每店每天订单数（默认 400）
 *   LOADTEST_ITEMS_PER_ORDER 每单商品行数（默认 4）
 *
 * 安全设计：
 *   1. 禁止在 NODE_ENV=production 下执行
 *   2. 幂等标记：sale_orders.note = 'loadtest'
 *   3. --cleanup 只清理带标记的数据
 *   4. 默认 dry-run 模式，需加 --yes 确认执行
 *   5. 使用 raw SQL 逐单 INSERT + 批量 item INSERT，避免 Prisma overhead
 *
 * 数据量（档B 500 店 × 30 天 × 400 单/日 × 4 行/单 ≈ 600 万 sale_order_items）：
 *   - 6000000 SaleOrderItem
 *   - 1500000 SaleOrder（6000000/4）
 *
 * 时区假设：date 列按 Asia/Shanghai 业务日写入（UTC + 8h），
 * createdAt 用 UTC NOW()。DB 会话时区钉死 UTC（prisma.service.ts:100-109）。
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
  daysArg?.split('=')[1] ?? process.env.LOADTEST_ORDER_DAYS,
  30,
);
const ORDERS_PER_DAY = parsePositiveInt(
  process.env.LOADTEST_ORDERS_PER_DAY,
  400,
);
const ITEMS_PER_ORDER = parsePositiveInt(
  process.env.LOADTEST_ITEMS_PER_ORDER,
  4,
);

const STORE_PREFIX = '压测门店';
const LOADTEST_NOTE = 'loadtest';

const PAYMENT_METHODS = ['cash', 'wechat', 'alipay', 'card', 'other'];
const FALLBACK_PRODUCTS = [
  { name: '拿铁', category: '饮品', price: 1500, profit: 600 },
  { name: '美式', category: '饮品', price: 1200, profit: 500 },
  { name: '卡布奇诺', category: '饮品', price: 1800, profit: 700 },
  { name: '摩卡', category: '饮品', price: 2000, profit: 800 },
];

// ── 主流程 ────────────────────────────────────────────────────────
async function main() {
  if (CLEANUP) {
    await runCleanup();
    return;
  }

  console.log('\n📦 压测数据构造 — 订单批次\n');
  console.log(`  覆盖天数    ${DAYS}`);
  console.log(`  订单/店/日  ${ORDERS_PER_DAY}`);
  console.log(`  商品行/单   ${ITEMS_PER_ORDER}`);
  console.log(`  模式        ${CONFIRMED ? '⚠️ 执行写入' : '🔍 dry-run'}`);
  console.log('');

  // 查找压测门店
  const stores = await prisma.store.findMany({
    where: { name: { startsWith: STORE_PREFIX }, deletedAt: null },
    select: { id: true },
    orderBy: { id: 'asc' },
  });

  if (stores.length === 0) {
    throw new Error('未找到压测门店，请先执行 seed-loadtest-stores.mjs');
  }

  // 查找每店商品（取前 20 个）
  const storeProducts = new Map();
  for (const store of stores) {
    const products = await prisma.product.findMany({
      where: { storeId: store.id, deletedAt: null },
      select: { id: true, name: true, category: true, price: true, profit: true },
      take: 20,
    });
    storeProducts.set(store.id, products);
  }

  const totalOrders = stores.length * DAYS * ORDERS_PER_DAY;
  const totalItems = totalOrders * ITEMS_PER_ORDER;
  console.log(`  压测门店    ${stores.length}`);
  console.log(`  预计订单    ${totalOrders}`);
  console.log(`  预计明细    ${totalItems}`);
  console.log('');

  if (!CONFIRMED) {
    console.log('ℹ️  这是 dry-run。确认无误后追加 --yes 执行写入。\n');
    return;
  }

  const startedAt = Date.now();
  let createdOrders = 0;
  let createdItems = 0;
  const now = new Date();

  for (let dayOffset = 0; dayOffset < DAYS; dayOffset++) {
    const businessDate = new Date(now.getTime() - dayOffset * 24 * 60 * 60 * 1000);
    businessDate.setUTCHours(0, 0, 0, 0);

    for (const store of stores) {
      const products = storeProducts.get(store.id) ?? [];

      for (let orderIdx = 0; orderIdx < ORDERS_PER_DAY; orderIdx++) {
        const orderItems = [];
        let totalRevenue = 0;
        let totalProfit = 0;
        let totalQuantity = 0;

        for (let itemIdx = 0; itemIdx < ITEMS_PER_ORDER; itemIdx++) {
          const product = products[itemIdx % Math.max(products.length, 1)] ??
            FALLBACK_PRODUCTS[itemIdx % FALLBACK_PRODUCTS.length];
          const quantity = Math.floor(Math.random() * 3) + 1;
          const salePrice = product.price ?? 1500;
          const profit = product.profit ?? 600;
          orderItems.push({
            productName: product.name,
            categoryName: product.category ?? '饮品',
            salePrice,
            profit,
            quantity,
            productId: product.id ?? null,
          });
          totalRevenue += salePrice * quantity;
          totalProfit += profit * quantity;
          totalQuantity += quantity;
        }

        const createdAt = new Date(
          businessDate.getTime() + Math.random() * 20 * 60 * 60 * 1000 + 8 * 60 * 60 * 1000,
        );
        const paymentMethod = PAYMENT_METHODS[orderIdx % PAYMENT_METHODS.length];
        const orderNo = `LT${store.id}-${dayOffset}-${orderIdx}`;

        // 插入 SaleOrder 并取回 id
        const orderRows = await prisma.$queryRaw`
          INSERT INTO sale_orders (
            store_id, order_no, total_revenue, total_profit, total_quantity,
            payment_method, calc_mode, note, date, manual_entry, created_at, updated_at
          ) VALUES (
            ${store.id}, ${orderNo}, ${totalRevenue}, ${totalProfit}, ${totalQuantity},
            ${paymentMethod}::"SalesPaymentMethod", 'business'::"SalesCalcMode", ${LOADTEST_NOTE},
            ${businessDate}, false, ${createdAt}, ${createdAt}
          )
          RETURNING id
        `;
        const orderId = orderRows[0]?.id;
        if (!orderId) continue;
        createdOrders++;

        // 批量插入 SaleOrderItems
        if (orderItems.length > 0) {
          const itemPlaceholders = orderItems
            .map(
              (_, idx) =>
                `($${idx * 10 + 1}, $${idx * 10 + 2}, $${idx * 10 + 3}, $${idx * 10 + 4}, $${idx * 10 + 5}, $${idx * 10 + 6}, $${idx * 10 + 7}, $${idx * 10 + 8}, $${idx * 10 + 9}, $${idx * 10 + 10})`,
            )
            .join(', ');

          const flatParams = orderItems.flatMap((item) => [
            orderId,
            store.id,
            item.productId,
            item.productName,
            item.categoryName,
            item.salePrice,
            item.profit,
            item.quantity,
            null,
            createdAt,
          ]);

          const itemSql = `INSERT INTO sale_order_items (order_id, store_id, product_id, product_name, category_name, sale_price, profit, quantity, image, created_at) VALUES ${itemPlaceholders}`;

          await prisma.$executeRawUnsafe(itemSql, ...flatParams);
          createdItems += orderItems.length;
        }
      }
    }

    const elapsed = Date.now() - startedAt;
    console.log(`  进度: day ${dayOffset + 1}/${DAYS}, orders=${createdOrders}, items=${createdItems} (${elapsed}ms)`);
  }

  const elapsed = Date.now() - startedAt;
  console.log('\n========== 压测订单数据构造完成 ==========');
  console.log(`  订单        ${createdOrders}`);
  console.log(`  明细        ${createdItems}`);
  console.log(`  耗时        ${elapsed}ms`);
  console.log('===========================================\n');
}

async function runCleanup() {
  console.log('\n🧹 压测订单数据清理\n');
  console.log(`  模式  ${CONFIRMED ? '⚠️ 执行删除' : '🔍 dry-run'}`);

  const stores = await prisma.store.findMany({
    where: { name: { startsWith: STORE_PREFIX }, deletedAt: null },
    select: { id: true },
  });
  const storeIds = stores.map((s) => s.id);

  const orderCount = await prisma.saleOrder.count({
    where: { storeId: { in: storeIds }, note: LOADTEST_NOTE },
  });

  console.log(`  压测订单  ${orderCount}`);
  console.log('');

  if (orderCount === 0) {
    console.log('✅ 没有需要清理的压测订单数据\n');
    return;
  }

  if (!CONFIRMED) {
    console.log('ℹ️  这是 dry-run。确认无误后追加 --yes 执行删除。\n');
    return;
  }

  console.log('开始删除…\n');

  // sale_order_items 通过 FK CASCADE 自动删除，但显式删更安全
  await prisma.$executeRaw`
    DELETE FROM sale_order_items
    WHERE store_id = ANY(${storeIds}::int[])
      AND order_id IN (
        SELECT id FROM sale_orders
        WHERE store_id = ANY(${storeIds}::int[])
          AND note = ${LOADTEST_NOTE}
      )
  `;
  console.log('  sale_order_items  cleaned');

  const delOrders = await prisma.saleOrder.deleteMany({
    where: { storeId: { in: storeIds }, note: LOADTEST_NOTE },
  });
  console.log(`  sale_orders       ${delOrders.count}`);

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

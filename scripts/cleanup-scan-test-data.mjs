/**
 * 清理扫码点餐测试数据（配合 scripts/seed-scan-test-qr.mjs 使用）。
 *
 * 用法：
 *   node scripts/cleanup-scan-test-data.mjs                 # dry-run：只统计，不删除
 *   node scripts/cleanup-scan-test-data.mjs --yes           # 真正执行删除
 *   node scripts/cleanup-scan-test-data.mjs 37 --yes        # 指定门店
 *   node scripts/cleanup-scan-test-data.mjs 37 --table-code=TEST-01,TEST-02 --yes
 *   node scripts/cleanup-scan-test-data.mjs 37 --all-tables --yes        # 该门店全部桌台
 *   node scripts/cleanup-scan-test-data.mjs 37 --all-tables --purge-areas --yes
 *
 * 参数：
 *   <storeId>              目标门店 ID（也可用 SEED_STORE_ID 环境变量）
 *   --table-code=A,B       要清理的桌台编码，默认取 SEED_TABLE_CODE 或 TEST-01
 *   --all-tables           清理该门店所有桌台（与 --table-code 互斥，优先本项）
 *   --purge-areas          顺带删除清理后已无桌台的区域
 *   --purge-pickup        顺带清除该门店的取餐号每日计数（重置叫号从 001 开始）
 *   --yes                  确认执行；缺省为 dry-run
 *   --force                即使存在关联的财务销售单（SaleOrder）也继续
 *
 * 安全设计：
 *   1. 默认 dry-run，不带 --yes 绝不写库；
 *   2. 默认只清理「测试桌台编码」范围，不做整店清空，避免误伤真实数据；
 *   3. 若发现订单已生成财务销售单（SaleOrder），默认中止并提示（用 --force 跳过）。
 *
 * 删除顺序由外键依赖决定，不可调整：
 *   scan_orders 子表 → scan_orders → 购物车 → 服务呼叫 → 会话 → 桌码 → 桌台 →（可选）区域
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import Redis from 'ioredis';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnvFile(resolve(__dirname, '../.env'));

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  throw new Error('缺少 DATABASE_URL，无法清理测试数据');
}

const pool = new Pool({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

// ── 参数解析 ─────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const CONFIRMED = args.includes('--yes');
const FORCE = args.includes('--force');
const ALL_TABLES = args.includes('--all-tables');
const PURGE_AREAS = args.includes('--purge-areas');
const PURGE_PICKUP = args.includes('--purge-pickup');

const tableCodeArg = args.find((arg) => arg.startsWith('--table-code='));
const tableCodeList = (tableCodeArg?.split('=')[1] ?? process.env.SEED_TABLE_CODE ?? 'TEST-01')
  .split(',')
  .map((code) => code.trim())
  .filter(Boolean);

const storeIdArg = args.find((arg) => !arg.startsWith('--'));
const TARGET_STORE_ID = parsePositiveInt(storeIdArg, parsePositiveInt(process.env.SEED_STORE_ID, 0));

// ============================================================================
// 主流程
// ============================================================================
async function main() {
  console.log('\n🧹 扫码点餐测试数据清理\n');
  console.log(`  模式      ${CONFIRMED ? '⚠️  执行删除' : '🔍 dry-run（只统计，不删除）'}`);
  console.log(`  门店      ${TARGET_STORE_ID ? `#${TARGET_STORE_ID}` : '未指定（将自动挑选）'}`);
  console.log(
    `  范围      ${ALL_TABLES ? '该门店全部桌台' : `桌台编码 ${tableCodeList.join(', ')}`}`,
  );
  console.log('');

  const store = await resolveStore();
  const targets = await collectTargets(store.id);
  const saleOrderCount = await countLinkedSaleOrders(targets.orderIds);

  printSummary({ store, targets, saleOrderCount });

  if (targets.tableIds.length === 0) {
    console.log('✅ 没有需要清理的数据\n');
    return;
  }

  if (saleOrderCount > 0 && !FORCE) {
    console.log('⚠️  上述订单已生成财务销售单（sale_orders.scan_order_id 指向它们）。');
    console.log('   继续删除会把销售单的扫码来源置空（scan_order_id → NULL），');
    console.log('   销售金额与流水不会被删除，但会丢失「来自哪笔扫码点餐」的追溯。');
    console.log('   确认要清理请追加 --force。\n');
    process.exitCode = 1;
    return;
  }

  if (!CONFIRMED) {
    console.log('ℹ️  这是 dry-run。确认无误后追加 --yes 执行删除。\n');
    return;
  }

  await executeDeletion(store.id, targets);
  await invalidateCaches(store.id, targets.tableIds);
  await printVerification(store.id, targets.tableIds);
}

// ── 门店 ────────────────────────────────────────────────────────────
async function resolveStore() {
  if (TARGET_STORE_ID) {
    const store = await prisma.store.findFirst({
      where: { id: TARGET_STORE_ID },
      select: { id: true, name: true, businessMode: true },
    });
    if (!store) throw new Error(`未找到门店 #${TARGET_STORE_ID}`);
    return store;
  }

  const store = await prisma.store.findFirst({
    where: { deletedAt: null, businessMode: 'catering' },
    orderBy: { id: 'asc' },
    select: { id: true, name: true, businessMode: true },
  });
  if (!store) throw new Error('没有可用的餐饮门店，请显式传入 storeId');

  console.log(`ℹ️  未指定门店，自动选中 #${store.id}「${store.name}」\n`);
  return store;
}

// ── 收集待清理对象 ──────────────────────────────────────────────────
async function collectTargets(storeId) {
  const tables = await prisma.scanOrderingTable.findMany({
    where: ALL_TABLES ? { storeId } : { storeId, tableCode: { in: tableCodeList } },
    select: { id: true, tableCode: true, name: true, areaId: true },
    orderBy: { id: 'asc' },
  });
  const tableIds = tables.map((table) => table.id);

  if (tableIds.length === 0) {
    return { tables, tableIds, orderIds: [], sessionIds: [], cartItemIds: [] };
  }

  const orders = await prisma.scanOrders.findMany({
    where: { storeId, tableId: { in: tableIds } },
    select: { id: true },
  });
  const orderIds = orders.map((order) => order.id);

  const sessions = await prisma.scanOrderingSession.findMany({
    where: { storeId, tableId: { in: tableIds } },
    select: { id: true },
  });
  const sessionIds = sessions.map((session) => session.id);

  const cartItems = sessionIds.length
    ? await prisma.scanOrderingCartItem.findMany({
        where: { sessionId: { in: sessionIds } },
        select: { id: true },
      })
    : [];
  const cartItemIds = cartItems.map((item) => item.id);

  return { tables, tableIds, orderIds, sessionIds, cartItemIds };
}

/** 统计关联的财务销售单：这是「不该被误删」的业务数据，需单独告警 */
async function countLinkedSaleOrders(orderIds) {
  if (orderIds.length === 0) return 0;
  return prisma.saleOrder.count({ where: { scanOrderId: { in: orderIds } } });
}

// ── 摘要 ────────────────────────────────────────────────────────────
function printSummary({ store, targets, saleOrderCount }) {
  console.log('━'.repeat(64));
  console.log(`  门店  #${store.id} ${store.name}`);
  console.log('━'.repeat(64));

  if (targets.tables.length === 0) {
    console.log('  没有匹配到桌台');
    return;
  }

  console.log(`  桌台（${targets.tables.length}）`);
  for (const table of targets.tables) {
    console.log(`    #${table.id}  ${table.tableCode} / ${table.name}`);
  }
  console.log('');
  console.log(`  订单            ${targets.orderIds.length}`);
  console.log(`  关联财务销售单  ${saleOrderCount}${saleOrderCount > 0 ? '   ⚠️' : ''}`);
  console.log(`  点餐会话        ${targets.sessionIds.length}`);
  console.log(`  购物车条目      ${targets.cartItemIds.length}`);
  console.log('');
}

// ── 执行删除 ────────────────────────────────────────────────────────
async function executeDeletion(storeId, targets) {
  const { tableIds, orderIds, sessionIds, cartItemIds } = targets;

  console.log('开始删除…\n');

  // scan_orders 子表（顺序不可调整）
  console.log(`  scan_order_coupon_usages        ${(await prisma.scanOrderCouponUsage.deleteMany({ where: { orderId: { in: orderIds } } })).count}`);
  console.log(`  scan_order_items                ${(await prisma.scanOrderItem.deleteMany({ where: { orderId: { in: orderIds } } })).count}`);
  console.log(`  scan_order_payment_attempts     ${(await prisma.scanOrderPaymentAttempt.deleteMany({ where: { orderId: { in: orderIds } } })).count}`);
  console.log(`  scan_order_refund_tasks         ${(await prisma.scanOrderRefundTask.deleteMany({ where: { orderId: { in: orderIds } } })).count}`);
  console.log(`  scan_order_balance_transactions ${(await prisma.scanOrderBalanceTransaction.deleteMany({ where: { orderId: { in: orderIds } } })).count}`);
  console.log(`  scan_order_status_histories     ${(await prisma.scanOrderStatusHistory.deleteMany({ where: { orderId: { in: orderIds } } })).count}`);
  console.log(`  scan_orders                     ${(await prisma.scanOrders.deleteMany({ where: { id: { in: orderIds } } })).count}`);

  // 购物车 → 服务呼叫 → 会话
  console.log(`  scan_ordering_cart_item_specs   ${(await prisma.scanOrderingCartItemSpec.deleteMany({ where: { cartItemId: { in: cartItemIds } } })).count}`);
  console.log(`  scan_ordering_cart_items        ${(await prisma.scanOrderingCartItem.deleteMany({ where: { id: { in: cartItemIds } } })).count}`);
  console.log(`  scan_order_service_calls        ${(await prisma.scanOrderServiceCall.deleteMany({ where: { sessionId: { in: sessionIds } } })).count}`);
  console.log(`  scan_ordering_sessions          ${(await prisma.scanOrderingSession.deleteMany({ where: { id: { in: sessionIds } } })).count}`);

  // 桌码 → 桌台
  console.log(`  scan_ordering_table_qr_codes     ${(await prisma.scanOrderingTableQrCode.deleteMany({ where: { tableId: { in: tableIds } } })).count}`);
  console.log(`  scan_ordering_tables             ${(await prisma.scanOrderingTable.deleteMany({ where: { id: { in: tableIds } } })).count}`);

  if (PURGE_AREAS) {
    const removed = await purgeEmptyAreas(storeId);
    console.log(`  scan_ordering_areas（无桌台）    ${removed}`);
  }

  if (PURGE_PICKUP) {
    const removed = await prisma.scanOrderingPickupSequence.deleteMany({ where: { storeId } });
    console.log(`  scan_ordering_pickup_sequences   ${removed.count}`);
  }

  console.log('');
}

/** 只删除已经没有任何桌台的区域，避免误删仍在使用的区域 */
async function purgeEmptyAreas(storeId) {
  const areas = await prisma.scanOrderingArea.findMany({
    where: { storeId },
    select: { id: true, _count: { select: { tables: true } } },
  });
  const emptyAreaIds = areas
    .filter((area) => area._count.tables === 0)
    .map((area) => area.id);
  if (emptyAreaIds.length === 0) return 0;

  const result = await prisma.scanOrderingArea.deleteMany({
    where: { id: { in: emptyAreaIds } },
  });
  return result.count;
}

// ── 缓存 ────────────────────────────────────────────────────────────
async function invalidateCaches(storeId, tableIds) {
  const redisUrl = process.env.REDIS_URL?.trim();
  if (!redisUrl) return;

  let client;
  try {
    client = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
    await client.connect();

    const keys = [
      // 桌码列表缓存（ScanOrderingQrService.buildQrCodeCacheKey）
      ...tableIds.map((tableId) => `scan-ordering:qr-codes:${storeId}:${tableId}`),
      // 扫码菜单缓存（seed-scan-ordering-enable 中使用的 key）
      `scanordering:menu:${storeId}`,
    ];
    await client.del(...keys);
    console.log(`🧹 已失效 ${keys.length} 个 Redis 缓存键`);
  } catch {
    console.log('ℹ️  Redis 缓存未失效（连接失败），可等待 TTL 自然过期');
  } finally {
    client?.disconnect();
  }
}

// ── 校验 ────────────────────────────────────────────────────────────
async function printVerification(storeId, tableIds) {
  const remainingTables = await prisma.scanOrderingTable.count({
    where: { id: { in: tableIds } },
  });
  const remainingStoreTables = await prisma.scanOrderingTable.count({ where: { storeId } });
  const remainingOrders = await prisma.scanOrders.count({ where: { storeId } });
  const remainingSessions = await prisma.scanOrderingSession.count({ where: { storeId } });

  console.log('━'.repeat(64));
  console.log('  ✅ 清理完成');
  console.log('━'.repeat(64));
  console.log(`  目标桌台残留      ${remainingTables}${remainingTables === 0 ? '' : '   ❌ 未清干净'}`);
  console.log(`  该门店剩余桌台    ${remainingStoreTables}`);
  console.log(`  该门店剩余订单    ${remainingOrders}`);
  console.log(`  该门店剩余会话    ${remainingSessions}`);
  console.log('━'.repeat(64));
  console.log('');
}

// ── 工具 ────────────────────────────────────────────────────────────
function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** 与项目内其他 seed 脚本保持一致：手工解析 .env，不覆盖已存在的环境变量 */
function loadEnvFile(filePath) {
  try {
    const envContent = readFileSync(filePath, 'utf8');
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const eqIndex = trimmed.indexOf('=');
      if (eqIndex < 0) continue;

      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed
        .slice(eqIndex + 1)
        .trim()
        .replace(/^['"]|['"]$/g, '');
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // .env 不存在时依赖外部环境变量
  }
}

main()
  .catch((error) => {
    console.error(`\n❌ ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });

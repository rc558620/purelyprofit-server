/**
 * 一键造扫码点餐测试数据：确保「餐饮门店 + 区域 + 桌台 + 可用桌码」就绪，
 * 并打印可直接粘贴到开发者工具的测试参数。
 *
 * 用法：
 *   node scripts/seed-scan-test-qr.mjs            # 自动挑一个餐饮门店
 *   node scripts/seed-scan-test-qr.mjs 18         # 指定门店 ID
 *   node scripts/seed-scan-test-qr.mjs 18 --force-catering
 *
 * 环境变量：
 *   SEED_STORE_ID       目标门店 ID（命令行参数优先）
 *   SEED_TABLE_CODE     桌台编码，默认 TEST-01
 *   SEED_TABLE_NAME     桌台名称，默认「联调测试桌」
 *   SCAN_QR_BASE_URL    二维码内容前缀（默认取 CLUB_PUBLIC_BASE_URL）
 *                       两者都为空时二维码内容回退为裸 token
 *   SEED_QR_OUTPUT      可选：把二维码 PNG 写到该路径，便于用手机/小程序内扫码
 *
 * 为什么直接连库而不是调接口：
 *   商家端登录需要 RSA 加密密码 + 拼图 captchaToken，无法脚本化；
 *   因此本脚本复刻 ScanOrderingQrService 的落库逻辑（token 生成 + AES-256-GCM 加密），
 *   与线上接口写出的数据完全等价。
 *
 * 幂等：区域/桌台已存在则复用；每次执行会撤销该桌台现有 active 桌码并新建一个版本。
 */
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import QRCode from 'qrcode';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnvFile(resolve(__dirname, '../.env'));

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  throw new Error('缺少 DATABASE_URL，无法造测试数据');
}

const pool = new Pool({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

// ── 参数 ─────────────────────────────────────────────────────────────
const CLI_STORE_ID = parsePositiveInt(process.argv[2], 0);
const ENV_STORE_ID = parsePositiveInt(process.env.SEED_STORE_ID, 0);
const TARGET_STORE_ID = CLI_STORE_ID || ENV_STORE_ID;
const FORCE_CATERING = process.argv.includes('--force-catering');
const TABLE_CODE = process.env.SEED_TABLE_CODE?.trim() || 'TEST-01';
const TABLE_NAME = process.env.SEED_TABLE_NAME?.trim() || '联调测试桌';
const AREA_NAME = process.env.SEED_AREA_NAME?.trim() || '联调测试区';
const QR_OUTPUT_PATH = process.env.SEED_QR_OUTPUT?.trim() || '';

// ============================================================================
// 主流程
// ============================================================================
async function main() {
  console.log('\n🎯 扫码点餐测试数据准备\n');

  const store = await resolveStore();
  const area = await ensureArea(store.id);
  const table = await ensureTable(store.id, area.id);
  const qrToken = await createQrCode(store.id, table.id);

  await invalidateQrCache(store.id, table.id);

  await printResult({ store, area, table, qrToken });
}

// ── 门店 ────────────────────────────────────────────────────────────
async function resolveStore() {
  if (TARGET_STORE_ID) {
    const store = await prisma.store.findFirst({
      where: { id: TARGET_STORE_ID, deletedAt: null },
      select: { id: true, name: true, businessMode: true },
    });
    if (!store) {
      throw new Error(`未找到门店 #${TARGET_STORE_ID}`);
    }
    return ensureCatering(store);
  }

  const store = await prisma.store.findFirst({
    where: { deletedAt: null, businessMode: 'catering' },
    orderBy: { id: 'asc' },
    select: { id: true, name: true, businessMode: true },
  });
  if (!store) {
    throw new Error(
      '没有可用的餐饮门店。请指定门店并加 --force-catering，例如：\n' +
        '  node scripts/seed-scan-test-qr.mjs 18 --force-catering',
    );
  }
  return store;
}

async function ensureCatering(store) {
  if (store.businessMode === 'catering') return store;

  // resolveQrToken 会校验 businessMode === 'catering'，非餐饮门店扫码必失败
  if (!FORCE_CATERING) {
    throw new Error(
      `门店 #${store.id}「${store.name}」业态为 ${store.businessMode}，扫码点餐需要 catering。\n` +
        '  若确认要用它做联调，追加 --force-catering 参数（会改写业务数据）',
    );
  }

  const updated = await prisma.store.update({
    where: { id: store.id },
    data: { businessMode: 'catering', scan_ordering_enabled: true },
    select: { id: true, name: true, businessMode: true },
  });
  console.log(`⚠️  已将门店 #${store.id} 业态改写为 catering 并开启扫码点餐`);
  return updated;
}

// ── 区域 ────────────────────────────────────────────────────────────
async function ensureArea(storeId) {
  const existing = await prisma.scanOrderingArea.findFirst({
    where: { storeId, name: AREA_NAME },
    select: { id: true, name: true },
  });
  if (existing) return existing;

  const created = await prisma.scanOrderingArea.create({
    data: { storeId, name: AREA_NAME, sortOrder: 1 },
    select: { id: true, name: true },
  });
  console.log(`✅ 创建区域 #${created.id}「${created.name}」`);
  return created;
}

// ── 桌台 ────────────────────────────────────────────────────────────
async function ensureTable(storeId, areaId) {
  const existing = await prisma.scanOrderingTable.findFirst({
    where: { storeId, tableCode: TABLE_CODE, deletedAt: null },
    select: { id: true, tableCode: true, name: true, status: true },
  });
  if (existing) return existing;

  const created = await prisma.scanOrderingTable.create({
    data: {
      storeId,
      areaId,
      tableCode: TABLE_CODE,
      name: TABLE_NAME,
      capacity: 4,
      status: 'empty',
      isActive: true,
    },
    select: { id: true, tableCode: true, name: true, status: true },
  });
  console.log(`✅ 创建桌台 #${created.id}「${created.name}」`);
  return created;
}

// ── 桌码 ────────────────────────────────────────────────────────────
async function createQrCode(storeId, tableId) {
  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');

  await prisma.$transaction(async (tx) => {
    // 表上存在部分唯一索引 uq_scan_ordering_active_qr_per_table
    // （仅约束 status='active'），必须先撤销旧的有效码
    await tx.scanOrderingTableQrCode.updateMany({
      where: { tableId, status: 'active' },
      data: { status: 'revoked', revokedAt: new Date() },
    });

    const latest = await tx.scanOrderingTableQrCode.findFirst({
      where: { tableId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });

    await tx.scanOrderingTableQrCode.create({
      data: {
        storeId,
        tableId,
        tokenHash,
        tokenCiphertext: encryptToken(token),
        tokenPrefix: token.slice(0, 8),
        version: (latest?.version ?? 0) + 1,
        status: 'active',
      },
    });
  });

  return token;
}

/** 复刻 ScanOrderingQrService.encryptToken：AES-256-GCM，格式 iv.authTag.ciphertext（base64url） */
function encryptToken(token) {
  const key = resolveEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv, authTag, ciphertext].map((part) => part.toString('base64url')).join('.');
}

/** 复刻 ScanOrderingQrService.getEncryptionKey：优先专用密钥，否则从 JWT_SECRET 派生 */
function resolveEncryptionKey() {
  const encodedKey = process.env.SCAN_ORDERING_QR_TOKEN_ENCRYPTION_KEY?.trim();
  if (encodedKey) {
    const key = Buffer.from(encodedKey, 'base64');
    if (key.length !== 32) {
      throw new Error('SCAN_ORDERING_QR_TOKEN_ENCRYPTION_KEY 必须是 32 字节的 Base64 值');
    }
    return key;
  }

  const jwtSecret = process.env.JWT_SECRET?.trim();
  if (!jwtSecret) {
    throw new Error(
      '未配置 SCAN_ORDERING_QR_TOKEN_ENCRYPTION_KEY 与 JWT_SECRET，无法加密桌码',
    );
  }
  return createHash('sha256').update(`scan-ordering-qr-token:${jwtSecret}`).digest();
}

// ── 缓存 ────────────────────────────────────────────────────────────
async function invalidateQrCache(storeId, tableId) {
  const redisUrl = process.env.REDIS_URL?.trim();
  if (!redisUrl) return;

  let client;
  try {
    client = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
    await client.connect();
    // 与服务端 ScanOrderingQrService.buildQrCodeCacheKey 保持一致
    await client.del(`scan-ordering:qr-codes:${storeId}:${tableId}`);
  } catch {
    console.log('ℹ️  Redis 缓存未失效（连接失败），如展示异常可等待 60 秒 TTL 过期');
  } finally {
    client?.disconnect();
  }
}

// ── 输出 ────────────────────────────────────────────────────────────
async function printResult({ store, area, table, qrToken }) {
  const baseUrl = (
    process.env.SCAN_QR_BASE_URL?.trim() ||
    process.env.CLUB_PUBLIC_BASE_URL?.trim() ||
    ''
  ).replace(/\/+$/, '');

  // 有公共域名时用路径式 URL（与二维码内容迁移方向一致），否则回退裸 token
  const payload = baseUrl ? `${baseUrl}/t/${qrToken}` : qrToken;
  const encoded = encodeURIComponent(payload);
  const menuPage = 'pages/orderPkg/menu/index';

  console.log('');
  console.log('━'.repeat(64));
  console.log('  ✅ 测试数据就绪');
  console.log('━'.repeat(64));
  console.log(`  门店    #${store.id} ${store.name}（${store.businessMode}）`);
  console.log(`  区域    #${area.id} ${area.name}`);
  console.log(`  桌台    #${table.id} ${table.tableCode} / ${table.name}`);
  console.log('');
  console.log(`  qrToken ${qrToken}`);
  console.log(`  扫码内容 ${payload}${baseUrl ? '' : '  （未配置 SCAN_QR_BASE_URL / CLUB_PUBLIC_BASE_URL，回退裸 token）'}`);
  console.log('');

  console.log('━━ 方式 A：开发者工具「编译模式」 ━━');
  console.log(`  启动页面  pages/scanEntry/index`);
  console.log(`  启动参数  q=${encoded}`);
  console.log(`  场景值    1047`);
  console.log('');

  console.log('━━ 方式 B：页面参数（控制台直接执行，最省事） ━━');
  console.log(`  wx.navigateTo({ url: '/pages/scanEntry/index?payload=${encoded}' })`);
  console.log('');

  console.log('━━ 方式 C：小程序内「扫码点餐」入口 ━━');
  if (QR_OUTPUT_PATH) {
    await writeQrImage(payload, QR_OUTPUT_PATH);
    console.log(`  二维码已写入 ${QR_OUTPUT_PATH}`);
    console.log('  用小程序内「扫码点餐」扫它，或直接用微信识别');
  } else {
    console.log('  设置 SEED_QR_OUTPUT=./scan-test-qr.png 可同时导出二维码图片');
  }
  console.log('');

  console.log('━━ 校验接口是否认得这个 token ━━');
  console.log(
    `  curl -s -X POST http://localhost:3000/api/club/scan-ordering/scan/resolve \\\n` +
      `    -H 'Content-Type: application/json' -d '{"qrToken":"${qrToken}"}' | jq`,
  );
  console.log('  （该接口免鉴权；注意 scanToken 是一次性的，只能成功解析一次）');
  console.log('');
  console.log(`  提示：桌码页面路径为 ${menuPage}，解析成功后由扫码中转页跳转`);
  console.log('━'.repeat(64));
  console.log('');
}

async function writeQrImage(payload, outputPath) {
  const png = await QRCode.toBuffer(payload, {
    width: 480,
    margin: 2,
    type: 'png',
  });
  writeFileSync(resolve(process.cwd(), outputPath), png);
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

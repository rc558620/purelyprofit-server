/**
 * 服务商（Partner）模式上线前的联调自检脚本。
 *
 * ── 用法 ──────────────────────────────────────────────────────────────────
 *
 *   # 1) 只做本地自检（环境变量 + 数据库）
 *   pnpm wechat:partner:live-check
 *
 *   # 2) 连带调用后端绑定校验接口（需要商家端 JWT）
 *   pnpm wechat:partner:live-check --api-base=https://api.你的域名.com --token=xxx
 *
 *   # 3) 只看某个门店
 *   pnpm wechat:partner:live-check --store-id=123
 *
 * ── 它做什么 / 不做什么 ────────────────────────────────────────────────────
 *
 *   做：环境变量完整性、数据库迁移与数据就绪度、调用绑定校验接口、打印后续人工步骤。
 *   不做：真实下单 / 回调 / 退款 —— 那一步必须由人在小程序里真实付款 1 分钱完成，
 *         脚本无法代劳（需要用户 openid 与真实支付动作）。
 *
 * ── 说明 ──────────────────────────────────────────────────────────────────
 * ⚠️ 本脚本直读 process.env，会命中 check-f0rest-rules 的 Rule 6。这是**有意为之**
 *    并与既有基线一致：ops 脚本不进入 Nest 容器，拿不到 ConfigService，
 *    scripts/backfill-store-business-mode.mjs 等既有脚本同样是 exit=1。
 *    请勿为了「过规则」把它改成读配置文件。
 *
 * ── 安全保证 ──────────────────────────────────────────────────────────────
 *   - 只打印配置项「是否已配置 / 长度」，**绝不打印**密钥、证书、私钥内容
 *   - 数据库部分只读，不写任何表
 *   - normalize 后对比商户号，不输出完整值
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const REQUIRED_ENV_KEYS = [
  'WECHAT_PARTNER_ENABLED',
  'WECHAT_PARTNER_SP_MCH_ID',
  'WECHAT_PARTNER_API_V3_KEY',
  'WECHAT_PARTNER_MCH_SERIAL_NO',
  'WECHAT_PARTNER_SP_APP_ID',
  'WECHAT_PARTNER_PAY_NOTIFY_URL',
  'WECHAT_PARTNER_PLATFORM_PUBLIC_KEY_CONTENT',
];

const EXPECTED_COLUMNS = [
  [
    'store_wechat_pay_configs',
    ['sub_mch_id', 'bind_status', 'bind_checked_at', 'bind_fail_reason'],
  ],
  ['club_recharge_orders', ['sp_mch_id', 'sub_mch_id']],
  ['club_voucher_orders', ['sp_mch_id', 'sub_mch_id']],
  ['scan_order_payment_attempts', ['sp_mch_id', 'sub_mch_id']],
  ['self_order_payment_attempts', ['sp_mch_id', 'sub_mch_id']],
];

const parseArg = (name) => {
  const prefix = `--${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : '';
};

const loadEnvFile = () => {
  const envPath = resolve(__dirname, '..', '.env');
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const matched = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (matched && process.env[matched[1]] === undefined) {
      process.env[matched[1]] = matched[2].replace(/^["']|["']$/g, '');
    }
  }
};

const mask = (value) => {
  if (!value) return '(空)';
  return `已配置（长度 ${value.length}）`;
};

const printSection = (title) => {
  console.log('');
  console.log('══════════════════════════════════════════════════════');
  console.log(`  ${title}`);
  console.log('══════════════════════════════════════════════════════');
};

/** 第一步：环境变量完整性 */
const checkEnv = () => {
  printSection('① 环境变量自检');

  let missing = 0;
  for (const key of REQUIRED_ENV_KEYS) {
    const value = (process.env[key] ?? '').trim();
    if (!value) {
      console.log(`  ❌ ${key} 未配置`);
      missing += 1;
    } else {
      console.log(`  ✅ ${key} ${mask(value)}`);
    }
  }

  const keyPath = (process.env.WECHAT_PARTNER_PRIVATE_KEY_PATH ?? '').trim();
  const keyContent = (
    process.env.WECHAT_PARTNER_PRIVATE_KEY_CONTENT ?? ''
  ).trim();
  if (keyPath) {
    console.log(
      `  ${existsSync(keyPath) ? '✅' : '❌'} 服务商私钥文件 ${existsSync(keyPath) ? '存在' : '不存在'}：${keyPath}`,
    );
    if (!existsSync(keyPath)) missing += 1;
  } else if (keyContent) {
    console.log(`  ✅ 服务商私钥内联内容 ${mask(keyContent)}`);
  } else {
    console.log('  ❌ WECHAT_PARTNER_PRIVATE_KEY_PATH / _CONTENT 至少要配一个');
    missing += 1;
  }

  const notifyUrl = (process.env.WECHAT_PARTNER_PAY_NOTIFY_URL ?? '').trim();
  if (notifyUrl && !notifyUrl.endsWith('/api/club/payments/wechat/callback')) {
    console.log('  ❌ 回调地址必须以 /api/club/payments/wechat/callback 结尾');
    missing += 1;
  }

  const spMchId = (process.env.WECHAT_PARTNER_SP_MCH_ID ?? '').trim();
  const payMchId = (process.env.WECHAT_PAY_MCH_ID ?? '').trim();
  if (spMchId && payMchId) {
    const same = spMchId === payMchId;
    console.log(
      `  ${same ? 'ℹ️' : '⚠️'} sp_mchid 与平台收款商户号${same ? '相同（已确认场景）' : '不同'}`,
    );
    if (same) {
      const allowed =
        (
          process.env.WECHAT_PARTNER_ALLOW_SHARED_PLATFORM_MCH_ID ?? ''
        ).trim() === 'true';
      const reason = (
        process.env.WECHAT_PARTNER_SHARED_MCH_ID_REASON ?? ''
      ).trim();
      console.log(
        `  ${allowed ? '✅' : '❌'} 同号豁免开关=${allowed || 'false'}`,
      );
      console.log(
        `  ${reason ? '✅' : '❌'} 豁免原因留档=${reason ? '已填写' : '未填写'}`,
      );
      if (!allowed || !reason) missing += 1;
    }
  }

  return missing;
};

/** 第二步：数据库迁移与数据就绪度 */
const checkDatabase = async () => {
  printSection('② 数据库自检');

  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

  try {
    for (const [table, columns] of EXPECTED_COLUMNS) {
      const result = await pool.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = $1 AND column_name = ANY($2::text[])`,
        [table, columns],
      );
      const found = result.rows.map((row) => row.column_name);
      const lacking = columns.filter((column) => !found.includes(column));
      console.log(
        `  ${lacking.length === 0 ? '✅' : '❌'} ${table}：${found.length}/${columns.length} 列${lacking.length ? `，缺 ${lacking.join('/')}` : ''}`,
      );
    }

    const storeFilter = parseArg('store-id');
    const configRows = await pool.query(
      `SELECT store_id, bind_status,
              (sub_mch_id IS NOT NULL AND sub_mch_id <> '') AS has_sub_mch,
              (mch_id IS NOT NULL AND mch_id <> '') AS has_mch
       FROM store_wechat_pay_configs
       ${storeFilter ? 'WHERE store_id = $1' : ''}
       ORDER BY store_id`,
      storeFilter ? [Number(storeFilter)] : [],
    );

    console.log(`  门店收款配置：共 ${configRows.rows.length} 条`);
    const missingSub = configRows.rows.filter((row) => !row.has_sub_mch);
    const notVerified = configRows.rows.filter(
      (row) => row.bind_status !== 'verified',
    );
    console.log(
      `  ${missingSub.length === 0 ? '✅' : '⚠️'} 未填子商户号：${missingSub.length} 家${missingSub.length ? `（store_id=${missingSub.map((r) => r.store_id).join(',')}）` : ''}`,
    );
    console.log(
      `  ${notVerified.length === 0 ? '✅' : '⚠️'} 未通过绑定校验：${notVerified.length} 家${notVerified.length ? `（store_id=${notVerified.map((r) => r.store_id).join(',')}）` : ''}`,
    );

    return configRows.rows.length > 0 && missingSub.length === 0;
  } finally {
    await pool.end();
  }
};

/** 第三步（可选）：调用后端绑定校验接口 */
const callVerifyApi = async () => {
  const apiBase = parseArg('api-base');
  const token = parseArg('token');
  if (!apiBase || !token) {
    return;
  }

  printSection('③ 绑定校验接口');
  try {
    const response = await fetch(
      `${apiBase.replace(/\/$/, '')}/api/stores/current/wechat-pay-config/verify`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      },
    );
    const body = await response.json();
    console.log(`  HTTP ${response.status}`);
    console.log(
      `  bindStatus=${body?.bindStatus ?? '(无)'} configured=${body?.configured ?? '(无)'}`,
    );
    if (body?.bindFailReason) {
      console.log(`  失败原因：${body.bindFailReason}`);
    }
  } catch (error) {
    console.log(
      `  ❌ 调用失败：${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

/** 最后：打印必须由人完成的真实支付步骤 */
const printManualSteps = () => {
  printSection('④ 必须由人完成的真实支付验证（脚本代劳不了）');
  console.log(
    '  1. purelyProfit 商家端 → 门店设置 → 微信收款配置：填子商户号 + 名称 → 保存',
  );
  console.log('  2. 点「重新校验」，直到状态变为「已生效」（verified）');
  console.log('  3. purelyClub 小程序：对该门店发起 1 分钱充值/下单并真实支付');
  console.log(
    '  4. 后端核对（SQL 见下）：订单是否落库 sp_mch_id/sub_mch_id，且与回调一致',
  );
  console.log('  5. 发起 1 分钱退款，确认退款成功且微信侧状态正确');
  console.log('  6. 观察 club_payment_callback_failures 死信表应为空');
  console.log('');
  console.log('  -- 核对 SQL（把 RC 前缀订单号换成你的真实单号）');
  console.log(
    '  SELECT order_no, status, sp_mch_id, sub_mch_id, transaction_id, amount_fen',
  );
  console.log(
    "  FROM club_recharge_orders WHERE order_no LIKE 'RC%' ORDER BY created_at DESC LIMIT 10;",
  );
  console.log('');
  console.log(
    '  SELECT order_no, bind_status, sub_mch_id FROM store_wechat_pay_configs;',
  );
};

const main = async () => {
  loadEnvFile();

  if (!process.env.DATABASE_URL) {
    console.error('❌ 无法找到 DATABASE_URL，无法做数据库自检');
  }

  const missing = checkEnv();
  if (process.env.DATABASE_URL) {
    await checkDatabase();
  }
  await callVerifyApi();
  printManualSteps();

  console.log('');
  const enabled = (process.env.WECHAT_PARTNER_ENABLED ?? '').trim() === 'true';

  if (missing === 0) {
    console.log('✅ 环境自检通过（真实支付步骤仍需人工完成）');
    return;
  }

  if (enabled) {
    // 开关已开而配置不全：启动自检会直接拒绝启动，这里必须以非零退出拦住
    console.log(
      `❌ 服务商模式已开启但有 ${missing} 项配置缺失，服务启动自检会拒绝启动`,
    );
    process.exitCode = 1;
    return;
  }

  // 开关未开：缺失只是「还没到上线这一步」，不算失败
  console.log(
    `⚠️ 有 ${missing} 项服务商配置缺失；当前 WECHAT_PARTNER_ENABLED 未开启，不影响运行。`,
  );
  console.log('   准备开启服务商模式前，必须先把这些项配齐。');
};

await main();

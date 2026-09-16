/**
 * 会员到期场景复现工具
 *
 * 背景：会员到期限制（C 端停新单 / 追加点单禁用 / 手动录单日限 5 单 /
 * 空间同时开台数 ≤ 1）依赖「当前时间 > expires_at」这一条件，靠等真实时间
 * 流逝几乎无法测试。本脚本直接把门店会员档案改成目标状态，实现秒级复现。
 *
 * 用法：
 *   node scripts/simulate-membership-expiry.mjs --status
 *       查看全部门店会员状态，并打印脚本推断的「是否已过期降级」
 *   node scripts/simulate-membership-expiry.mjs --status --store 42
 *       只看指定门店
 *
 *   node scripts/simulate-membership-expiry.mjs --expire --store 42
 *       改为「已过期」（模拟到期不续费）—— 验证各类限制生效
 *   node scripts/simulate-membership-expiry.mjs --expire --store 42 --days-ago 3
 *       改为「3 天前就过期」—— 便于验证「在途放行 vs 新单拦截」的区分
 *
 *   node scripts/simulate-membership-expiry.mjs --expiring --store 42 --days 8
 *       改为「8 天后到期」—— 验证首页续费横幅（窗口为 10 天）
 *
 *   node scripts/simulate-membership-expiry.mjs --restore --store 42
 *       恢复为有效会员（+365 天）—— 验证续费后限制立即解除
 *
 *   node scripts/simulate-membership-expiry.mjs --reset --store 42
 *       重置为「从未开通」（清空套餐）—— 关键回归：免费商家不应被限制
 *
 * 注意事项：
 *   1. 脚本只改数据库。后端若有会员缓存、前端有 useMember 缓存，需刷新页面；
 *      手动录单计数存在 Redis，反复测试前建议用 --clear-quota-hint 查看清理命令。
 *   2. 「在途放行」判定用 session.createdAt 与 expiresAt 比较：
 *      - 到期前创建的会话/购物车       → 放行（顾客能完成已经开始的订单）
 *      - 到期后新建的会话/购物车       → 拦截
 *      因此验证「新单被拦」时，请在 C 端**重新扫码建立新会话**，而不是复用旧会话。
 *   3. --days-ago 建议给 1 以上：若到期时间与当前时间太接近，容易在
 *      「恰好等于」边界上抖动，导致结论不稳定。
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
  throw new Error('缺少 DATABASE_URL，无法执行会员状态模拟');
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

const storeArg = readFlag('store');
const phoneArg = readFlag('phone');
const days = Number(readFlag('days') ?? 365);
const daysAgo = Number(readFlag('days-ago') ?? 1);
const planArg = readFlag('plan');

/** 门店 ID：--store 直接给；--phone 需要查库解析，在 main 中异步补齐 */
let storeId = storeArg !== undefined ? Number(storeArg) : undefined;

const VALID_PLANS = ['monthly', 'quarterly', 'yearly', 'lifetime'];

const actions = [
  hasFlag('status') && 'status',
  hasFlag('expire') && 'expire',
  hasFlag('expiring') && 'expiring',
  hasFlag('restore') && 'restore',
  hasFlag('reset') && 'reset',
].filter(Boolean);

if (actions.length === 0) {
  printUsage();
  process.exit(1);
}

if (actions.length > 1) {
  throw new Error(`一次只能执行一个动作，收到：${actions.join(', ')}`);
}

if (storeArg !== undefined && phoneArg !== undefined) {
  throw new Error('--store 与 --phone 只能指定一个');
}

if (storeArg !== undefined && !Number.isInteger(storeId)) {
  throw new Error(`--store 必须是数字门店 ID，收到：${storeArg}`);
}

if (planArg !== undefined && !VALID_PLANS.includes(planArg)) {
  throw new Error(`--plan 只能是 ${VALID_PLANS.join(' / ')}，收到：${planArg}`);
}

if (
  actions[0] !== 'status'
  && !Number.isInteger(storeId)
  && phoneArg === undefined
) {
  throw new Error(`--${actions[0]} 必须指定 --store <门店ID> 或 --phone <老板手机号>`);
}

if (!Number.isFinite(days) || days <= 0) {
  throw new Error('--days 必须是大于 0 的数字');
}

if (!Number.isFinite(daysAgo) || daysAgo < 0) {
  throw new Error('--days-ago 必须是不小于 0 的数字');
}

// ─── 核心逻辑 ────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

/** 手机号账号在 users.email 里的编码域名，与 seed-owner.mjs 保持一致 */
const LOCAL_LOGIN_DOMAIN = 'purelyprofit.local';

/**
 * 把老板手机号解析成门店 ID：
 * 先试 users.email 的两种历史编码，再退回在册子账号手机号。
 */
const resolveStoreIdByPhone = async (phone) => {
  const trimmed = String(phone).trim();
  const ownerEmails = [
    `phone_${trimmed}@${LOCAL_LOGIN_DOMAIN}`,
    `profit_phone_${trimmed}@${LOCAL_LOGIN_DOMAIN}`,
  ];

  const owner = await prisma.user.findFirst({
    where: { email: { in: ownerEmails } },
    select: {
      id: true,
      email: true,
      store: { select: { id: true, name: true, deletedAt: true } },
    },
    orderBy: { id: 'asc' },
  });

  if (owner?.store && owner.store.deletedAt === null) {
    console.log(
      `📱 手机号 ${trimmed} → 门店 ${owner.store.id}「${owner.store.name}」`
        + `（老板账号 ${owner.email}）`,
    );
    return owner.store.id;
  }

  const staff = await prisma.staff.findFirst({
    where: { phone: trimmed, isActive: true, status: 'active' },
    select: {
      storeId: true,
      store: { select: { name: true, deletedAt: true } },
    },
    orderBy: { id: 'asc' },
  });

  if (staff?.store && staff.store.deletedAt === null) {
    console.log(
      `📱 手机号 ${trimmed} → 门店 ${staff.storeId}「${staff.store.name}」（子账号）`,
    );
    return staff.storeId;
  }

  throw new Error(
    `手机号 ${trimmed} 未匹配到门店：老板账号已尝试 ${ownerEmails.join(' / ')}，`
      + '也未命中在册子账号手机号。',
  );
};

/**
 * 复刻后端 MembershipDowngradeService.isExpired 的判定：
 * 曾经开通过（current_plan_id 非空）且当前已过期。
 *
 * ⚠️ 脚本必须与后端保持一致，否则会出现「脚本说已过期、接口却放行」的困惑。
 */
const resolveDowngradeState = (profile, now) => {
  const planId = profile?.current_plan_id ?? null;
  const expiresAt = profile?.expires_at ?? null;
  const startsAt = profile?.starts_at ?? null;

  // 历史永久会员：yearly + 无到期时间（需有 startsAt 防脏数据）
  const isLifetime =
    (planId === 'yearly' && expiresAt === null && startsAt !== null) ||
    (planId === 'lifetime' && expiresAt === null);

  if (isLifetime) {
    return { isExpired: false, level: 'lifetime', remainingDays: 0 };
  }

  const isActive = expiresAt !== null && expiresAt.getTime() > now;

  if (isActive) {
    return {
      isExpired: false,
      level: planId,
      remainingDays: Math.ceil((expiresAt.getTime() - now) / DAY_MS),
    };
  }

  // 从未开通：不是过期，免费账号不受到期限制
  if (planId === null) {
    return { isExpired: false, level: 'free', remainingDays: 0 };
  }

  return { isExpired: true, level: 'free', remainingDays: 0 };
};

const formatDate = (value) => (value ? value.toISOString().replace('T', ' ').slice(0, 19) : '—');

const printStatus = async () => {
  const now = Date.now();

  const profiles = await prisma.storeMembershipProfile.findMany({
    where: Number.isInteger(storeId) ? { storeId } : {},
    select: {
      storeId: true,
      currentPlanId: true,
      startsAt: true,
      expiresAt: true,
    },
    orderBy: { storeId: 'asc' },
  });

  if (profiles.length === 0) {
    console.log('未找到会员档案。若门店确实未开通过会员，这属于正常情况（无档案 = 免费账号）。');
    return;
  }

  const rows = profiles.map((profile) => {
    const raw = {
      current_plan_id: profile.currentPlanId,
      starts_at: profile.startsAt,
      expires_at: profile.expiresAt,
    };
    const state = resolveDowngradeState(raw, now);

    return {
      门店: profile.storeId,
      套餐: profile.currentPlanId ?? '—',
      到期时间: formatDate(profile.expiresAt),
      剩余天数: state.remainingDays,
      档位: state.level,
      已过期降级: state.isExpired ? '是 ← 限制已生效' : '否',
    };
  });

  console.table(rows);

  const expiredCount = rows.filter((row) => row.已过期降级.startsWith('是')).length;
  console.log(
    `\n共 ${rows.length} 个门店，其中 ${expiredCount} 个处于「到期降级」态` +
      '（C 端停新单 / 追加点单禁用 / 手动录单日限 5 单 / 空间同时开台 ≤ 1）。',
  );
  console.log('「从未开通」的门店显示 套餐=— 且 已过期降级=否，不受任何到期限制。\n');
};

/** 直接写 SQL；时间点在 Node 侧算好再传入，避免库端 interval 拼接的类型推断问题 */
const applyAction = async (action) => {
  const now = Date.now();

  /** 目标到期时间 */
  let expiresAt = null;
  let startsAt = null;
  /** 套餐标识；null 表示重置为「从未开通」 */
  let planId = null;
  let description;

  switch (action) {
    case 'expire':
      planId = planArg ?? 'monthly';
      startsAt = new Date(now - 90 * DAY_MS);
      expiresAt = new Date(now - daysAgo * DAY_MS);
      description =
        `已设为「${planId} / ${daysAgo} 天前过期」\n` +
        '  → C 端应停新单、追加点单应被拒、手动录单每日限 5 单、空间同时只能开 1 台\n' +
        '  → 首页应展示「会员已到期」横幅 + 弹窗';
      break;

    case 'expiring':
      planId = planArg ?? 'monthly';
      startsAt = new Date(now - 30 * DAY_MS);
      expiresAt = new Date(now + days * DAY_MS);
      description =
        `已设为「${planId} / ${days} 天后到期」\n` +
        '  → 首页应展示续费弹窗（提醒窗口为 10 天）';
      break;

    case 'restore':
      planId = planArg ?? 'yearly';
      startsAt = new Date(now);
      expiresAt = new Date(now + days * DAY_MS);
      description =
        `已恢复为有效会员（${planId} / ${days} 天）\n` +
        '  → 所有到期限制应立即解除（无需重启服务）';
      break;

    case 'reset':
      planId = null;
      startsAt = null;
      expiresAt = null;
      description =
        '已重置为「从未开通」\n' +
        '  → 关键回归：免费账号不应受任何到期限制（C 端可下单、追加点单可用）';
      break;

    default:
      throw new Error(`未知动作：${action}`);
  }

  // lifetime（AGES）是 730 天周期卡：开始时间按同一周期回推，
  // 避免出现「还剩 8 天到期、却显示刚开通 30 天」这种自相矛盾的数据
  if (planId === 'lifetime' && expiresAt instanceof Date) {
    startsAt = new Date(expiresAt.getTime() - 730 * DAY_MS);
  }

  const affected = await prisma.$executeRawUnsafe(
    `UPDATE store_membership_profiles
     SET current_plan_id = $1,
         starts_at = $2,
         expires_at = $3,
         updated_at = NOW()
     WHERE store_id = $4`,
    planId,
    startsAt,
    expiresAt,
    storeId,
  );

  if (affected === 0) {
    console.warn(
      `\n⚠️  门店 ${storeId} 没有会员档案，未做任何修改。\n` +
        '   若该门店从未开通会员，需先有档案才能模拟「到期」（否则属于「从未开通」，本就不受限）。\n',
    );
    return;
  }

  console.log(`\n✅ 门店 ${storeId}：${description}\n`);
  await printStatus();

  console.log('────────────────────────────────────────────────────────');
  console.log('清除该门店的会员降级态缓存（改库不会自动失效，需手动清）：');
  console.log('  redis-cli --scan --pattern "profit:platform-membership:downgrade-state:store:'
    + `${storeId}" | xargs -r redis-cli del`);
  console.log('（走 App 内续费下单会自动失效；直接改库则需手动清，否则最多延迟 60 秒生效）');
  console.log('────────────────────────────────────────────────────────');
  console.log('接下来请手动验证（前端有缓存，务必刷新）：');
  console.log('  1. 刷新 purelyProfit（B 端）：首页横幅 / 追加点单 / 空间开台');
  console.log('  2. 重新扫码进入 purelyClub（C 端）：');
  console.log('     · 复用旧会话 → 应放行（在途订单）');
  console.log('     · 新建会话后加购 → 应弹「暂时无法下单」引导弹窗');
  console.log('');
  console.log('清空手动录单计数（Redis，便于反复测试），执行：');
  console.log(`  redis-cli --scan --pattern "membership:manual-entry-quota:${storeId}:*" | xargs -r redis-cli del`);
  console.log('（或用 --status 查看当前计数所在自然日；key 按上海时区自然日分片）');
  console.log('────────────────────────────────────────────────────────\n');
};

// ─── 入口 ────────────────────────────────────────────────────────────────

function printUsage() {
  console.log(`
会员到期场景复现工具

  node scripts/simulate-membership-expiry.mjs --status [--store 42 | --phone 13619654022]
  node scripts/simulate-membership-expiry.mjs --expire --store 42 [--days-ago 1]
  node scripts/simulate-membership-expiry.mjs --expiring --store 42 [--days 8]
  node scripts/simulate-membership-expiry.mjs --restore --store 42 [--days 365]
  node scripts/simulate-membership-expiry.mjs --reset --store 42

定位门店（二选一）：
  --store <门店ID>        直接指定
  --phone <老板手机号>    按 users.email 的 phone_/profit_phone_ 编码反查，兜底在册子账号手机号

指定档位（默认：expire/expiring 用 monthly，restore 用 yearly）：
  --plan <monthly|quarterly|yearly|lifetime>
  验证 AGES 快到期/到期（AGES 的真实档位是 lifetime）：
    node scripts/simulate-membership-expiry.mjs --expiring --phone 13619654022 --plan lifetime --days 8
    node scripts/simulate-membership-expiry.mjs --expire   --phone 13619654022 --plan lifetime --days-ago 1
`);
}

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
    // 没有 .env 时交由 DATABASE_URL 缺失检查报错
  }
}

async function main() {
  const action = actions[0];

  if (phoneArg !== undefined && !Number.isInteger(storeId)) {
    storeId = await resolveStoreIdByPhone(phoneArg);
  }

  if (action === 'status') {
    await printStatus();
    return;
  }

  await applyAction(action);
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

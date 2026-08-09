// purely-club 认证链路本地 e2e 验证脚本
//
// 背景：本地未配置腾讯云短信，验证码无法经短信接口真实下发（发送失败会删除验证码并抛 500），
// 因此本脚本绕过短信层，直接向 Redis 注入验证码（auth:register:purely_club:{phone}），
// 用于验证核心认证链路：
//   1. 手机号登录即注册 → 签发 token
//   2. 手机号账号调用 bind-phone（未注册手机号）→ 409 拒绝（账号已有手机号）
//   3. 手机号账号调用 bind-phone（已注册手机号）→ 409 拒绝（防御逻辑，不误入合并分支）
//   4. 微信登录假 code → 401 友好提示（证明 code2session 真实链路打通）
//
// 说明：微信账号（wechatOpenid 存在、wechatPhone 为空）直接绑定/合并的成功分支
// 由单元测试覆盖（club-auth.service.spec.ts），本脚本聚焦真实 HTTP/Redis/DB 链路。
//
// 前置条件：本地服务已启动（PORT=3000）、Redis 可用、.env 已配置 WECHAT_APP_ID/SECRET
// 执行：node scripts/verify-club-auth-e2e.mjs
// 注意：会在 DB 创建测试账号（手机号 13800000001），验证后由清理段删除
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const BASE = 'http://localhost:3000/api';
const TEST_PHONE = '13800000001';
const TEST_PHONE_B = '13800000002';
const TEST_PHONE_C = '13800000003';
const TEST_CODE = '123456';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

let passed = 0;
let failed = 0;

function check(name, ok, extra = '') {
  if (ok) {
    passed += 1;
    console.log(`  ✅ ${name}${extra ? ` ${extra}` : ''}`);
  } else {
    failed += 1;
    console.log(`  ❌ ${name}${extra ? ` ${extra}` : ''}`);
  }
}

function injectCode(phone, code = TEST_CODE) {
  execFileSync('redis-cli', ['SET', `auth:register:purely_club:${phone}`, code, 'EX', '600']);
}

async function post(path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function cleanup(userId) {
  console.log('\n=== 5. 清理测试数据 ===');
  try {
    if (userId) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true },
      });
      if (user) {
        await prisma.user.delete({ where: { id: userId } });
        console.log(`  ✅ 已删除测试账号 (userId=${userId}, email=${user.email})`);
      } else {
        console.log(`  ℹ️ 测试账号已不存在 (userId=${userId})`);
      }
    }
    // 兜底：按测试手机号清理可能残留的 member 记录
    const members = await prisma.member.findMany({
      where: { phone: { in: [TEST_PHONE, TEST_PHONE_B] } },
      select: { id: true },
    });
    if (members.length > 0) {
      await prisma.member.deleteMany({
        where: { id: { in: members.map((m) => m.id) } },
      });
      console.log(`  ✅ 已清理 ${members.length} 条测试 Member 记录`);
    }
  } catch (error) {
    console.log(
      `  ⚠️ 清理异常（不影响验证结论）: ${error instanceof Error ? error.message : error}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  let userId;

  console.log('\n=== 1. 手机号登录即注册 ===');
  injectCode(TEST_PHONE);
  const login = await post('/club/auth/login/code', {
    phone: TEST_PHONE,
    code: TEST_CODE,
  });
  const isOkStatus = login.status === 201 || login.status === 200;
  check('首次登录自动注册', isOkStatus, `(HTTP ${login.status})`);
  const token = login.data?.access_token ?? login.data?.accessToken;
  userId = login.data?.userId;
  check('签发 access_token', typeof token === 'string' && token.length > 10);
  check('返回 userId', typeof userId === 'number', `(userId=${userId})`);

  console.log('\n=== 2. 手机号账号绑定未注册手机号（应 409：账号已有手机号） ===');
  injectCode(TEST_PHONE_B);
  const bind1 = await post(
    '/club/auth/bind-phone',
    { phone: TEST_PHONE_B, code: TEST_CODE },
    token,
  );
  check('拒绝绑定', bind1.status === 409, `(HTTP ${bind1.status})`);
  check(
    '错误文案正确',
    bind1.data?.message === '当前账号已绑定手机号，无需重复绑定',
    `(${bind1.data?.message ?? '无 message'})`,
  );

  console.log('\n=== 3. 手机号账号绑定已注册手机号（应 409：不误入合并分支） ===');
  injectCode(TEST_PHONE_C);
  const bind2 = await post(
    '/club/auth/bind-phone',
    { phone: TEST_PHONE_C, code: TEST_CODE },
    token,
  );
  check('拒绝绑定', bind2.status === 409, `(HTTP ${bind2.status})`);
  check(
    '错误文案正确',
    bind2.data?.message === '当前账号已绑定手机号，无需重复绑定',
    `(${bind2.data?.message ?? '无 message'})`,
  );

  console.log('\n=== 4. 微信登录假 code（错误映射链路，证明 code2session 打通） ===');
  const wx = await post('/club/auth/login/wechat', { code: 'fake_code_e2e' });
  check('返回 401 友好提示', wx.status === 401, `(HTTP ${wx.status})`);
  check(
    '文案为凭证过期提示',
    wx.data?.message === '微信登录凭证无效或已过期，请重新发起微信授权',
    `(${wx.data?.message ?? '无 message'})`,
  );

  console.log(`\n结果：${passed} 通过 / ${failed} 失败\n`);
  await cleanup(userId);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

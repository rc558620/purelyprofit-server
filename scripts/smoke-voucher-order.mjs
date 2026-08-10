// 纯利宝团购券全链路冒烟：数据准备 → 下单 → 支付确认 → 列表/详情 → 核销 → 商家读取 → 开台绑定 → 重复读取拦截
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const pg = require('pg');
require('dotenv').config();

const BASE = 'http://localhost:3000/api';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
const SECRET = process.env.JWT_SECRET;

/** 手写 HS256 JWT（冒烟脚本避免依赖 jsonwebtoken） */
const signJwt = (payload) => {
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const header = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64(payload);
  const signature = createHmac('sha256', SECRET)
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${signature}`;
};

const clubToken = signJwt({
  sub: 66, phone: '13619654010', accountScope: 'purely_club', aud: 'purely_club',
});
// 商家 token：user 69 是门店 42 的 staff（主账号）
const merchantToken = signJwt({
  sub: 69, phone: 'profit_phone_13619654022@purelyprofit.local',
});

const call = async (method, path, body, token) => {
  const headers = { Authorization: `Bearer ${token}` };
  if (body) headers['Content-Type'] = 'application/json';
  const resp = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await resp.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: resp.status, json };
};

const step = (name) => console.log(`\n===== ${name} =====`);

(async () => {
  // 1. 数据准备：商品 1 设为团购券商品
  step('数据准备');
  const product = await prisma.marketingProduct.update({
    where: { id: 1 },
    data: { type: 'voucher', personCount: 2, validDays: 7, stock: 50 },
  });
  console.log('商品:', product.name, 'type=', product.type, 'personCount=', product.personCount, 'stock=', product.stock);
  let member = await prisma.member.findFirst({
    where: { storeId: 42, phone: '13619654010', deletedAt: null },
  });
  if (!member) {
    member = await prisma.member.create({
      data: { storeId: 42, phone: '13619654010', name: 'f0rest', status: 'active' },
    });
  }
  let customer = await prisma.marketingCustomer.findFirst({
    where: { storeId: 42, phone: '13619654010', deletedAt: null },
  });
  if (!customer) {
    customer = await prisma.marketingCustomer.create({
      data: {
        storeId: 42, memberId: member.id, name: 'f0rest', phone: '13619654010', status: 'active',
      },
    });
  }
  console.log('会员与顾客档案 OK', 'memberId=', member.id, 'customerId=', customer.id);

  // 2. 创建团购券订单
  step('创建团购券订单');
  let r = await call('POST', '/club/voucher-orders', {
    storeId: 42, productId: 1, quantity: 1, personCount: 3, usePoints: false,
  }, clubToken);
  console.log('创建:', r.status, JSON.stringify(r.json));
  const orderNo = r.json?.orderNo;
  if (!orderNo) throw new Error('创建订单失败');

  // 3. 确认支付 → 生成券码
  step('确认支付（开发态兜底）');
  r = await call('POST', `/club/voucher-orders/${orderNo}/confirm-paid`, null, clubToken);
  console.log('确认支付:', r.status, JSON.stringify(r.json));
  const voucherCode = r.json?.voucherCode;
  if (!voucherCode) throw new Error('券码生成失败');

  // 4. 列表
  step('我的订单列表');
  r = await call('GET', '/club/voucher-orders?status=all&limit=10', null, clubToken);
  console.log('列表:', r.status, 'items=', r.json?.items?.length);
  if (r.json?.items?.length > 0) console.log('首条:', JSON.stringify(r.json.items[0]));

  // 5. 详情
  step('订单详情');
  r = await call('GET', `/club/voucher-orders/${orderNo}`, null, clubToken);
  console.log('详情:', r.status, JSON.stringify(r.json));

  // 6. 商家读取券码
  step('商家读取团购券（开台回填）');
  r = await call('POST', '/space-sessions/voucher/read', { storeId: 42, voucherCode }, merchantToken);
  console.log('读取:', r.status, JSON.stringify(r.json));

  // 7. 用户端立即核销
  step('用户端立即核销');
  r = await call('POST', `/club/voucher-orders/${orderNo}/verify`, null, clubToken);
  console.log('核销:', r.status, JSON.stringify(r.json));

  // 8. 核销后商家仍可读取
  step('核销后（used-未开台）商家读取');
  r = await call('POST', '/space-sessions/voucher/read', { storeId: 42, voucherCode }, merchantToken);
  console.log('读取:', r.status, JSON.stringify(r.json));

  // 9. 商家开台绑定券码（自动核销）
  step('商家开台（带券码自动核销）');
  // 清理历史测试产生的 active 会话（避免空间占用导致无法开台）
  await prisma.spaceSession.updateMany({
    where: { storeId: 42, status: 'active' },
    data: { status: 'settled', endTime: new Date() },
  });
  r = await call('POST', '/spaces/1/sessions', {
    billingMode: 'items',
    guestName: '回填测试',
    guestPhone: '13619654010',
    guestCount: 3,
    prepaidCustomerPaymentMethod: 'groupon_voucher',
    prepaidVoucherCode: voucherCode,
    prepaidVoucherPlatform: 'chunlibao',
    prepaidVoucherFaceAmount: 128.5,
    prepaidAmount: 128.5,
  }, merchantToken);
  console.log('开台:', r.status, JSON.stringify(r.json)?.slice?.(0, 300) ?? r.json);
  const sessionId = r.json?.id;

  // 10. 再次读取 → 应报"该团购券已使用"
  step('再次读取已开台券 → 拦截');
  r = await call('POST', '/space-sessions/voucher/read', { storeId: 42, voucherCode }, merchantToken);
  console.log('再次读取:', r.status, JSON.stringify(r.json));

  // 11. 已开台券用户端退款 → 应被拦截
  step('已开台券退款 → 拦截');
  r = await call('POST', `/club/voucher-orders/${orderNo}/refund`, null, clubToken);
  console.log('退款:', r.status, JSON.stringify(r.json));

  // 12. 新订单退款成功场景（pending 可退 + 库存回补）
  step('新订单退款成功（pending → refunded + 库存回补）');
  const stockBefore = await prisma.marketingProduct.findUnique({
    where: { id: 1 },
    select: { stock: true },
  });
  r = await call('POST', '/club/voucher-orders', {
    storeId: 42, productId: 1, quantity: 2, personCount: 2, usePoints: false,
  }, clubToken);
  const refundOrderNo = r.json?.orderNo;
  await call('POST', `/club/voucher-orders/${refundOrderNo}/confirm-paid`, null, clubToken);
  const stockAfterBuy = await prisma.marketingProduct.findUnique({
    where: { id: 1 },
    select: { stock: true },
  });
  r = await call('POST', `/club/voucher-orders/${refundOrderNo}/refund`, null, clubToken);
  console.log('退款成功:', r.status, JSON.stringify(r.json));
  const stockAfterRefund = await prisma.marketingProduct.findUnique({
    where: { id: 1 },
    select: { stock: true },
  });
  console.log(
    '库存变化:', 'before=', stockBefore?.stock,
    'afterBuy=', stockAfterBuy?.stock,
    'afterRefund=', stockAfterRefund?.stock,
  );
  if ((stockAfterBuy?.stock ?? 0) !== (stockBefore?.stock ?? 0) - 2) {
    throw new Error('购买后库存未扣减');
  }
  if ((stockAfterRefund?.stock ?? 0) !== (stockBefore?.stock ?? 0)) {
    throw new Error('退款后库存未回补');
  }

  console.log(`\n✅ 冒烟完成。sessionId=${sessionId} voucherCode=${voucherCode}`);
  await prisma.$disconnect();
})().catch((e) => { console.error('❌ 冒烟失败:', e.message); process.exit(1); });

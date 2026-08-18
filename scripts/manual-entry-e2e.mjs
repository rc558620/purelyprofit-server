// 录入订单端到端联调脚本：C1 三条业务场景 + A5 归集闭环 + C3 异常路径（阶段 C 联调验证，D3 上线冒烟可复跑）
// 用法：node scripts/manual-entry-e2e.mjs [baseUrl]
import crypto from 'node:crypto';

const BASE_URL = process.argv[2] ?? 'http://127.0.0.1:4399';
const PHONE = '13619654040';
const PASSWORD = '111111';

const results = [];
const record = (name, passed, detail) => {
  results.push({ name, passed, detail });
  console.log(`${passed ? '✅' : '❌'} ${name}${detail ? `：${detail}` : ''}`);
};

/** 发起 JSON 请求，返回 { status, body }；非 2xx 不抛错由调用方判定 */
const request = async (method, path, { token, body, headers } = {}) => {
  const response = await fetch(`${BASE_URL}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers ?? {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: response.status, body: parsed };
};

// ─── 1. 登录 ──────────────────────────────────────────────────────────────
const captchaToken = `puzzle_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
await request('POST', '/auth/captcha/register', {
  body: { captchaToken },
});
const loginResponse = await request('POST', '/auth/login', {
  body: { phone: PHONE, password: PASSWORD, captchaToken },
});
const token = loginResponse.body?.access_token ?? loginResponse.body?.accessToken ?? loginResponse.body?.token;
if (!token) {
  console.error('登录失败：', JSON.stringify(loginResponse.body).slice(0, 300));
  process.exit(1);
}
console.log(`🔐 登录成功（userId=${loginResponse.body.user?.id ?? '?'}）\n`);

// ─── 2. 菜单与桌台基线 ────────────────────────────────────────────────────
const menuResponse = await request('GET', '/profit/scan-ordering/manual-entry/menu', { token });
record('C2 菜单接口 200', menuResponse.status === 200);
const categories = menuResponse.body?.categories ?? [];
const products = categories.flatMap((category) => category.products ?? []);
const specProduct = products.find((product) => (product.specGroups ?? []).length > 0 && !product.soldOut);
const plainProduct = products.find((product) => (product.specGroups ?? []).length === 0 && !product.soldOut);
const soldOutProduct = products.find((product) => product.soldOut);
record(
  'C2 菜单数据形态（分类/含规格商品/无规格商品）',
  categories.length > 0 && Boolean(specProduct) && Boolean(plainProduct),
  `分类 ${categories.length} 个，商品 ${products.length} 个${soldOutProduct ? '，含售罄商品' : '（无售罄样本）'}`,
);
console.log(`   规格商品样本：${specProduct?.name}（基础价 ${specProduct?.basePrice}，${specProduct?.specGroups?.length} 组规格）`);

const tablesResponse = await request('GET', '/profit/scan-ordering/tables', { token });
const usableTable = (tablesResponse.body ?? []).find((table) => table.status === 'empty' || table.status === 'dining');
record('C2 桌台接口可用', tablesResponse.status === 200 && Boolean(usableTable), usableTable ? `桌台【${usableTable.name}】状态 ${usableTable.status}` : '');

// 规格商品默认选项（必选组取默认项，可机组取首个）→ 组装 specOptionIds
const buildDefaultSpecOptionIds = (product) =>
  (product.specGroups ?? []).flatMap((group) => {
    const activeOptions = group.options ?? [];
    const defaults = activeOptions.filter((option) => option.isDefault);
    const picked = defaults.length > 0 ? defaults : activeOptions.slice(0, group.minSelections ?? 1);
    return picked.map((option) => option.id);
  });

const specOptionIds = specProduct ? buildDefaultSpecOptionIds(specProduct) : [];

// ─── 3. C1-1 团购到店（dineIn + platform + 券面） ─────────────────────────
console.log('\n─── C1-1 团购到店 ───');
const grouponItems = [
  { productId: specProduct.id, specOptionIds, quantity: 2 },
  { productId: plainProduct.id, quantity: 1 },
];
const grouponPreview = await request('POST', '/profit/scan-ordering/manual-entry/preview', {
  token,
  body: { items: grouponItems, paymentMethod: 'platform', voucherAmount: 50 },
});
const gp = grouponPreview.body ?? {};
const grouponPreviewOk =
  (grouponPreview.status === 200 || grouponPreview.status === 201) &&
  gp.items?.length === 2 &&
  gp.payableAmount === Math.min(50, gp.itemsTotal) &&
  gp.discountAmount === gp.itemsTotal - gp.payableAmount;
record(
  'C1-1 preview 券面封顶不找零（应付=min(券面,合计)）',
  grouponPreviewOk,
  `合计 ${gp.itemsTotal} / 优惠 ${gp.discountAmount} / 应付 ${gp.payableAmount}；行单价 [${(gp.items ?? []).map((item) => item.unitPrice).join(', ')}]`,
);

const grouponKey = `e2e-groupon-${crypto.randomUUID()}`;
const grouponOrderBody = {
  items: grouponItems,
  diningMode: 'dineIn',
  tableId: usableTable?.id,
  guestCount: 3,
  customerPhone: '13800138000',
  sourceChannel: 'meituanVoucher',
  paymentMethod: 'platform',
  voucherAmount: 50,
  remark: 'C1-1 团购到店联调',
};
const grouponOrder = await request('POST', '/profit/scan-ordering/manual-entry/orders', {
  token,
  body: grouponOrderBody,
  headers: { 'Idempotency-Key': grouponKey },
});
const go = grouponOrder.body ?? {};
record(
  'C1-1 建单成功（#M- 号段）',
  grouponOrder.status === 201 && /^#M-\d{8}-\d{3}$/.test(go.orderNo ?? ''),
  `订单号 ${go.orderNo}，应付 ${go.payableAmount}`,
);

// ─── C3 幂等：同键重复提交返回同一订单 ────────────────────────────────────
const grouponRetry = await request('POST', '/profit/scan-ordering/manual-entry/orders', {
  token,
  body: grouponOrderBody,
  headers: { 'Idempotency-Key': grouponKey },
});
record(
  'C3 幂等双击：同键重提返回同一订单',
  grouponRetry.status === 201 && grouponRetry.body?.orderNo === go.orderNo,
  `重试返回 ${grouponRetry.body?.orderNo}`,
);

// ─── 4. C1-2 第三方外卖（platform 就餐 + 强制平台结算 + 平台单号） ────────
console.log('\n─── C1-2 第三方外卖 ───');
const takeawayItems = [{ productId: plainProduct.id, quantity: 3 }];
const takeawayOrder = await request('POST', '/profit/scan-ordering/manual-entry/orders', {
  token,
  body: {
    items: takeawayItems,
    diningMode: 'platform',
    sourceChannel: 'meituan',
    externalOrderNo: 'MT-E2E-0001',
    paymentMethod: 'platform',
    remark: 'C1-2 第三方外卖联调',
  },
  headers: { 'Idempotency-Key': `e2e-takeaway-${crypto.randomUUID()}` },
});
record(
  'C1-2 建单成功（第三方外卖·平台结算）',
  takeawayOrder.status === 201 && /^#M-/.test(takeawayOrder.body?.orderNo ?? ''),
  `订单号 ${takeawayOrder.body?.orderNo}，应付 ${takeawayOrder.body?.payableAmount}`,
);

// ─── 5. C1-3 普通自取（cash，无券面干扰） ────────────────────────────────
console.log('\n─── C1-3 普通自取 ───');
const cashOrder = await request('POST', '/profit/scan-ordering/manual-entry/orders', {
  token,
  body: {
    items: takeawayItems,
    diningMode: 'takeaway',
    paymentMethod: 'cash',
    remark: 'C1-3 普通自取联调',
  },
  headers: { 'Idempotency-Key': `e2e-cash-${crypto.randomUUID()}` },
});
record(
  'C1-3 建单成功（现金自取）',
  cashOrder.status === 201 && /^#M-/.test(cashOrder.body?.orderNo ?? ''),
  `订单号 ${cashOrder.body?.orderNo}，应付 ${cashOrder.body?.payableAmount}`,
);

// ─── 6. A5 归集验证（销售记录 / 交班 / 报表） ─────────────────────────────
console.log('\n─── A5 归集闭环 ───');
const salesList = await request('GET', '/sales-record?period=today', { token });
const salesItems = salesList.body?.items ?? [];
const createdOrderNos = [go.orderNo, takeawayOrder.body?.orderNo, cashOrder.body?.orderNo].filter(Boolean);
const foundSales = salesItems.filter((item) => createdOrderNos.includes(item.orderNo));
const grouponSale = foundSales.find((item) => item.orderNo === go.orderNo);
record(
  'A5 销售记录列表归集（3 笔全部可见）',
  foundSales.length === createdOrderNos.length,
  `${foundSales.length}/${createdOrderNos.length} 笔：${foundSales.map((item) => item.orderNo).join('、')}`,
);
record(
  'A5 来源标识（manualEntry/diningMode/sourceChannel/paymentLabel）',
  Boolean(
    grouponSale?.manualEntry === true &&
      grouponSale?.diningMode === 'dineIn' &&
      grouponSale?.sourceChannel === 'meituanVoucher' &&
      grouponSale?.paymentMethod === 'platform',
  ),
  `${grouponSale?.orderNo} manualEntry=${grouponSale?.manualEntry}，paymentLabel=${grouponSale?.paymentLabel}`,
);

const handoverPage = await request('GET', '/handover/page', { token });
const handoverBody = handoverPage.body ?? {};
// 交班页归集判定：收款分组出现「平台结算」桶且金额覆盖两笔平台结算手工单（#M-001 应付 + #M-002 应付）
const platformBucket = (handoverBody.paymentItems ?? []).find((item) => item.method === 'platform');
const expectedPlatformAmount = Number(go.payableAmount ?? 0) + Number(takeawayOrder.body?.payableAmount ?? 0);
record(
  'A5 交班页归集（平台结算桶含手工单实收）',
  handoverPage.status === 200 && Number(platformBucket?.amount ?? 0) >= expectedPlatformAmount,
  `交班收款分组 platform=¥${platformBucket?.amount ?? 0}（含两笔平台结算手工单 ¥${expectedPlatformAmount}），今日营业额 ¥${handoverBody.revenueSummary?.totalRevenue}`,
);
const cashBucket = (handoverBody.paymentItems ?? []).find((item) => item.method === 'cash');
record(
  'A5 交班页归集（现金桶含 C1-3 实收）',
  Number(cashBucket?.amount ?? 0) >= Number(cashOrder.body?.payableAmount ?? 0),
  `现金桶 ¥${cashBucket?.amount ?? 0} ≥ C1-3 实收 ¥${cashOrder.body?.payableAmount}`,
);

const salesStats = await request('GET', '/sales-record/stats?period=today', { token });
record(
  'A5 销售统计口径（今日营业额 > 0）',
  salesStats.status === 200 && Number(salesStats.body?.totalRevenue ?? 0) > 0,
  `今日营业额 ¥${salesStats.body?.totalRevenue}`,
);

// ─── 7. C3 异常路径 ──────────────────────────────────────────────────────
console.log('\n─── C3 异常路径 ───');
if (soldOutProduct) {
  const soldOutPreview = await request('POST', '/profit/scan-ordering/manual-entry/preview', {
    token,
    body: { items: [{ productId: soldOutProduct.id, quantity: 1 }], paymentMethod: 'cash' },
  });
  record(
    'C3 售罄商品拦截',
    soldOutPreview.status === 400 && String(soldOutPreview.body?.message ?? '').includes('售罄'),
    soldOutPreview.body?.message,
  );
} else {
  record('C3 售罄商品拦截', true, '（菜单无售罄样本，跳过）');
}

const noVoucherPreview = await request('POST', '/profit/scan-ordering/manual-entry/orders', {
  token,
  body: {
    items: takeawayItems,
    diningMode: 'takeaway',
    paymentMethod: 'cash',
    voucherAmount: 30,
  },
  headers: { 'Idempotency-Key': `e2e-invalid-${crypto.randomUUID()}` },
});
record(
  'C3 券面仅平台结算可填（cash+券面 → 400）',
  noVoucherPreview.status === 400,
  noVoucherPreview.body?.message,
);

const noTableOrder = await request('POST', '/profit/scan-ordering/manual-entry/orders', {
  token,
  body: { items: takeawayItems, diningMode: 'dineIn', paymentMethod: 'cash' },
  headers: { 'Idempotency-Key': `e2e-notable-${crypto.randomUUID()}` },
});
record(
  'C3 堂食必选桌台（dineIn 无桌台 → 400）',
  noTableOrder.status === 400,
  noTableOrder.body?.message,
);

const badPaymentOrder = await request('POST', '/profit/scan-ordering/manual-entry/orders', {
  token,
  body: {
    items: takeawayItems,
    diningMode: 'platform',
    paymentMethod: 'cash',
    sourceChannel: 'meituan',
  },
  headers: { 'Idempotency-Key': `e2e-badpay-${crypto.randomUUID()}` },
});
record(
  'C3 第三方外卖强制平台结算（platform+cash → 400）',
  badPaymentOrder.status === 400,
  badPaymentOrder.body?.message,
);

const missingKeyOrder = await request('POST', '/profit/scan-ordering/manual-entry/orders', {
  token,
  body: { items: takeawayItems, diningMode: 'takeaway', paymentMethod: 'cash' },
});
record(
  'C3 缺失幂等键（无 Idempotency-Key → 409）',
  missingKeyOrder.status === 409,
  missingKeyOrder.body?.message,
);

// ─── 8. 汇总 ─────────────────────────────────────────────────────────────
const failed = results.filter((item) => !item.passed);
console.log(`\n═══ 联调汇总：${results.length - failed.length}/${results.length} 通过 ═══`);
if (failed.length > 0) {
  console.error('失败项：', failed.map((item) => item.name).join('；'));
  process.exit(1);
}

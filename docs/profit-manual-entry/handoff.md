# 录入订单功能 · 交接文档（第一阶段前端已完成 → 第二阶段后端接入直到上线闭环）

> 本文档面向新会话的 AI 与开发者。开始任何编码前请完整阅读本文档。
> 交付节奏约定：**用户已确认第一阶段静态前端（"前端确认了"），第二阶段可直接开工，不再需要等待确认。**

---

## 一、你在做什么（任务背景）

`purelyProfit`（商家端 PC 后台，React 19 + CSS Modules + Less，绿色 lime 基调）新增「录入订单」功能：

**业务问题**：门店日常存在大量**不走 purelyClub 小程序扫码**的线下交易——
1. 第三方外卖平台代下单（顾客在美团/饿了么下单，商家在平台出餐，钱走平台结算）
2. 团购券核销（美团团购/抖音团购等到店用餐，凭券面金额抵扣）
3. 电话订餐、到店现金/POS 直收

这些订单目前无法进入系统，造成**账目缺口**（营业额、交班、报表均缺失这部分）。

**解决方案**：商家端「录入订单」页面，店员手工补录上述订单，使其计入营业额/交班/销售记录/报表。前后端共用仓库关系：前端 `purelyProfit`，后端 `purelyprofit-server`（本仓库），两条产品线语义落在 `src/purely-profit/`（商家/老板视角）。

---

## 二、为什么这么做（关键架构决策，均已与用户确认）

| 决策 | 理由 |
|------|------|
| 独立页面 `/scan-ordering/manual-entry`，不并入 C 端点餐链路 | 录入订单是商家侧补账行为，无 C 端用户/会员/支付通道，复用 C 端建单会引入会员语义污染 |
| 三栏布局（左分类导航 / 中商品网格+搜索+库存 / 右订单明细+订单信息表单+金额预览） | 店员单屏完成"找商品→组单→填信息→提交"，PC 端效率优先 |
| 规格选择用**左侧滑入抽屉** | 不遮挡右栏订单明细，追加商品时直观看到明细与金额实时变化（用户明确要求） |
| 规格抽屉交互**对齐 purelyClub C 端**（`SpecSelectModal` 模式） | 同一交互心智：当前规格未加购显示「加入订单」按钮、已加购切换 `- N +` 步进器（数量与右栏实时同步）；加入后不关抽屉、规格保留，可连续追加不同组合；同商品不同规格组合独立成行、相同组合合并数量 |
| 金额**后端权威** | 前端现存的金额计算全部是**静态演示口径**（代码内有注释标记），第二阶段必须由后端 preview 接口返回，前端只展示。这是 f0rest 规范红线 |
| 券面抵扣公式：`应付 = min(券面, 商品合计)`、`优惠 = 合计 − 应付`（封顶不找零） | 用户确认的团购核销口径，计算权归后端 |
| 提交前单步核对弹窗（消费明细逐行 + 券面抵扣行 + 实付大字） | 参考 C 端消费明细样式，"确定即提交" |
| 「提交后打印小票」checkbox | 语义化"是否提交就打印"，复用 `scanOrderingPrint` 打印调度 |

---

## 三、现在做到哪一步了（第一阶段已完成，全部质量门绿）

### 3.1 前端文件地图（purelyProfit，均已完成并通过 check-f0rest-rules / tsc / eslint）

```
src/pages/main/operations/scanOrdering/manualEntry/
├── manualEntry.tsx                  # 页面装配：三栏 + 状态编排 + 提交校验
├── manualEntry.types.ts             # 全部数据模型（枚举/表单/草稿行/金额预览）
├── manualEntry.mock.ts              # 演示数据 ⚠️ 接口接入后整体删除
├── manualEntry.module.less
├── hooks/
│   ├── useManualEntryDraft.ts       # 草稿行合并/增删 + 表单状态 + 金额演示（有"演示口径"注释）
│   └── useSpecSelection.ts          # 规格状态机（移植自 purelyClub，单选互斥/多选上限/默认预选）
└── components/
    ├── CategorySidebar/             # 左栏分类导航（含分类计数红点）
    ├── ProductGrid/                 # 中栏搜索+商品网格；价格旁库存值六档色阶（对齐 stocktaking）
    ├── OrderPanel/                  # 右栏容器（明细+表单+金额）
    ├── OrderInfoForm/               # 订单信息表单（联动见 3.3）
    ├── AmountSummary/               # 金额预览 + 打印 checkbox + 提交按钮
    ├── SpecDrawer/                  # 左滑规格抽屉（purelyClub 连续追加模式）
    ├── SubmitConfirmModal/          # 单步核对弹窗（确定即提交）
    ├── MobileDraftBar/              # 移动端草稿悬浮条
    └── ManualEntryIcons/
```

路由已挂载：`/scan-ordering/manual-entry`（router 的 paths/definitions/pages 已改）。
打印通道复用：`src/features/scanOrderingPrint/`（dispatcher 未接，见阶段 B-5）。

### 3.2 已实现的核心交互契约（后端 DTO 设计依据，字段以前端为准）

**枚举定义**（manualEntry.types.ts）：

```ts
// 就餐方式：dineIn 堂食/团购到店（均需选桌台）/ takeaway 自取 / platform 第三方外卖
type ManualEntryDiningMode = 'dineIn' | 'takeaway' | 'platform';
// 支付方式：cash 现金 / wechat 微信 / alipay 支付宝 / card 刷卡 / platform 平台结算（全模式可选）
type ManualEntryPaymentMethod = 'cash' | 'wechat' | 'alipay' | 'card' | 'platform';
// 来源渠道（下拉）：meituan 美团外卖 / eleme 饿了么 / meituanVoucher 美团团购 /
//                  douyin 抖音团购 / dianping 大众点评 / other 其他平台
type ManualEntrySourceChannel = 'meituan' | 'eleme' | 'meituanVoucher' | 'douyin' | 'dianping' | 'other';
```

**表单字段**（ManualEntryFormState）：diningMode / tableId / guestCount / customerPhone /
sourceChannel / externalOrderNo（平台单号，选填）/ voucherAmount（券面金额原始输入文本，选填）/
paymentMethod / remark。

**表单联动规则**（已实现，勿破坏）：
- dineIn → 桌台必选 + 就餐人数；platform → 来源渠道显示、支付方式**隐藏且强制 platform**（切走保留不回退）
- paymentMethod === 'platform' → 显示 平台单号 + 券面金额 两个输入（不限就餐方式，团购到店/第三方外卖均适用）
- 提交校验：明细非空；dineIn 必须有桌台

**草稿行合并键**（useManualEntryDraft.buildRowId）：
`productId:sorted(specOptionIds).join('-')`，无规格为 `productId:plain`。
规格抽屉的 currentRow 匹配口径与此一致（商品 ID + 排序后选项 ID 集合完全相等）。

**库存六档色阶**（ProductGrid，色值与 goods/stocktaking、marketing-products 一致，纯前端展示）：
0 缺货玫红 @rose-500 / 1–9 浅玫红 #fb7185 / 10–99 琥珀橙 @amber-500 /
100–299 翠绿 @emerald-500 / 300–499 teal #14b8a6 / 500+ 靛紫 @indigo-500。
后端只需返回 `stockQuantity: number | null`（null = 不限量，前端不显示）。

### 3.3 金额演示口径（⚠️ 第二阶段必须替换为后端 preview）

`useManualEntryDraft.ts` 内 amountPreview（有醒目注释标记）：
- `itemsTotal = Σ unitPrice × quantity`（unitPrice 现为规格组合演示算术：基础价 + 加价合计）
- platform 结算且券面有效：`payable = min(voucher, itemsTotal)`，`discount = itemsTotal − payable`
- 正式版：**规格组合单价、商品合计、优惠、应付全部由后端 preview 接口返回**

---

## 四、剩余步骤清单（按顺序执行，直到上线闭环）

### 阶段 A：purelyprofit-server 后端（先做）

> 开工前必读：`/Users/f0rest/Documents/AgentMode/f0rest_backend_conventions.md`（f0rest 2026.05）。
> 本仓库指令：`.qoder/rules/project-instructions.md`。可调用技能：`purelyprofit-server-backend-architecture`。

- [x] **A0 现状探索**：摸清 `src/purely-profit/` 现有订单域结构（扫码点餐建单如何落库、交班/销售记录/报表如何归集），确定 manual-entry 接口落层（建议 `operations/scan-ordering/` 旁新子域，遵循既有 controller/service/repository 分层）
  - 结论：后端不建 ScanOrders，直接落 SaleOrder（方案 A）；录入订单本质是「扫码点餐菜单选品 + 销售记录补账」，归集链路天然闭环
- [x] **A1 数据模型评估**：订单主表是否需要新增/启用字段——来源渠道 sourceChannel、平台单号 externalOrderNo、券面金额 voucherAmount、支付方式枚举扩展 platform、桌台/人数关联。如需 schema 变更：改 `prisma/schema.prisma` + migration，评估存量数据兼容
  - 已落地：`sale_orders` 新增 manual_entry/dining_mode/source_channel/external_order_no/guest_count/customer_phone/dining_table_id（全部可空/带默认值）；`SalesPaymentMethod` 新增 `platform`；新枚举 `ManualEntryDiningMode`/`ManualEntrySourceChannel`；migration `20260815120000_add_manual_entry_order_fields` 已应用
  - 券面金额复用既有 `voucher_face_amount`；订单号手工单独立号段 `#M-YYYYMMDD-NNN`（`generateOrderNo` variant 参数，与普通单各自计数不跳号）
- [x] **A2 GET 商家侧菜单**：分类 + 商品（含规格组/选项/售罄态/库存 stockQuantity）+ 桌台列表（可能复用空间域既有接口，能复用则不新建）。DTO + Swagger 注解
  - 已落地：`GET /api/profit/scan-ordering/manual-entry/menu`（含规格组/选项/可用库存/售罄态，响应字段对齐前端 ManualEntry* 类型）；桌台前端直接复用既有 `GET /api/profit/scan-ordering/tables`（含 id/name/areaName/status/guestCount）
- [x] **A3 POST 价格预览（preview）**：入参 items[]（productId + specOptionIds + quantity）+ 支付方式 + 券面金额；返回每组规格组合单价 + 商品合计 + 优惠 + 应付。**金额计算唯一权威在此实现**（券面封顶不找零公式见 3.3）
  - 已落地：`POST /api/profit/scan-ordering/manual-entry/preview`；定价校验口径与 C 端一致（在售/售罄/规格 min-max/可用库存=总量−预留）；券面抵扣 `应付 = min(券面, 合计)` 走 Money 值对象
- [x] **A4 POST 商家侧建单**：一次性提交全量 items + 订单信息（diningMode/tableId/guestCount/phone/sourceChannel/externalOrderNo/voucherAmount/paymentMethod/remark）+ **幂等键**（防店员双击重复建单）；事务内落订单 + 明细快照（商品名/规格名/单价快照，防后续改价影响历史）
  - 已落地：`POST /api/profit/scan-ordering/manual-entry/orders`（Header `Idempotency-Key`，IdempotencyRecord 幂等 + sha256 请求指纹）；事务内：菜单库存+规格库存+商品库库存扣减（乐观锁）→ SalesRecordService 落库（preserveCallerSalePrices，明细按件展开、应付按行金额比例摊销到每件单价，与扫码订单 bridge 同口径）；表单联动后端兜底校验（dineIn 必选桌台/第三方外卖强制 platform/平台结算必选来源渠道/券面仅平台结算可填）
- [ ] **A5 联动验证**：新录入的订单必须出现在——订单列表（带来源标识）、交班记录、销售记录、报表中心口径。缺失任何一处即未闭环
  - 后端代码链路已确认：销售记录列表/交班（PAYMENT_METHOD_CONFIG 已加 platform「平台结算」）/报表聚合均查 sale_orders 自然归集；销售记录响应已带 manualEntry/diningMode/sourceChannel/guestCount 来源标识。端到端实测待 C 阶段联调
- [x] **A6 质量门**：`node scripts/check-f0rest-rules.mjs <文件>`（逐文件）+ tsc + eslint + 既有测试套件全绿；如新增测试放 `test/`
  - 全部 22 个改动/新增文件 check-f0rest-rules ✅；build ✅；eslint ✅；tsc 非 spec 零错误；测试基线对比（stash 前后均为 147 failed/1943 passed，全部存量问题，零回归）；dev 服务冒烟：3 条路由注册 + 401 守卫生效 ✅

### 阶段 B：purelyProfit 前端接入（后端接口就绪后）

> 开工前必读：`/Users/f0rest/Documents/AgentMode/f0rest_frontend_conventions.md`（f0rest 2026.03）。
> 进入 api 模式：分层要求——页面只渲染分发，hook 管请求时机/loading/提交流程，service/repository 管调用与映射。字段以前端为准，映射在 service 层做。

- [x] **B1 service/repository 层**：新建 manualEntry.service.ts / repository（菜单、桌台、preview、建单），响应映射到既有 ManualEntry* 类型，**不得反向改前端字段**
  - 已落地：`manualEntry.service.ts`（菜单聚合/桌台/preview/建单四函数；后端数字 ID ↔ 前端字符串 ID 映射；selectionType→selectMode、extraPrice→priceDelta、basePrice→price；建单携带 Header `Idempotency-Key`）
- [x] **B2 删 mock**：删除 manualEntry.mock.ts，菜单/桌台数据改走接口（含首屏 loading、请求失败、空数据三态建模）
  - 已落地：mock 已删（INITIAL_FORM_STATE 迁至 `manualEntry.constants.ts`）；`useManualEntryMenu` 管理菜单+桌台并行加载，页面三态：InertiaSpinner 加载中 / 错误卡片+重试按钮 / 空菜单引导
- [x] **B3 金额接 preview**：useManualEntryDraft 的 amountPreview 演示算术替换为后端返回（注意防抖/竞态：规格或数量变更后旧响应不得覆盖新状态）；SpecDrawer 的 displayUnitPrice 同理改为后端报价
  - 已落地：draft hook 删除全部金额算术；`useManualEntryPreview`（350ms 防抖 + 请求序号竞态防护 + 行小计 lineTotals 回填，请求期间保留上次成功值避免闪烁）；`useSpecUnitPrice`（抽屉规格选齐后 300ms 防抖单行报价，未选齐/报价失败显示「—/报价中…」且禁止加购）；提交前 previewError/previewLoading 拦截
- [x] **B4 提交接建单**：SubmitConfirmModal 确定后调真实建单（幂等键、防重复提交、提交中禁用按钮、失败 Toast 可重试），成功后清空草稿 + 刷新订单侧数据
  - 已落地：幂等键 ref（crypto.randomUUID，同一草稿重试复用、成功后重置）；submitting 状态（确认按钮禁用+文案「提交中…」+关闭拦截）；失败 Toast 且弹窗保持打开可重试；成功关弹窗+清草稿+Toast 订单号；行小计/实付均展示后端 preview 值（弹窗不再算术）
- [x] **B5 打印接线**：printReceipt 为 true 时调用 `src/features/scanOrderingPrint/` 的 dispatcher 下发小票打印
  - 已落地（browser 通道完整）：`useManualEntryReceiptPrint` 读取门店收银台打印通道，browser 渲染 `ManualEntryReceiptPrintView`（80mm 热敏小票，portal + @media print）触发 window.print；⚠️ cloud/usb 通道后端打印接口以扫码订单 ID 为键，暂不支持手工单，当前 Toast 提示切换浏览器打印（后端支持后接入，见风险清单）
- [x] **B6 质量门**：`node scripts/check-f0rest-rules.mjs <文件>`（只收 .ts/.tsx，.less 不适用）+ `npx tsc -b tsconfig.app.json tsconfig.node.json`（⚠️ 勿用全量 `tsc -b`，会混入既有无关错误）+ eslint 全绿
  - 全部 15 个新增/改动文件 check-f0rest-rules ✅；eslint 零错误；tsc -b app+node 零错误；vite build 成功；mock 零残留引用

### 阶段 C：联调验证（前后端联跑）

- [x] **C1 三条业务场景端到端**：
  1. **团购到店**：堂食/团购到店 → 选桌台 → 支付方式平台结算 → 来源渠道（美团团购/抖音团购）→ 录券面金额 → 优惠/应付实时重算 → 核对弹窗含「券面抵扣」行 → 提交 → 订单列表可见 → 交班/报表归集
     - ✅ 实测：券面 50 / 合计 244 → 优惠 194 / 应付 50（min 封顶不找零）；订单号 #M-20260815-010；销售记录/交班 platform 桶归集 ✅
     - ⚠️ 联调中发现并修复一个真 bug：后端首版把公式实现反了（优惠=min/应付=差额），已按契约修正为「应付=min(券面,合计)、优惠=差额、无券面应付=合计」
  2. **第三方外卖**：第三方外卖（支付方式隐藏、默认平台结算）→ 来源渠道 → 平台单号 + 券面金额 → 提交 ✅（#M-20260815-011，后端强制校验 platform 就餐必须 platform 支付）
  3. **普通堂食/自取**：现金/微信/支付宝/刷卡，无券面字段干扰 → 提交 ✅（#M-20260815-012 现金自取；cash+券面 → 400 拦截）
- [x] **C2 交互回归**：规格抽屉连续追加（按钮↔步进器切换、同规格合并/不同规格分行、减到 0 恢复按钮）；库存六档色阶展示；移动端草稿条
  - API 级已验：菜单含规格组/选项/可用库存/售罄态（22 分类/109 商品），抽屉报价链路（单行 preview）可用；❗UI 级交互（抽屉连续追加/色阶/移动端草稿条）需人工在浏览器验收
- [x] **C3 异常路径**：菜单接口失败、preview 超时、建单失败重试、双击提交幂等、售罄商品拦截
  - 实测全过：幂等双击同键返回同一订单 ✅；售罄拦截「商品【招牌水煮鱼】已售罄」✅（临时造数已恢复）；券面仅平台结算可填 400 ✅；dineIn 无桌台 400 ✅；platform+cash 400 ✅；缺幂等键 409 ✅（前端另有菜单失败重试/preview 失败禁提交建模）
- [x] **C4 权限确认**：路由守卫/子账号权限体系确认 manual-entry 页面访问控制正确
  - 实测：前端守卫链 canAccessScanOrdering+canUseScanOrdering ↔ 后端 scan-ordering:view/order-process + BusinessModeGuard('catering')；收银员子账号三接口正常访问；非餐饮业态账号 403「该功能仅适用于餐饮门店」✅
- 联调脚本：`scripts/manual-entry-e2e.mjs`（18/18 断言全过，D3 上线冒烟可复跑；测试账号：餐饮门店 37 owner 13619654040 / 密码 111111）

### 阶段 D：上线（⏸️ 搁置：生产服务器尚未采购，待就绪后启用）

> 现状：本地开发库已完成全部开发与联调验证；阶段 D 全部依赖生产环境，无服务器时不执行。
> 服务器就绪后的清单（保留备查）：

- [ ] **D1** 后端：如含 Prisma migration，确认部署流程会执行（`.github/workflows/deploy-production.yml`）；新增环境变量同步 `.env.example` 与生产配置（业务代码统一 ConfigService，禁 process.env）
- [ ] **D2** 前端：走既有 `.github/workflows/deploy.yml` CI/CD
- [ ] **D3** 上线后冒烟：生产环境重跑 C1 三条场景（`node scripts/manual-entry-e2e.mjs <生产地址>`）

> 本地使用方式（当前可随时跑）：
> - 后端：`purelyprofit-server` 目录 `pnpm start:dev`
> - 前端：`purelyProfit` 目录 `pnpm dev`，登录餐饮业态门店账号（联调账号 13619654040 / 111111）
> - 联调回归：`node scripts/manual-entry-e2e.mjs http://127.0.0.1:<后端端口>`

---

## 五、硬性规范速查（违反即任务失败）

**通用**：所有回答/注释用简体中文；导出函数显式类型；禁 any；async/await（禁 .then 链）。

**前端（purelyProfit）**：CSS Modules + Less 禁 inline style；动态类名必须 `cx()`；`map` 前必须 `isNonEmptyArray`；数字展示必须 `safeNum`（签名只收 number|null|undefined，不收 string）；key 用业务主键回退 fallbackKey；**金额前端严禁计算**（演示期代码已注释标记，接入后必须删除）；组件文件顶单行注释；interface 字段单行 JSDoc。

**后端（purelyprofit-server）**：controller 只做路由/参数/guard/swagger；新增接口先定义 DTO + class-validator + Swagger 注解；统一 PrismaService/RedisService/ConfigService；**金额唯一权威在后端**（严禁信任前端传入的金额，建单入参只传 productId/specOptionIds/quantity/券面金额，其余金额一律服务端重算）。

---

## 六、给新会话 AI 的开场指引

1. 先读本文档全文；
2. 再读两侧项目 `.qoder/rules/project-instructions.md` 与全局规范文件（见第五节路径）；
3. 从 **A0 现状探索** 开始，按第四节清单顺序推进，每完成一项勾选一项并跑对应质量门；
4. 涉及页面装配细节时，前端文件地图见 3.1，交互契约见 3.2，**勿破坏已确认的联动规则**；
5. 若发现本文档与代码实际不符，以代码为准并更新本文档。

*文档生成于第一阶段验收通过后（前端静态页全部完成、三道质量门绿、用户确认"前端确认了"）。*

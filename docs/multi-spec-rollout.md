# 商品多规格全链路改造（非餐饮门店）

> 适用仓库：`purelyprofit-server`（NestJS + Prisma）、`purelyProfit`（B 端 React）、`purelyClub`（C 端 Taro）
> 文档日期：2026-09-08
> 文中行号基于当前 `feat/scan-to-order` 分支，动手前请复核（代码可能已变动）

---

## 0. 一句话需求

非餐饮门店的商品支持多规格，并打通两条消费链路：

- **B 端**：`purelyProfit` → 空间管理 → 追加点单 → 可选规格
- **C 端**：`purelyClub` → 自助下单 `selfOrderingMenu` → 可选规格

---

## 1. 为什么要做

### 1.1 起因

非餐饮门店（如台球、棋牌、自助空间）的商家需要「可乐 大杯 / 小杯」「果盘 单人份 / 双人份」这类多规格商品。目前商品编辑页的规格配置区被 `isCateringStore` 硬挡住，非餐饮门店根本配不了规格。

### 1.2 关键认知：规格从来就没有两套

规格主数据**只有一份**，不存在「餐饮规格」和「非餐饮规格」之分：

- `Product`（`products` 表）**没有规格字段**
- 规格实体是 `ScanOrderingSpecGroup` / `ScanOrderingSpecOption`（`scan_ordering_spec_groups` / `scan_ordering_spec_options`）
- 挂在 `ScanOrderingMenuProduct`（`scan_ordering_menu_products`）上
- 商品与规格的关系：`Product → scanOrderingMenuProducts[0] → specGroups → options`

所以这次**不是新建一套规格，而是拆掉人为门禁 + 打通各链路的读取**。

### 1.3 为什么能低成本共用

| 层 | 现状 |
|---|---|
| 数据层 | 已共用一张表，零迁移（仅规格共用这一步） |
| 读取层 | `products.query.ts:30-33` 已无条件 include 规格；`products.mapper.ts:14-35` 的 `buildSpecGroups` 不区分业态 |
| B 端 UI | `useSpecConfig` / `SpecConfigSection` / `SpecGroupEditor` / `SpecOptionRow` **零餐饮耦合** |
| C 端 UI | `SpecSelectModal` / `SpecGroupSection` / `SpecSummaryBar` / `CartPopup` / `SelectedItems` **零餐饮耦合**，且已内置规格名渲染 |

真正制造「分开」的只有 4 个人的 `if` 判断。

---

## 2. 现状：代码事实

### 2.1 商品与门店

- 商品表 `products` **全业态共用一张表**，靠 `storeId` 区分门店
- 业态不在商品上，在门店上：`Store.businessMode`
- 商品 CRUD 接口**无业态限制**，只有「上架/下架到扫码点餐」这一个接口限制了：

```105:108:src/purely-profit/goods/products/products.controller.ts
@Patch(':id/scan-ordering-status')
@RequirePermissions('goods:update')
@RequireBusinessMode('catering')
@ApiOperation({ summary: '上架/下架到扫码点餐（仅餐饮门店）' })
```

- 业态门禁机制：`BusinessModeGuard` + `@RequireBusinessMode`（`stores/business-mode.guard.ts`）
- 能力矩阵：`store-business-capability.service.ts:161-180`（`canUseScanOrdering` / `canUseSelfOrdering` 等）

### 2.2 两条待改造链路

**追加点单（B 端）**

入口是 `OrderModal`（不是 `CheckoutModal`）。商品来自 `useProductManager` → `GET /products`。

```
SpaceCardActions / SessionActionRow
  → useSpaceOrderFlow.handleDirectOrder
  → OrderModal（购物车 Record<productId, qty>，一商品只能一行）
  → useSpaceManagement.sessionCrud.addItemsToSession
  → appendSessionItems → POST /space-sessions/:id/items
```

- `SessionItem`（`spaceManagement.session.types.ts:13`）无 spec 字段
- 后端 `SpaceSessionItem`（`prisma/purely-profit/operations/spaces.prisma:157-189`）无 spec 字段
- `lineTotal` 不是列，是 `salePrice × quantity` 派生（`space-sessions.mapper.ts:44`）

**自助下单（C 端）**

- 商品来源：`Product` 商品库（`club-self-ordering-menu.service.ts:74-93`）
- 菜单接口 `specGroups` **硬编码空数组**（`:107`）
- 建单 DTO 无 `specOptionIds`（`dto/create-self-order.dto.ts:21-38`）
- 购物车：本地 `selfOrderingCartStore`（服务端无购物车表，建单时才提交）
- 展示层复用扫码点餐组件：`CartBar` / `CartPopup` / `ProductList` / `SelectedItems` / `RemarkInput`

### 2.3 需要拆掉的门禁清单

| # | 层 | 位置 | 现状 |
|---|---|---|---|
| 1 | 后端写入 | `products-scan-ordering-sync.service.ts:20-27` | 非餐饮带 `specGroups` 直接 400 |
| 2 | B 端新建 UI | `productEntry.tsx:183-189` | `isCateringStore ? <SpecConfigSection/> : ...` |
| 3 | B 端新建提交 | `productEntry.tsx:110-113` | 非餐饮强制 `specGroups: undefined` |
| 4 | B 端列表编辑 | `productList.tsx:141` | `showSpecConfig={isCateringStore}` |

### 2.4 非餐饮配规格会产生「幽灵宿主」

`resolveMenuProduct`（`products-scan-ordering-sync.service.ts:217-244`）会**自动创建 `isActive: false` 的 `ScanOrderingMenuProduct`** 作为规格容器。它是幂等的（先 `findFirst` 后 `create`），不会重复创建。

安全边界已确认：
- `scanOrderingEnabled` 判定用 `isActive && deletedAt === null`（`products.mapper.ts:37-47`）→ 非餐饮恒 false，不会误显示扫码点餐开关
- 前端扫码点餐开关用 `canUseScanOrdering`（`useProductListPage.ts:263`）而非 `isCateringStore` → 非餐饮不显示
- 商品删除会调 `cleanup()` 软删宿主（`products.service.ts:309`）→ 不会留垃圾

---

## 3. 已确认的关键决策

| 决策项 | 结论 |
|---|---|
| 规格数据 | 共用现有 `ScanOrderingSpecGroup/Option`，不新建表 |
| 商品口径 | 继续用 `Product.id` 作为 `productId`，不切换到菜单商品 ID |
| 加价基准价 | 非餐饮两条链路统一用 **`Product.price`** 作基准；**餐饮扫码点餐不动**，仍用 `MenuProduct.basePrice`。两条链路互不干扰 |
| 规格级库存 | **不做**。非餐饮仍只扣 `Product.stock`，`SpecOption.stockQuantity` 忽略（恒返回 `null`）。菜单接口的**商品级**库存直取 `Product.stock` 并以 `finite` 下发，C 端据展示动态库存色（库存 0 由 C 端判售罄） |
| 前端报价接口 | **不新增**。前端本地算 `price + Σ priceDelta` 仅作展示，提交后以服务端权威价覆盖 |
| 价格权威性 | 服务端重算为准，前端传的 `salePrice` 仅作兜底（与现有约定一致） |
| 购物车 UI | purelyClub 继续保持「本地 store → 灌入 `cartStore` → 复用渲染组件」，不另起一套 |
| **行利润口径** | **`行 profit = 单价（含规格加价） − 成本价`**，即规格加价等额计入利润。理由：加价是纯毛利（大杯多收 2 元不加成本），不计入会让毛利率虚高；且与自助下单现有实现一致。代价：毛利率随顾客所选规格浮动 |

### 行利润口径的现状与落地（已决策，2026-09-09）

代码事实（已复核）——三条链路现在**三个口径**：

| 链路 | profit 来源 | 规格加价是否进 profit |
|---|---|---|
| 餐饮扫码点餐 | `ScanOrderItem` **无 profit 列**；转销售记录时写死 `profit: 0`（`scan-ordering-sale-order-bridge.service.ts:155`） | 营收含、利润恒 0（**整条链路未实现利润**） |
| 非餐饮·自助下单 | `SelfOrderItem` 无 profit 列，bridge 时算 `profit = salePrice − costPrice`（`club-self-ordering-session-bridge.service.ts:82`） | **已符合**，无需改动 |
| 非餐饮·追加点单 | 前端直传商品级 `profit: p.profit`（`OrderModal.tsx:195`），后端 `normalizeSessionItemsPayload` 原样落库 | **不符合**，Stage 2/3 服务端重算时顺手统一 |

落地动作：
- Stage 1 共享定价服务返回 `unitPriceCents` 之外，一并返回 `costPriceCents`
- Stage 2 追加点单后端改为**服务端重算** `profit = unitPrice − costPrice`，不再信任前端传值
- 餐饮侧**不动**（本次改造范围外，且它本来就是 0，不存在口径冲突）

### 待确认（阻塞 Stage 1）

1. ~~规格加价是否等额计入 `profit`？~~ → **已决策**，见上
2. 非餐饮门店规格数量上限是否沿用「5 组 / 每组 20 选项」？
   - **代码事实（已复核）**：5 组上限**前后端都有**——前端 `useSpecConfig.ts:62`/`:128`，后端 `product-request.dto.ts` 的 `@ArrayMaxSize(5)`（create/update 各一处）；**每组 20 选项只有前端**（`useSpecConfig.ts:80`/`:171`），后端 `validateSpecificationGroups` 不校验选项数量
   - 结论：前端组件零餐饮耦合，Stage 0 放开后**天然沿用，无需额外开发**；此项可从「阻塞」降级为「默认沿用」。若需防御 API 直调，另开小任务补后端上限校验
3. 门店业态从非餐饮切到餐饮时，幽灵宿主（isActive=false）如何处理？

---

## 4. 实施步骤

### 全局依赖

```
Stage 0  规格共用（拆门禁）        ← 可独立上线，零业务变化
   ▼
Stage 1  数据地基（migration + 共享规格定价服务）
   │
   ├──────────────┐
   ▼              ▼
Stage 2         Stage 4
追加点单·后端    自助下单·后端
   │              │
   ▼              ▼
Stage 3         Stage 5
追加点单·前端    自助下单·前端
```

---

### Stage 0　规格共用（拆门禁）

> **状态：已实现（未上线）**，2026-09-08 完成编码。下方原始行号已因改动而位移，
> 复核请以符号名为准：`ProductsScanOrderingSyncService.ensureCateringStore`（已删除）、
> `syncSpecifications`（空规格短路）、`findMenuProduct` / `createGhostMenuProduct`
> （由原 `resolveMenuProduct` 拆分）、`EditProductModal`（`showSpecConfig` 属性已移除）。

**目标**：让非餐饮门店能配置规格。不含业务功能变化，可独立上线观察。

**改动清单**（`purelyprofit-server`）

1. `products-scan-ordering-sync.service.ts:20-27` — `ensureCateringStore` 放开全业态
2. `products.service.ts:122-125`（create）、`:194-197`（update）— 去掉门禁调用
3. `products-scan-ordering-sync.service.ts:68-82` — **空规格短路**：`groups.length === 0` 时先查是否已有宿主，无则直接 return

**改动清单**（`purelyProfit`）

4. `productEntry.tsx:110-113` — 移除 `isCateringStore &&` 判断
5. `productEntry.tsx:183-189` — 规格区改为恒显示
6. `productList.tsx:141` — `showSpecConfig` 改为恒 true
7. `EditProductModal.tsx:193` — 改为 `specConfig.specGroups.length > 0 ? { specGroups } : {}`
8. DTO / 组件注释 — 「餐饮商品规格组」→「商品规格组」（`product-request.dto.ts:99-108`、`:192-201`、`EditProductModal.tsx:85`）

**⚠️ 注意第 3 和第 7 必须配套做**。当前 `syncSpecifications` 先建宿主、第 81 行才判断空数组，而 `EditProductModal.tsx:193` 在 `showSpecConfig` 为 true 时恒带 `specGroups`（哪怕是 `[]`）→ 非餐饮每次编辑商品都会生成一条幽灵记录 + 可能一条同名 `MenuCategory`。

**验收**

- [ ] 非餐饮账号商品编辑页出现规格配置区
- [ ] 配 2 组规格保存后重新打开能正确回显
- [ ] 编辑其他商品（不配规格）后，`scan_ordering_menu_products` **不新增记录**
- [ ] 非餐饮门店商品列表**不出现**扫码点餐开关
- [ ] 餐饮账号全流程回归通过（商品列表/录入/编辑/扫码点餐上架）

---

### Stage 1　数据地基

> **状态：已实现（未上线）**，2026-09-09 完成编码。
> 落地物：`ProductSpecPricingService`（`goods/products/product-spec-pricing.service.ts`，
> 已在 `ProductsModule` 注册并导出，供 Stage 2/4 注入）、
> 迁移 `20260909000000_add_multi_spec_support`。
> 已用 `prisma migrate diff --from-migrations` 验证：迁移与 schema **零差异**。

**目标**：抽出两条链路共用的「规格校验 + 权威定价」能力，完成落库结构改造。

**1.1 新建共享规格定价服务**

新建 `src/purely-profit/goods/products/product-spec-pricing.service.ts`：

```
输入：storeId, productId, specOptionIds[]
流程：
  1. 查 Product（storeId / isActive / deletedAt null）
  2. 取 scanOrderingMenuProducts[0]（deletedAt null，orderBy id asc）
  3. 校验：选项归属该商品、minSelect / maxSelect、isActive
  4. unitPrice = Product.price + Σ extraPrice（Money 值对象，分为单位）
  5. 返回 { unitPriceCents, specNames, specSignature, displayName }
```

可复用来源：
- 校验逻辑 → `club-scan-ordering-cart.service.ts:221-248` 的 `validateOptions`
- 单价口径 → `manual-entry-pricing.service.ts:194-200`
- `displayName`（「拿铁（大杯/热）」）→ `manual-entry-pricing.service.ts:211-213`

**1.2 Migration**

- `SpaceSessionItem` 加 `specSignature String?` + `specNames Json?`
- `SelfOrderItem` 加 `specSignature String?`
- 新建 `SelfOrderItemSpec`（照抄 `ScanOrderItemSpec`，`schema.prisma:248-258`）

**验收**：单测覆盖「无规格 / 单规格 / 多规格 / 选项越界 / minSelect 未满足 / 负加价」六种用例。

---

### Stage 2　追加点单 · 后端

> **状态：已实现（未上线）**，2026-09-09 完成编码。
> 关键落地决策（与原文有出入，以代码为准）：
> - 服务端权威定价放在 `SpaceSessionWriteService.priceAppendedItems`（私有方法），
>   而不是塞进 `normalizeSessionItemsPayload`——后者是纯函数，保持无副作用便于复用
> - **`productName` 落库的是 `displayName`**（如「可乐（大杯）」）。因此小票、会话详情、
>   结账账单等凡是读 `productName` 的地方**自动显示规格，无需再改**（原 3.3 大部分变成零改动）
> - 只对**数字型 productId** 走定价；`manual_` / `SYS_` 虚拟行沿用前端传值
> - 无规格行若商品不可定价（已删除/已下架）**回退前端传值**保持旧行为；
>   **带规格行一律抛错**，绝不静默丢规格

| 文件 | 改动 |
|---|---|
| `dto/space-session-items.request.dto.ts:16-54` | `SpaceSessionItemDto` 加 `specOptionIds?: number[]` |
| `space-session-payload.shared.ts:136-177` | `normalizeSessionItemsPayload` 接规格，调 Stage 1 定价服务重算 `salePrice` |
| `space-session-items.shared.ts:32-61` | ⚠️ **`mergeSessionItems` 合并键加 `specSignature`** |
| `space-session-write.service.ts:134-150` | 落库写 `specSignature` / `specNames` |
| `space-sessions.types.ts` / `space-sessions.mapper.ts` / `space-session-shared.response.dto.ts` | 类型与读写映射 |
| `space-print-data.service.ts:46-57` | 小票行名拼接规格（用 `displayName` 则自动生效） |

**验收**：同商品两个不同规格（同价）不会合并；响应体带 `specSignature`；小票显示规格。

---

### Stage 3　追加点单 · 前端（`purelyProfit`，工作量最大）

> **状态：已实现（未上线）**，2026-09-09 完成编码。
> 落地要点与原文差异（以代码为准）：
> - 购物车状态 `cartMap: Record<productId, qty>` → **`cartRows: Record<rowId, CartRow>`**，
>   rowId 复用 `manualEntry/useManualEntryDraft.ts` 的 `buildRowId`（无规格固定 `:plain` 后缀）
> - `useSpecSelection` 已**泛化**为接受 `SpecSelectionSource { id, specGroups }`（改的是共享文件，
>   manualEntry 侧参数类型放宽，行为不变）
> - 规格弹窗用 `SpaceSheetShell variant="full"`（z-index 1000）；**不能用 `drawer`**（z-index 400），
>   否则会被外层追加点单弹窗盖住
> - 有规格商品卡片**不显示步进器**（数量归购物车明细管），只显示「选规格」按钮 + 数量角标
> - ⚠️ **原文档遗漏**：`mapSessionItemRequest`（`spaceManagement.transforms.ts`）必须透传
>   `specOptionIds`，否则规格根本到不了后端——已补，连带 `SessionItemRequestDTO` /
>   `SessionItemResponseDTO` / `mapSessionItem` 都要带规格字段

**3.1 新建规格选择弹窗**

新建 `OrderModal/components/OrderSpecModal/`：

- 复用 `manualEntry/hooks/useSpecSelection.ts` 状态机（默认预选 / 单选互斥 / maxSelect / isComplete / summaryText）——泛型化后整个搬过来
- 复用 `buildRowId`（`useManualEntryDraft.ts:12`）作为购物车唯一键
- 复用 `SpecOptionGroups` 的 UI 结构与 `SpecDrawerFooter` 的「加入 ↔ 步进器」切换模式
- 外壳改用 `SpaceSheetShell`（`SpecDrawer` 的侧滑外壳不适合此弹窗）

**3.2 购物车改造**

| 文件 | 改动 |
|---|---|
| `OrderModal.tsx:81` | `cartMap: Record<productId, qty>` → `cartRows: Record<rowId, CartRow>`，含 `specOptionIds` / `specNames` / `unitPrice` |
| `OrderModal.tsx:133-180` | `addToCart` 分流：有规格 → 开弹窗；无规格 → 直接 +1 |
| `OrderProductCard.tsx` | 有规格商品「+」改「选规格」；角标显示该商品所有规格数量之和 |
| `OrderProductGrid.tsx` | 透传 `onOpenSpec` |
| `OrderCartBar.tsx` | 建议支持明细展开（同商品多规格分行） |
| `hooks/useSpaceManagement.local.session.ts:58-71` | ⚠️ 前端 `mergeSessionItems` 合并键同步加 `specSignature` |

**3.3 展示补齐（Stage 2 后大部分已自动生效）**

`SessionItemList.tsx:113`、`CheckoutBillCard.tsx`、`ReceiptItemsTable`、`SessionDetailModal.sections.tsx` —— 商品名后追加规格名。
**注意**：后端 `productName` 已是 `displayName`（含规格后缀），这些位置读 `productName` 即可自动显示规格，
**不要再拼一次**，否则会出现「可乐（大杯）（大杯）」。需要规格结构化数据时用响应里的 `specNames`。

**验收**：追加「可乐 大杯」+「可乐 小杯」，账单显示两行且金额不同；刷新后仍为两行（不被合并）。

---

### Stage 4　自助下单 · 后端

> **状态：已实现（未上线）**，2026-09-09 完成编码。
> 落地要点与原文差异（以代码为准）：
> - **`menuVersion` 格式变了**：`v{最大更新时间}` → **`v{最大更新时间}:{规格组数}:{规格选项数}`**。
>   只取时间戳不够——**删除规格不会改动任何 updatedAt**，前端缓存就不会失效；
>   计入数量才能覆盖新增/删除
> - **Stage 1 定价服务接口扩展**：新增 `categoryName` 与 `specOptions`（选项 ID/名/加价快照），
>   前者供订单行落分类快照，后者供 `self_order_item_specs` 落库
> - 建单不再自己查 `Product`，统一走 `ProductSpecPricingService`；
>   商品不可定价时仍抛出原文案「购物车中存在已下架商品，请刷新后重试」
> - `ClubSelfOrderingModule` 需 import `ProductsModule`

| 文件 | 改动 |
|---|---|
| `club-self-ordering-menu.service.ts:7-20` | DTO `specGroups: never[]` → 真类型 |
| 同上 `:74-93` | `product.findMany` 加 `include scanOrderingMenuProducts → specGroups → options` |
| 同上 `:95-108` | 映射填充 `specGroups` |
| 同上 `:148-151` | ⚠️ **`menuVersion` 计入规格 `updatedAt`**（否则前端 TTL 缓存不失效，表现为「改了规格不生效」） |
| `dto/create-self-order.dto.ts:21-38` | 加 `specOptionIds: number[]` |
| `club-self-ordering-order.service.ts:242-248` | ⚠️ 合并键 `productId` → `productId + specSignature` |
| 同上 `:125-133` | ⚠️ **幂等指纹纳入 `specOptionIds`** |
| 同上 `:234-295` / `:139-164` | 调 Stage 1 定价服务；落库 `specSignature` + `SelfOrderItemSpec` |
| `club-self-ordering-payment.service.ts:56-66` | `PayableOrder.items` 同步规格字段 |
| `club-self-ordering-session-bridge.service.ts:8-19` / `:74-90` | 快照带规格，`productName` 用 `displayName`，写入 `SpaceSessionItem` |

**验收**：同商品两规格下单生成两条 `SelfOrderItem`；相同幂等键但不同规格返回不同订单；空间账单明细带规格。

---

### Stage 5　自助下单 · 前端（`purelyClub`）

> **状态：已实现（未上线）**，2026-09-09 完成编码。
> 落地要点与原文差异（以代码为准）：
> - `useSpecSelection` 新增 **`useLocalPricing` 选项**，而不是直接把服务端报价分支改掉——
>   餐饮扫码点餐仍走 `quoteScanOrderingCartItem`，避免误伤；自助下单传 `true` 走本地算价。
>   这样 `totalPrice` 就不会恒为 null，「加入」按钮才能点（对应原文坑 #1）
> - `decreaseItem` **不是改成按 cartItemId，而是限定只匹配无规格行**
>   （`specOptionIds.length === 0`）。列表层步进器只出现在无规格商品上，
>   这样即便误调也不会减错规格行；规格行的增减一律走 `cartItemId`（新增 `removeByItemId`）
> - 新增 `buildSpecSnapshotByOptionIds`（`types/orderPkg.ts`）：由选项 ID 重建
>   `selections` / 含加价单价 / 规格哈希，供购物车与灌入 `cartStore` 共用
> - ⚠️ **原文档遗漏（会让 Stage 5 完全失效）**：菜单接口的规格选项**必须返回 `stockQuantity`**。
>   C 端 `menu/menu.mapper.ts` 用 `isActive && (stockQuantity === null || > 0)` 判定选项可选，
>   字段缺失时 `undefined` 会让**所有选项被判为售罄**，`hasRequiredSpecs` 返回 false，
>   「选规格」入口直接不出现。已按§3「不做规格级库存」补 `stockQuantity: null`

| 文件 | 改动 |
|---|---|
| `selfOrderingCartStore.ts` | 条目加 `specOptionIds` / `selections` / `unitPrice`；合并键改 rowKey；**`decreaseItem(productId)` 改按 cartItemId**（注意 `addItem:34` 与 `decreaseItem:51-60` **两处**都按 `product.id` 匹配，都要改） |
| `useSelfOrderingMenuPage.ts:118-127` | 灌入 `cartStore` 时传真实 `specSignature` / `specs` / 含加价的 `unitPriceAmount`（现为硬编码 `''` / `[]`） |
| `useSelfOrderingConfirmOrderPage.ts:111-114` | 提交加 `specOptionIds` |
| `selfOrderingMenu/index.tsx` | 挂载 `SpecSelectModal`；`ProductList` 透传 `onOpenSpec`（`ProductItem.tsx:44` 的 `hasRequiredSpecs` 可直接用） |
| `SpecSelectModal/hooks/useSpecSelection.ts:98-119` | ⚠️ 解耦 `useTableStore` + `quoteScanOrderingCartItem`，改为本地算单价 |

**零改动**：`CartPopup` / `CartBar` / `SelectedItems` / `RemarkInput` / `cartStore.setServerCart` —— 均已内置规格渲染。

**⚠️ 两个坑**

1. `SpecSelectModal.tsx:72` 有 `!specState.isComplete || specState.totalPrice === null` 的禁用判断，本地算价后必须保证 `totalPrice` 非 null，否则「加入」按钮永远点不动。**根因在 `useSpecSelection.ts:105-119`**：`!table` 时直接 `setTotalPrice(null)`，而自助下单无桌台会话（`useTableStore.tableInfo` 为空）→ 恒 null。解耦时必须**同时去掉 `table` 依赖**，只改调用点不够
2. `decreaseItem(productId)` 按商品 ID 减，多规格时会减错行

**验收**：C 端选规格加入购物车，已选弹窗与确认页都显示「大杯、冰」；支付成功后空间账单明细带规格。

---

## 5. 风险红线（必修，漏一处即数据错误）

| # | 风险 | 位置 | 后果 |
|---|---|---|---|
| 1 | 空规格保存误建宿主 | `syncSpecifications:73` | 数据膨胀，商家没配规格也生成记录 |
| 2 | 追加点单合并键 | `space-session-items.shared.ts:32-61` + 前端 `local.session.ts:62` | 同价不同规格被静默合并，规格丢失 |
| 3 | 自助下单合并键 | `club-self-ordering-order.service.ts:242-248` | 同上 |
| 4 | 幂等指纹不含规格 | `club-self-ordering-order.service.ts:125-133` | 同商品不同规格命中同一 key，**返回错误订单** |
| 5 | 规格 ID 变化导致退款库存丢失 | `syncSpecifications` 物理删除 + `scan-ordering-refund-stock-restore.service.ts:99-114` | 改规格后历史订单退款，规格库存**静默不恢复**（餐饮端既有问题，建议顺手修：加「无变更则不重建」判断） |
| 6 | `[0]` 取宿主可能取错 | `products.mapper.ts:17` | 一个商品挂多个菜单商品时，规格写到非预期宿主上 |

### 6 条状态（2026-09-10 复核）

| # | 状态 | 落点 |
|---|---|---|
| 1 | ✅ 已修 | `products-scan-ordering-sync.service.ts:67` 空规格短路 |
| 2 | ✅ 已修 | 后端 `space-session-items.shared.ts:46,54`；前端 `local.session.ts` 补齐 `价格 + sourceType + 规格键` |
| 3 | ✅ 已修 | `club-self-ordering-order.service.ts:23` `buildSelfOrderLineKey`，`:283` 使用 |
| 4 | ✅ 已修 | `club-self-ordering-order.service.ts:149` 指纹纳入 `specSignature` |
| 5 | ✅ 已修 | `products-scan-ordering-sync.service.ts:96` `hasSameSpecifications` 前置比较 |
| 6 | ✅ 已加固 | `findMenuProduct` 补 `orderBy: { id: 'asc' }`，与读侧 `[0]` 口径对齐 |

**#6 的准确结论**：这条**不是真实存在的数据错误风险**——数据库唯一索引
`uq_scan_ordering_menu_product_store_product_active`
`(store_id, product_id) WHERE (product_id IS NOT NULL AND deleted_at IS NULL)`
已经保证「同门店 + 同商品」最多只有一条未删除宿主，`[0]` 必然就是写侧那一条。
真正的缺陷是**读写两侧排序口径不一致**（读侧 `orderBy id asc`、写侧无 `orderBy`），
当前靠约束兜底，一旦约束放宽或出现历史脏数据就会分叉。已补 `orderBy` 做显式对齐。

> **#5 修复边界**：`hasSameSpecifications` 消除的是「内容没变却重建 ID」这一类漂移。
> 若商家**真的改了规格**（改名/改价/增删选项），选项 ID 仍会重建，
> 历史订单退款时按旧 `specOptionId` 恢复规格库存仍会落空 —— 这是固有边界
> （规格已变，新旧之间本来就没有对应关系），无法靠比较内容绕过。

> **#5 已修（2026-09-10）**：`syncSpecifications` 增加 `hasSameSpecifications` 前置比较，
> 内容完全一致时**直接跳过删除+重建**，避免选项 ID 无谓漂移。
> 只比内容不比 ID（新建选项 ID 是前端占位值，与库内数字 ID 天然不同）。
> 单测覆盖：内容一致不重建 / 加价变化重建 / 组数变化重建 / 选项名变化重建。
> 注：非餐饮不做规格级库存（§3 决策），因此该问题实际只影响餐饮端历史订单。

> **前端合并键已补齐（2026-09-10）**：后端 `mergeSessionItems` 的合并键是
> `productId + 价格分 + sourceType + 规格`（`space-session-items.shared.ts`），
> 前端 `local.session.ts` 原本只有 `productId` —— 已补齐后三者。
>
> ⚠️ 补的过程中发现一个更深的坑：**前端不能直接用 `specSignature` 做规格键**。
> 它是选项 ID 升序的 **sha256**，而本地新增行只有明文 `specOptionIds`，
> 两者格式不同会永远匹配不上 → 提交前本地一行、提交后服务端一行，被拆成两行。
> 最终改为统一用 **`specNames` 序列**做规格键（本地行与服务端行都带），
> 其次才回退到 `specSignature` / 选项 ID。
> 名称序列的唯一性由后端 `validateSpecificationGroups`（同组选项名不可重复）保证。

> **规格弹窗交互修正（2026-09-10）**：`OrderSpecModal` 初版把底部做成了
> 「步进器 + 加入购物车」并存，与 `manual-entry` 规格抽屉的交互不一致。
> 已对齐 `SpecDrawerFooter` 的「**加入 ↔ 步进器**」切换模式：
> - 弹窗内**不维护独立数量态**，数量直接来自购物车匹配行（`resolveRow`）；
> - 当前组合未加购 → 显示「加入购物车」（未选齐禁用）；
> - 已加购 → 切换为步进器（`- 数量 +`，减至 0 上层移除该行 → 回到「加入购物车」态）；
> - 切换规格选项 → 匹配行随之变化，两种状态自动切换。

---

## 6. 灰度、基线、回滚

- **改前基线** ✅ **已生成**（2026-09-10）：`scripts/data/ghost-baseline-20260910.json`（4 家门店：宿主 110 / 幽灵 1 / 规格组 15 / 规格项 45）。
  统计各门店 `scan_ordering_menu_products` / `scan_ordering_spec_groups` 数量，改后对比，及时发现异常膨胀
  - 已备脚本 `scripts/check-ghost-menu-products.mjs`（只读，可直接连库跑）：
    ```bash
    node scripts/check-ghost-menu-products.mjs --save baseline.json   # 上线前存基线
    node scripts/check-ghost-menu-products.mjs --diff baseline.json    # 回归对比，幽灵宿主增加则 exit 1
    node scripts/check-ghost-menu-products.mjs --list-ghosts           # 列幽灵宿主明细
    ```
  - 幽灵宿主判定：`deletedAt = null AND isActive = false AND productId != null`
  - ⚠️ 餐饮门店的 `isActive=false` 可能来自正常「下架扫码点餐」（`disable()`），脚本会打印业态供人工区分
- **灰度** ⏳ **待运营执行**：建议先 1-2 家非餐饮门店，观察一周菜单与订单数据。
  代码侧**没有灰度开关**——本次是「放开既有能力」而非新增入口，无法按门店开关；
  若要控制暴露面，只能先在少量门店录入规格并观察，属上线策略而非开发项
- **回滚预案**：Stage 0 上线后幽灵记录已生成，回滚代码不会删除数据。
  清理脚本 `scripts/cleanup-ghost-menu-products.mjs`（**默认 dry-run**，必须显式 `--apply`）：
  ```bash
  node scripts/cleanup-ghost-menu-products.mjs                    # 预演
  node scripts/cleanup-ghost-menu-products.mjs --apply             # 软删宿主 + 物理删规格
  node scripts/cleanup-ghost-menu-products.mjs --apply --hard      # 连宿主一起物理删
  ```
  默认跳过**餐饮门店**（`isActive=false` 多为正常下架）与**带规格的宿主**，
  可用 `--include-catering` / `--with-specs` 放开；`--store <id>` 限定门店
  - ✅ **已实测**（2026-09-10，全程 dry-run 未写库）：
    默认正确跳过带规格的宿主（提示「带规格跳过（加 --with-specs 强制处理）」）；
    `--with-specs` 正确列出该条并提示「这是预演，未写库」
- **测试需更新**：~~`products.scan-ordering-status.spec.ts`、`products.service.spec.ts`、`club-self-ordering-{menu,order,session-bridge,payment,service}.spec.ts`~~ → **已完成（2026-09-10）**
  - `products.query.spec.ts` / `products.mapper.spec.ts`：期望快照过时（缺 `scanOrderingMenuProducts` / `scanOrderingEnabled` / `specGroups`）。
    `products.query.ts` 已导出 `productSelect`，单测直接引用，**以后加字段不会再过时**
  - `products.service.spec.ts` / `products.scan-ordering-status.spec.ts`：缺 `ProductsScanOrderingSyncService` provider。
    前者用 mock（测编排），后者用**真实服务**（它断言的就是扫码菜单的写入行为）
  - 顺手修掉两个既有的空间模块失败：`space-session-transfer.service.spec.ts`（服务已改用 `findFirst` 查会话，
    spec 仍只 mock `findUnique`）、`spaces-write.service.spec.ts`（transaction mock 缺 `spaceQrCode`）
  - 结果：`goods/products` + `operations/spaces` + `self-ordering` 三模块 **29 suites / 218 tests 全绿**
  - `useSpecConfig` 已补独立单测（22 例，2026-09-10）：覆盖组/选项增删改、5 组与 20 项上限、
    模式联动（切 single 强制 maxSelect=1 并只留首个默认）、`setGroups` 归一化（防历史脏值回写）、
    以及 7 条校验规则

---

## 7. 闭环验收清单

**Stage 0**
- [x] 非餐饮商品编辑页可配置规格并正确回显（2026-09-09 人工验证）
- [x] 非餐饮门店商品列表不出现扫码点餐开关（2026-09-09 人工验证）
- [x] 不配规格的商品编辑后无幽灵记录产生（**2026-09-10 实测**：非餐饮门店 store 43 创建商品
  → 分别以「不带 specGroups」（前端真实行为）与「`specGroups: []`」（防御性）编辑 →
  `check-ghost-menu-products.mjs --diff` 与基线完全一致，宿主 0 新增；另有单测覆盖空规格短路）
- [x] 餐饮账号全功能回归通过（**2026-09-10 浏览器实测**，账号 13619654040 / 门店 37）：
  - [x] 首页能力矩阵正确：**有「扫码点餐」、无「空间管理」**（与非餐饮互为对照）
  - [x] 商品列表正常，且**仍显示「扫码点餐」上架开关**（按钮为「将扫码点餐下架」= 已上架态）
  - [x] 编辑商品：规格区正常回显（`1 个规格组 · 1 个选项`）
  - [x] 商品录入：规格配置区仍在
  - [x] 扫码点餐主页正常（接单 / 桌台 / 手动录入订单 + 统计区）

**Stage 1**
- [x] 共享定价服务覆盖 6 种用例（无规格 / 单规格 / 多规格 / 选项越界 / minSelect 未满足 / 负加价），另加「商品不存在」「选项顺序不影响签名」，共 8 例全通过
- [x] 迁移与 schema 零差异（`prisma migrate diff` 验证）
- [x] 迁移已在本地开发库执行（`prisma migrate deploy`，2026-09-09 21:07）并验证列/表已建；
  上线环境仍需走各自部署流程

**追加点单 · 后端（Stage 2）**
- [x] 同商品两个不同规格（同价）不合并（单测覆盖）
- [x] 落库写 `specSignature` / `specNames`，响应体带这两个字段
- [x] 服务端权威定价覆盖前端 `salePrice` / `profit`（单测用错误前端值验证被覆盖）
- [x] 虚拟行（`manual_` / `SYS_`）行为不变
- [x] 小票自动显示规格（`productName` = `displayName`，无需改打印服务）
- [x] 联调：真实门店追加带规格商品，服务端把前端传的 1 元重算为 198 元，
  落库 displayName / specSignature / specNames，利润 165 = 198 − 成本（2026-09-09）

**追加点单 · 前端（Stage 3）**
- [x] 有规格商品卡片显示「选规格」并弹出规格选择层，无规格商品行为不变（单测覆盖）
- [x] 同商品不同规格各自成行、相同规格合并数量（单测覆盖）
- [x] 前端本地 `mergeSessionItems` 合并键加规格（`buildItemSpecKey` 以 `specNames` 序列为主键：`specSignature` 是 sha256，与本地明文 ID 格式不同，不能直接用）
- [x] **浏览器实测（2026-09-10，非餐饮门店 store 42，账号 13619654022）**：
  - [x] 有规格商品卡片显示「选规格」，无规格商品仍为「加入商品」按钮（行为不变）
  - [x] 点「选规格」弹出规格选择层，两组必选规格完整展示（含加价 `+¥66.00` / `+¥55.00` / `+¥77.00`）
  - [x] 未选齐时「加入购物车」为 disabled，选齐后解禁
  - [x] 弹窗内单价与后端权威价一致：`¥198.00 = 77+66+55`、`¥220.00 = 77+66+77`
  - [x] 购物车**分两行**显示且规格名正确：`团购的功夫、53` / `团购的功夫、不放过`，合计 `¥418.00`
  - [x] 提交后落库两行**未被合并**：`19800×2` 与 `22000×1`，各自 `spec_signature` / `spec_names` 正确
  - [x] `profit` 由服务端按「单价(含加价) − 成本」重算：`18700 = 22000 − 3300`
  - [x] 会话详情「消费明细」显示规格名（`productName` = displayName）
- [ ] 结账账单 / 小票显示规格名（与小票共用 `productName` 来源，未单独实机点验）

**自助下单 · 后端（Stage 4）**
- [x] 菜单返回真实 `specGroups`（含选项加价、min/max、isActive）
- [x] `menuVersion` 计入规格更新时间与数量，改规格能触发前端缓存失效
- [x] 同商品两规格下单生成两条 `SelfOrderItem`（合并键含规格）
- [x] 幂等指纹纳入 `specSignature`：同商品不同规格指纹不同
- [x] 落库 `specSignature` + `self_order_item_specs` 规格快照
- [x] 空间账单明细写入 `specSignature` / `specNames`（`productName` 为含规格的展示名）
- [x] 联调：菜单接口返回真实规格（`menuVersion` 新格式 `v…:2:3`）；
  同商品两规格建单生成两行、单价分别 19800 / 22000 分、规格快照落库（2026-09-09）
- [x] 支付成功后空间账单明细带规格（**2026-09-10 实测**：开发态 `confirm-paid` →
  账单写入 `member_self_order` 行，`productName` 为 displayName、`spec_signature` 有值、
  `spec_names: ["团购的功夫","53"]`、`profit: 16500 = 19800 − 3300 成本`）

**自助下单 · 前端（Stage 5）**
- [x] 菜单返回 `specGroups`，有规格商品显示「选规格」（含 `stockQuantity: null` 修正）
- [x] 规格弹窗挂载 + 本地算价（`useLocalPricing`），「加入」按钮可用
- [x] 购物车条目带 `specOptionIds` / `selections` / 含加价 `unitPrice`，同商品不同规格各自成行
- [x] `decreaseItem` 不会减错规格行；规格行按 `cartItemId` 增减
- [x] 灌入 `cartStore` 时传真实 `specSignature` / `specs` / 含加价单价（原为硬编码 `''` / `[]`）
- [x] 提交建单带 `specOptionIds`
- [x] 相同商品不同规格重复提交不会命中错误幂等（单测：幂等指纹纳入 `specSignature`，两规格指纹不同）
- [x] 支付成功后空间账单明细带规格（2026-09-10 实测，详见 Stage 4）
- [x] 修改规格后 C 端刷新能拿到最新（单测覆盖 `menuVersion` 计入规格组数/选项数与规格 `updatedAt`）
- [ ] 联调：C 端选规格加入购物车，已选弹窗与确认页都显示规格名（需前端实机验证）

**全局**
- [x] 餐饮门店扫码点餐链路完全不受影响（**2026-09-10 浏览器实测**）：
  - [x] 手动录入订单页：7 个带规格商品均显示「选规格」
  - [x] 规格抽屉正常：辣度（不辣/微辣/中辣/特辣）+ 加料（加鱼丸 `+¥3.00` 等），
        默认预选生效（`已选：不辣`），**服务端报价 `¥88.00` 正常**（餐饮仍走
        `quoteScanOrderingCartItem`，未被 Stage 5 的 `useLocalPricing` 影响）
  - ⚠️ 这一项是 Stage 3 泛化 `useSpecSelection` 后最关键的回归点，已验证通过
- [x] 销售记录（餐饮）、员工交班页面正常打开
- [ ] C 端商品展示回归（需 `purelyClub` 环境，本次未提供）

**收尾补做（2026-09-10）**
- [x] 风险 #5：`syncSpecifications` 加「无变更则不重建」，避免选项 ID 漂移导致退款库存丢失
- [x] 前端合并键补齐 `价格` / `sourceType` / `规格` 三个条件，与后端完全对齐；
  规格键改用 `specNames` 序列（`specSignature` 是 sha256，与本地明文 ID 格式不同，不能直接用）
- [x] 修掉 `goods/products` 4 个 spec（31 个失败）与 2 个空间模块 spec；三模块 218 个测试全绿
- [x] `products.query.ts` 导出 `productSelect`，单测直接引用，避免期望快照再次过时
- [x] `useSpecConfig` 补 22 例单测（原为零覆盖）；purelyProfit 商品模块 46 files / 473 tests 全绿

---

## 8. 关键文件索引

### purelyprofit-server

```
goods/products/
  products.service.ts                        (门禁调用 :122-125 / :194-197)
  products-scan-ordering-sync.service.ts     (ensureCateringStore :20-27, syncSpecifications :68-112, resolveMenuProduct :217-244, cleanup :184)
  products.mapper.ts                         (buildSpecGroups :14-35, hasActiveScanOrderingMenuProduct :37-47)
  products.query.ts                          (include 规格 :30-33)
  product-spec-pricing.service.ts            (共享定价 price(), 校验 resolveSelected/ensureRange, 签名 hashSpecSignature)

operations/spaces/
  space-sessions.controller.ts               (:202 POST :id/items)
  space-session-write.service.ts             (addItemsToSession :32-221)
  space-session-items.shared.ts              (mergeSessionItems :32-61) ⚠️
  space-session-payload.shared.ts            (normalizeSessionItemsPayload :136-177)
  space-print-data.service.ts                (SpacePrintItem :46-57)

purely-club/self-ordering/
  club-self-ordering-menu.service.ts         (DTO :7-20, 查询 :74-93, 映射 :95-108, menuVersion :148-151)
  club-self-ordering-order.service.ts        (幂等指纹 :125-133 ⚠️, priceItems :234-295, 合并 :242-248 ⚠️)
  club-self-ordering-session-bridge.service.ts (快照 :8-19, 写入 :74-90)
  dto/create-self-order.dto.ts               (:21-38)

参考实现（可复用逻辑）
  purely-club/scan-ordering/club-scan-ordering-cart.service.ts        (validateOptions :221-248)
  purely-club/scan-ordering/club-scan-ordering-cart-pricing.service.ts (单价 :97-103)
  operations/scan-ordering/manual-entry/manual-entry-pricing.service.ts (priceItem :147-219, displayName :211-213)
```

### purelyProfit

```
pages/main/goods/
  goods.service.mapper.ts                    (specGroups 映射 :48-62)
  productEntry/productEntry.tsx              (门禁 :110-113, :183-189)
  productEntry/hooks/useSpecConfig.ts        (规格状态机，零餐饮耦合)
  productEntry/components/SpecConfigSection/ (规格配置 UI)
  productList/productList.tsx                (门禁 :141)
  productList/components/EditProductModal/   (提交 :193)

pages/main/operations/spaceManagement/
  components/OrderModal/OrderModal.tsx       (购物车 :81, 加购 :133-180)
  components/OrderModal/components/OrderProductCard/  (卡片)
  components/OrderModal/components/OrderCartBar/
  hooks/useSpaceManagement.local.session.ts  (mergeSessionItems :58-71) ⚠️
  spaceManagement.dto.ts / .transforms.ts / .response-mappers.ts / .utils.ts

复用源（规格交互）
  pages/main/operations/scanOrdering/manualEntry/
    hooks/useSpecSelection.ts                (状态机，可直接搬)
    hooks/useManualEntryDraft.ts             (buildRowId :12)
    hooks/useSpecUnitPrice.ts                (报价防抖模式)
    components/SpecDrawer/                   (三层结构，外壳需替换)
    components/SpecOptionGroups/             (纯展示，可直接用)
```

### purelyClub

```
pages/orderPkg/selfOrderingMenu/
  index.tsx                                  (无规格弹窗，需挂载)
  hooks/useSelfOrderingMenuPage.ts           (灌入 cartStore :112-131)
pages/orderPkg/selfOrderingConfirmOrder/
  hooks/useSelfOrderingConfirmOrderPage.ts   (提交 :108-118)
stores/selfOrderingCartStore.ts              (需加规格维度)
stores/cartStore.ts                          (setServerCart :58-110，已有规格反查，零改动)
pages/orderPkg/components/SpecSelectModal/   (复用，需解耦 :98-119)
pages/orderPkg/components/CartPopup/         (已内置规格渲染 :24-26，零改动)
pages/orderPkg/confirmOrder/components/SelectedItems/  (已内置 :25-27，零改动)
```

---

## 9. 补充：销售记录 / 交班页的非餐饮规格展示（2026-09-10）

**需求**：非餐饮账号在 `sales-record` 与 `handover-management` 中，规格商品要显示与餐饮账号一致的
「规格」tag（含 color）与换行规格内容。

**根因**：两个页面的规格数据都是**扫码点餐专属**——
- sales-record：`queryScanOrderingDetails` 按 `scanOrderId` 回源 `scan_order_item_specs`
- handover：`buildScanItemSpecsList(order.scanOrder)`，注释明确「非扫码订单返回空列表」

非扫码订单（空间会话结账：自助下单 / 追加点单）没有 `scanOrder` 关联，因此永远无 spec。

**实现**（对齐餐饮「查询时回源单据」的模式，前端零改动）：

| 侧 | 改动 |
|---|---|
| sales-record | 新增 `querySpaceSessionSpecDetails`（按 `saleOrderId` 查会话商品行）+ `buildSpaceSessionSpecsEnrichment`（行级对齐）；`buildVisibleSalesRecordRows` / `mapSalesRecordResponse` 的增强参数放宽为最小形状 `SalesRecordSpecsEnrichment`（只依赖 `specsRows`，避免误带 `amountSummary` 导致前端渲染扫码优惠区） |
| handover | `SALE_ORDER_ITEM_SELECT` 的 `spaceSession` 加 `sessionItems { productName, specNames }`；新增 `buildSpaceItemSpecsList`，`aggregateRegularOrderItems` 在扫码序列为空时回退 |

**过程中发现并修复的两个真实 bug**（都属于 Stage 2 的遗漏）：

1. **结账会重写 `spaceSessionItems` 并丢掉规格** ——
   `space-session-settlement.service.ts` 的 `deleteMany + createMany` 没带
   `specSignature` / `specNames`，导致「追加点单写入的规格在结账后消失」。
   ⚠️ 生产代码里只有两处重建点（追加点单、结账），**两处都必须带规格字段**。
2. **map key 用错主键** —— `spaceSessionSpecMap` 的 key 必须是 `SaleOrder.id`
   （会话侧外键），写成 `spaceSession.id` 会永远匹配不到。

**验证**（真实接口）：
```
GET /api/sales-record      → v调查大师 | specs: ["团购的功夫","53"]
GET /api/handover/page     → A09 · v调查大师 hasSpec: true
```

**打印 / CSV 导出的商品行（2026-09-10 补充）**

非餐饮的商品列原先用「；」拼成一行（`A×1；B×1；…`），与餐饮的「每商品一行 + 规格弱化行」不一致。
两条链路完全隔离（**餐饮**走前端生成 CSV + `salesRecordCateringPrint`；
**非餐饮**走后端流式 CSV + `salesRecordPrint`），因此本次**只改非餐饮侧，餐饮文件零改动**：

| 侧 | 改动 |
|---|---|
| 打印 `salesRecordPrint.tsx` | 新增 `OrderItemsCell`（每商品一行 + 规格另起一行弱化）；列头「商品」→「商品（规格）」；`salesRecordPrint.module.less` 补同名同值样式类 |
| CSV `sales-record-report.service.ts` | `CSV_HEADERS` 的「商品名称」→「商品（规格）」；`buildCsvRowFromOrder` 增加 `specsRows` 参数；新增私有 `resolveSpecsRowsMap` 批量回源 |

⚠️ CSV 的两个坑：
1. 规格必须按 **`order.items` 原始索引**取值 —— `visibleItems` 已过滤抵扣行，直接用它的下标会错位；
2. `resolveSpecsRowsMap` 的 map key 必须是 `SaleOrder.id`（见上文 bug 2）。

实测：
```
CSV 列头：订单号,商品（规格）,数量(件),营业额(元),…
CSV 数据：音钵疗愈×1（45分钟、标准）；香薰精油按摩×1（薰衣草、60分钟）；鼻腔SPA×1（基础）；…
打印 DOM：列头「订单号/商品（规格）/件数/…」，52 个商品行 + 13 个规格行
```

**抵扣行的规格展示修复（2026-09-10）**

用户反馈：销售记录里「商品行」显示规格（tag + 换行），而「自助下单抵扣」行把规格内嵌在名字里
（`深层清洁护理（60分钟） · 自助下单抵扣`），信息重复。

修法（数据层，`space-session-settlement.shared.ts` 抵扣行构造）：
- 商品名**剥掉规格后缀**（仅在有 specNames 时，避免误删商品名自带的括号）
  → `深层清洁护理 · 自助下单抵扣`
- 规格由 `specNames` / `specSignature` 单独承载 → 与商品行同口径（tag + 换行）

单测：`space-session-settlement.shared.spec.ts` 补 2 例（带规格剥后缀 / 名字自带括号不误删），28/28 通过。

**去重：同一笔消费不再「商品行 + 抵扣行」两行展示（2026-09-10）**

修复后销售记录会出现「商品行 + 抵扣行」**重复两行**（同一笔自助下单消费 ¥198 显示两次）。
用户要求：**只显示带「自助下单抵扣」的行**。

实现（`sales-record-item-aggregation.ts` 新增 `listVisibleSaleOrderItems` +
`isSelfOrderDeductionRow`，`buildVisibleSalesRecordRows` 与 CSV `buildCsvRowFromOrder` 共用）：
- 抵扣行保留展示（规格 tag + 换行）
- **对应的自助下单商品行排除**（识别规则见下）

⚠️ **抵扣行的识别只能按名字后缀**（` · 自助下单抵扣` 结尾），不能按 productId——
`SYS_SELF_ORDER_DEDUCTION` 非数字，写入 `sale_order_items.product_id`（Int 列）时实际存的是 **null**。
（`isSelfOrderDeductionRow` 导出供报表/导出等场景复用。）

端到端实测（会话 139 结账后）：
```
GET /api/sales-record（#20260910-012）：
  · A04 台位费（固定）| specs: undefined
  · 经典中式推拿 · 自助下单抵扣 | ["90分钟","普通技师"]
  · 经典中式推拿 · 自助下单抵扣 | ["30分钟","普通技师"]
  · 经典中式推拿 · 自助下单抵扣 | ["60分钟","普通技师"]
  · 经典中式推拿 · 自助下单抵扣 | ["60分钟","高级技师"]
  · 泰式古法按摩 · 自助下单抵扣 | ["60分钟"]    …共 8 行抵扣，原商品行全部消失
CSV 商品列：经典中式推拿 · 自助下单抵扣×1（90分钟、普通技师）；…
```

端到端验证（真实 API 全链路：开台 → C 端自助下单（带规格）→ 支付 → 结账）：
```
space_session_items：
  · v调查大师（团购的功夫/不放过）  | ["团购的功夫","不放过"]   ← 商品行
  · v调查大师 · 自助下单抵扣        | ["团购的功夫","不放过"]   ← 抵扣行（新格式）
GET /api/sales-record：
  · v调查大师 | specs: ["团购的功夫","不放过"]
  · v调查大师 · 自助下单抵扣 | specs: ["团购的功夫","不放过"]
```
注意：**历史结账的抵扣行仍是旧格式**（名字内嵌规格、无 specNames），
只有本次修复之后新结账的会话才是新格式。

**抵扣后缀单独染色（2026-09-10）**

「 · 自助下单抵扣」后缀（6 字）在明细中以绿色（`#15803d`，语义=已在线支付）单独展示，商品名保持原色。

实现：`salesOrderItem.utils.ts` 新增 `splitSelfOrderDeductionName`（拆出 [基础名, 后缀]）与
`SELF_ORDER_DEDUCTION_COLOR`；渲染点 5 处：
销售记录展开区（`OrderExpandArea`）、结账弹窗（`CheckoutBillCard`）、会话详情（`SessionItemList`）、
非餐饮打印（`salesRecordPrint`）；餐饮打印同构组件未改（无抵扣行，helper 返回 null 无影响）。

范围说明：
- 小票（spaceManagement `ReceiptPrintView`）未做（utils 在 salesRecord 模块，跨模块引用留待需要时补）
- CSV 为纯文本，无法染色
- spaceManagement 侧的拆分逻辑重复定义在 `spaceManagement.constants.ts`（`splitSelfOrderDeductionName`），
  与 salesRecord 侧各自独立（避免跨模块引用）

**打印分页留白修复（2026-09-10）**

非餐饮打印在「单行商品极多」时出现大片空白：第 1 页只剩统计汇总，订单明细被整体推到下一页。

实测（真实 DOM）：
```
首行高 516px（15 个商品行）· 单个商品行 18px · 行间 gap 2px · td padding 8px
```
两边 less 的渲染与分页属性**逐项一致**（gap / padding / line-height / break-inside），
差异只来自**数据量**：非餐饮订单商品多 → 单行超高 → `tr { break-inside: avoid }`
在当前页放不下时把整行推到下一页。

改法（仅非餐饮 `salesRecordPrint.module.less` 的 `@media print` 内）：

| 规则 | 作用 |
|---|---|
| `tr { break-inside: auto }` | 允许表格行跨页，超长行不再被整体推走 |
| `.printItemLine { break-inside: avoid }` | 切分点收敛到「商品行之间」，不会把单个商品切成两半 |

⚠️ **验证限制**：`agent-browser` 生成的 PDF 不遵循 print media（改动前后 PDF 逐字节相同），
分页效果需**人工在浏览器打印预览中确认**。
⚠️ 该改动使非餐饮与餐饮的 `break-inside` 取值不同（餐饮仍为 `avoid`）——
若要求两边 CSS 完全一致，需同步修改餐饮侧（1 行）。

**交班页自助下单抵扣行改为「自助」tag（2026-09-10）**

`handover-management` 的商品名原先整串展示 `A04 · 泰式古法按摩 · 自助下单抵扣`，
长名被截断成「… · 自助下…」。已改为：剥离「 · 自助下单抵扣」后缀（与销售记录同口径），
改由「自助」tag 承载；与「规格」tag 同排展示，标签间距与「名字↔标签」间距统一 **0.4rem**
（`OrderListSection.module.less` 新增 `.productTags`）。

实测（真实浏览器）：名字 `A04 · 泰式古法按摩`、标签 `["自助","规格"]`、`gap: 4px`。

**券面金额展示口径修正 + 实付金额行（2026-09-10）**

`OrderExpandArea` 的「券面金额」行原先只判断 `voucherFaceAmount > 0`，导致**开台预付券面**
（非团购渠道，如 alipay + 预付券 ¥87，数据来自 `space_sessions.prepaid_voucher_face_amount`
结账时复制）的订单也展示该 label。已加团购券支付校验（`groupon_voucher`）；
同时 meta 卡新增「实付金额」行（普通订单展示到店实收净额 `resolvePayableAmount`，
扫码订单已有「实付金额」合计行不重复展示）。

**修复：结账 / 详情弹窗 React key 重复（2026-09-10）**

同一商品多规格后，结账明细（`CheckoutBillCard`）、会话详情（`SessionItemList`）、
小票（`ReceiptItemsTable`）三处列表都用 `productId` 作 key，
同一商品的多规格行会触发 `Encountered two children with the same key`。

已改为 `productId-行下标` 组合键（3 处）。
⚠️ 顺带修复：`OrderModal.resolveRow` 里 `buildRowId` 误传 `number[]`（应先 `map(String)`）——
ID 位数不一致时数字排序与字符串排序结果不同，会导致规格行匹配失败。

---

## 10. 工作量参考

| Stage | 人天 |
|---|---|
| 0 规格共用 | 0.5 |
| 1 数据地基 | 1 |
| 2 追加点单·后端 | 1.5 |
| 3 追加点单·前端 | 2.5 |
| 4 自助下单·后端 | 2 |
| 5 自助下单·前端 | 2 |
| **合计** | **约 9.5 天**（不含联调与测试打磨） |

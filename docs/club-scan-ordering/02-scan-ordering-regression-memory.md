# Scan Ordering 跨窗口回归备忘

> 用途：后续开发商家端 `scan-ordering` 今日营业额、今日订单、实时更新、状态/类型筛选前，必须先阅读本文。本文记录本轮已踩到的会话、订单归属、退款实时性与展示聚合边界，避免“修一个页面、订单从另一个页面消失”的回归。

## 1. 系统与接口边界

| 端 | 代码库 | 主要职责 |
| --- | --- | --- |
| 商家端 | `purelyProfit` | 扫码点餐运营面板、接单、拒单、桌台、统计与筛选 |
| 消费者端 | `purelyClub` | 扫码、点餐、支付、订单详情、我的订单、点餐记录 |
| 服务端 | `purelyprofit-server` | `ScanOrdering*` 数据模型、状态机、退款、实时事件与聚合查询 |

- 商家端 API 前缀：`/api/profit/scan-ordering`。
- 消费者端 API 前缀：`/api/club/scan-ordering`。
- 金额数据库与 API 原始值统一为**分**；前端显示时再格式化为元。
- 服务端订单、桌台、会话为唯一事实来源；前端不能自行推导订单终态或退款时间。

## 2. 关键模型与状态

### 2.1 会话 `ScanOrderingSession`

| 状态 | 真实语义 | 重要限制 |
| --- | --- | --- |
| `active` | 当前可继续点餐的有效会话 | 必须同时满足 `deletedAt = null` 与 `expiresAt > now` 才是有效 active |
| `left` | 用户离开页面/重新扫码后的旧会话 | **不表示订单履约结束**；不能直接视为历史终态 |
| `checked_out` | 商家清桌后归档 | 历史记录 |
| `expired` | 会话过期 | 历史记录 |

同一用户、同一桌台在复杂流程中可能同时有 `active` 和 `left` 会话。尤其是退款后继续点餐，旧订单与新订单可能落在不同会话。

### 2.2 订单状态

| 状态 | 说明 |
| --- | --- |
| `pending_payment` | 待支付，默认不计入已支付履约订单 |
| `pending_acceptance` | 已支付、商家待接单，属于进行中，必须可见且阻塞清桌 |
| `preparing` | 制作中，属于进行中，必须可见且阻塞清桌 |
| `served` | 已出餐/用餐中；在清桌前仍属于当前桌台范围 |
| `refunding` | 退款中，不能显示为“订单已结束” |
| `rejected` + `paymentStatus=refunded` | 已退款；不参与桌台履约、可显示退款结果 |
| `cancelled` | 已取消，终态 |
| `completed` | 已完成，终态 |

**严禁将“订单已结束”作为未知状态的业务结论。** 此文案过去只是前端兜底，曾掩盖 `pending_acceptance` 误进历史的问题。

## 3. 已确认的展示口径

### 3.1 商家桌台

- 存在有效 `active` 会话才可认为桌台属于当前用餐轮次。
- 只有历史 `left` 会话时，桌台必须显示为空桌：订单数 `0`、人数 `0`、不展示旧订单、不可清桌。
- 同桌有有效 `active` 会话时，才可将该桌 `left` 会话的本轮订单合并到桌台履约范围。
- 清桌必须先有有效 `active` 会话作为当前轮次锚点，随后再归档同桌关联的 `active + left` 会话。
- `pending_acceptance`、`preparing` 等未履约订单必须阻塞清桌；`rejected + refunded` 不阻塞。
- 桌台人数不是 `session.guestCount` 累加，而是**当前桌台可展示订单的 `ScanOrders.guestCount` 累加**。这是订单创建时的人数快照。

### 3.2 C 端“我的订单”

- 当前订单接口位于 `ClubScanOrderingOrderService.listOrders()`。
- 同桌且同一用户的有效 `active` 会话是当前用餐的锚点。
- 若存在同桌有效 `active` 会话，则可合并该桌的 `left` 会话订单，防止待接单订单落入“当前订单/历史记录都看不到”的空白区。
- **不能无条件把所有 `left` 会话放入当前订单**，否则前几天的旧订单会全部回流到“我的订单”。
- 页面列表必须按 `table.id` 聚合，不能按 `session.id` 直接渲染；否则同桌 `active + left` 会出现两张重复卡片。
- 聚合入口应优先选 `active` 会话，订单合并后再展示。

### 3.3 C 端订单详情

- 支付成功后的跳转为：`/pages/orderPkg/orderTracking/index?orderId=<新订单ID>`。
- `orderTracking` 必须同时支持 `sessionId` 与 `orderId` 定位会话；历史上忽略 `orderId` 曾导致支付成功订单不展示。
- 详情应合并同桌当前轮次中相关会话的订单，避免“旧退款订单一页，新支付订单一页”。
- “继续点餐”不能依据当前展示订单所属 session 是否为 `active`；应依据**同桌是否存在有效 active 会话**判断。
- 继续点餐新单必须使用 `getCurrentScanOrderingSession()` 返回的 active session ID 创建，不能使用详情页选中的 left session。

### 3.4 C 端点餐记录

- 点餐记录接口为 `ClubScanOrderingOrderService.listOrderHistory()`。
- 可查询 `checked_out`、`expired`、`left` 会话，但 `left` 会话不能无条件把所有订单当历史展示。
- `left` 会话中的 `pending_payment`、`pending_acceptance`、`preparing`、`served`、`refunding` 不应显示为“订单已结束”。
- `left` 会话历史中仅展示真正终态订单：`rejected`、`cancelled`、`completed`；退款订单以 `rejected + refunded` 显示“已退款”。
- 历史接口必须返回 `items.specs.specOptionNameSnapshot`，否则点餐记录无法展示规格。
- 商品条目之间可用 `、\n` 换行；规格内部保持 `、`，不要把单个规格组合拆散。

## 4. 排序规则（必须后端优先）

用户已明确要求：**最新时间在顶部**。

### 4.1 点餐记录

后端 `listOrderHistory()` 的 `orders` 必须：

```ts
orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
```

会话本身保持按最近会话/ID 倒序分页。

### 4.2 当前订单/订单详情

后端 `listOrders()` 的 `orders` 必须：

```ts
orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
```

前端若因为多会话合并再次排序，必须保持同一规则：

```text
createdAt 倒序；同一 createdAt 时 id 倒序。
```

不要擅自按退款时间改变订单排序。用户当前要求是**按下单时间倒序**；退款时间只用于“已退款”订单的时间展示。

## 5. 退款时间与实时事件

### 5.1 退款时间的兼容回退

订单详情、当前订单列表、点餐记录中退款完成时间统一按以下顺序计算：

```text
refundTask.refundSucceededAt
→ refundTask.processedAt
→ refundTask.triggeredAt
→ 最近余额退款流水 createdAt
→ null
```

接口给前端的时间应为 ISO 字符串，不要把 `Date` 原样返回后依赖运行时隐式序列化。

### 5.2 不用 `refresh()` 的实时更新

退款成功实时事件为 `order.status_changed`。

原事件仅带：

```ts
{ orderId, status, paymentStatus, fulfillmentStatus }
```

这会导致页面先显示“已退款”，但没有退款时间；退出重进后才从接口加载到时间。

正确契约必须增加：

```ts
refundSucceededAt?: string | null
```

完整实时流程：

```text
退款完成并持久化时间
→ 服务端 publishOrderStatusChanged({ ..., refundSucceededAt })
→ C 端收到事件
→ 仅更新目标订单的 status/paymentStatus/fulfillmentStatus/refundTasks[0].refundSucceededAt
→ 页面即时显示退款时间
```

不要用 `refresh()` 作为长期方案：它会带来排序闪动、会话重新聚合和竞态，且曾导致其他订单展示回归。

## 6. 规格、商品行与 UI 约束

- `ScanOrderItem.specs` 必须在当前订单、订单详情、点餐记录三个查询中都选取：

```ts
specs: {
  orderBy: { id: 'asc' },
  select: { specOptionNameSnapshot: true },
}
```

- 规格展示格式：`商品名（规格1、规格2）×数量`。
- 多个商品条目之间使用 `、\n` 分行；规格内部继续使用 `、`。
- 点餐记录需与订单详情对齐：右侧状态/时间列固定宽度，商品文本可换行但不得挤压状态列。

## 7. 已发生的典型回归及禁止操作

| 错误操作 | 引发的问题 | 正确处理 |
| --- | --- | --- |
| 只要有 `left` 会话就将桌台视为用餐中 | 空桌出现历史订单、订单数、人数字段错误 | 必须以有效 active 会话为当前轮次锚点 |
| `left` 会话无条件进入当前订单 | 数天前旧订单回流“我的订单” | 仅同用户、同桌、存在有效 active 时有限合并 |
| 将 left 中进行中订单仅从历史排除、却不放入正确当前范围 | 订单商家待接单，但 C 端两处都没有 | 通过同桌 active 关联保留其当前可见性 |
| 当前订单列表按 session 渲染 | 同桌出现两张 A01 卡片 | 前端按 `table.id` 聚合卡片 |
| 支付成功跳转传 `orderId`，详情页只读 `sessionId` | 新支付单不展示 | 支持 orderId 找所属会话 |
| 退款事件只推状态 | 即时显示“已退款”但时间为 `—` | 事件携带 `refundSucceededAt`，C 端局部更新 |
| 用 `refresh()` 补退款时间 | 造成刷新、重排和会话归属副作用 | 用实时 payload 直接更新 |
| 只给订单详情接口补规格 | 点餐记录仍不显示规格 | 当前列表/详情/历史三条查询都选 specs |
| 仅依赖后端同会话排序 | 多会话前端合并后排序又乱 | 合并处也按 createdAt/id 倒序 |

## 8. 新窗口开发“今日营业额 / 今日订单 / 实时更新 / 筛选”前置清单

### 8.1 今日的时间范围

- 必须明确按门店时区（当前 UI 使用 `Asia/Shanghai`）计算“今日”。
- 不要使用服务器本地时区的 `new Date()` 零点作为业务日界线。
- 查询建议使用半开区间：`[上海今日 00:00:00, 明日 00:00:00)`。

### 8.2 今日营业额口径必须先确认

建议默认以**成功支付且未退款的实收金额**为主，退款需要扣减；但实现前必须与产品确认：

```text
营业额是否用 paidAmount？
已退款订单是否全额扣减？
退款中是否先扣减还是退款成功后扣减？
部分退款未来如何处理？
取消/未支付是否计入？
```

不要直接以 `payableAmount` 或订单数量推导营业额。

### 8.3 今日订单统计

- “今日订单”应定义创建时间在上海今日范围内的订单数，而非会话数。
- 对每个统计指标明确状态口径：待接单、制作中、已出餐、退款中、已退款、取消、完成、待支付。
- 如果卡片显示的是“待接单”数，应只统计 `pending_acceptance`，不可混入 `pending_payment`。

### 8.4 状态筛选与类型筛选

- 状态筛选必须使用真实订单 `status` 与必要的 `paymentStatus` 联合判断。
- “已退款”不是独立 `status`，应匹配：

```text
status = rejected AND paymentStatus = refunded
```

- 类型筛选的具体字段和枚举必须先从 schema/API 确认；不可将桌台类型、支付类型、订单来源类型混为一谈。
- 筛选、统计和列表必须复用同一套后端 where 条件构造，避免面板数与列表数不一致。

### 8.5 实时更新

- 使用已有 `ScanOrderingRealtimeService` 和 `order.created`、`order.status_changed`。
- 新增 dashboard 事件前，先确认消费者端与商家端的 WebSocket 实现差异：H5 使用 Socket.IO，小程序使用原生 WebSocket。
- 若 dashboard 的数值会受创建、接单、拒单、退款、完成影响，应让事件 payload 足够支持局部更新；不能只凭 status 猜金额。
- 为避免统计在事件乱序下错误，必要时事件仅触发**受控的 dashboard 查询刷新**；订单详情退款时间是高频局部字段场景，才明确要求不 refresh。

## 9. 修改前必须执行的测试矩阵

至少覆盖：

1. 同桌同用户：`active + left`；
2. 同桌多个订单：待接单、制作中、已出餐、已退款混合；
3. 只有历史 `left`：不得出现在当前订单或占用空桌；
4. 退款后继续点餐：新订单必须进入同一桌详情；
5. 新订单支付成功跳转 `orderId`：能定位到对应会话；
6. 同桌 `active + left`：我的订单只能一张桌台卡片；
7. 退款实时完成：不退出、不 refresh 即刻显示退款时间；
8. 当前订单与点餐记录：都返回规格快照；
9. 订单详情与点餐记录：均为 `createdAt` 最新在顶部；
10. 今日统计：跨上海零点、退款、待支付、拒单、多个支付渠道；
11. 筛选后的列表数、卡片数、统计数必须一致。

## 10. 已修改的核心位置索引

| 文件 | 责任 |
| --- | --- |
| `purelyprofit-server/src/purely-club/scan-ordering/club-scan-ordering-order.service.ts` | C 端当前订单、点餐记录、规格、排序、退款时间序列化 |
| `purelyprofit-server/src/purely-profit/operations/scan-ordering/scan-ordering-table.service.ts` | 商家桌台当前轮次、订单与人数聚合、清桌边界 |
| `purelyprofit-server/src/purely-profit/operations/scan-ordering/scan-ordering-order-refund.service.ts` | 拒单/退款完成后的实时事件发布 |
| `purelyprofit-server/src/purely-club/scan-ordering/scan-ordering-realtime.service.ts` | 实时事件 payload 契约 |
| `purelyClub/src/pages/orderPkg/orderTracking/index.tsx` | 我的订单、订单详情、同桌会话聚合、继续点餐、实时状态更新 |
| `purelyClub/src/pages/orderPkg/orderHistory/index.tsx` | 点餐记录规格与退款时间展示 |
| `purelyClub/src/pages/orderPkg/orderHistory/index.module.less` | 点餐记录商品行与详情视觉对齐 |
| `purelyClub/src/services/scanOrderingSocket.ts` | C 端 WebSocket `order.status_changed` 类型契约 |

## 11. 质量校验惯例

服务端代码变更后至少执行：

```bash
pnpm test -- --runInBand purely-club/scan-ordering/club-scan-ordering-order.service.spec.ts
pnpm exec eslint <changed-files>
node scripts/check-f0rest-rules.mjs <changed-files>
pnpm build
```

若修改桌台聚合，还要执行：

```bash
pnpm test -- --runInBand purely-profit/operations/scan-ordering/scan-ordering-table.service.spec.ts
```

最后：不要只看单元测试。必须用以下真实流程手工回归：

```text
下单 → 支付 → 商家接单/拒单 → 退款 → 继续点餐 → 再支付 → 查看我的订单/详情/点餐记录/商家桌台。
```

# 会员卡接口契约（由 purelyProfit / purelyClub 已实现的前端调用反推，必须严格遵守）

> 本文件是后端实现的唯一字段依据。前端已经按此契约写完 UI 与 service 层，后端**不得改动路径、字段名、金额单位**。

## 0. 通用约定

| 项 | 约定 |
|---|---|
| 金额单位 | **入参出参一律用「元」**（number，可含小数）；落库统一转「分」存 Int |
| 时间字段 | **毫秒时间戳 number**（`startsAt` / `expiresAt` / `createdAt` / `paidAt`） |
| ID | 对外返回**字符串**（Prisma Int 需 `String(id)`），前端已按 string 承接 |
| 门店上下文 | 商家端写接口前端显式传 `?storeId=`（query），读列表同理；C 端由 `ClubCurrentContextInterceptor` 注入当前门店 |
| 分页 | 列表统一返回 `{ items, total, page, pageSize, totalPages }`，前端每页 20 |
| 手机号 | 返回**脱敏值**（如 `159****4010`），前端不再二次脱敏 |
| 枚举出参 | 小写蛇形字符串，前端按字面量联合收窄 |

## 1. 枚举

```
MemberCardKind        monthly | quarterly | yearly | times
MemberCardStatus      active | expired | exhausted | frozen | refunded
MemberCardSourceType  club_order | staff_issue | gift | migration
MemberCardOrderSource club_wechat | staff_cash | staff_wechat | gift
MemberCardOrderStatus unpaid | pending | paid | refunded | cancelled | closed
MemberCardChangeType  reserve | consume | release | purchase | refund | expire | adjust | gift
MemberCardTxnStatus   pending | done | cancelled
```

## 2. 商家端接口（prefix 固定为 `/marketing`）

| # | 方法 | 路径 | 请求 | 响应 |
|---|---|---|---|---|
| 1 | GET | `/marketing/member-card-plans` | `?storeId=&page=&pageSize=&kind=&isActive=` | 分页 `MemberCardPlan` |
| 2 | POST | `/marketing/member-card-plans` | `?storeId=` + body 见下 | `MemberCardPlan` |
| 3 | PATCH | `/marketing/member-card-plans/:id` | 局部更新，未传字段不改 | `MemberCardPlan` |
| 4 | PATCH | `/marketing/member-card-plans/:id/toggle` | `{ isActive: boolean }` | `MemberCardPlan` |
| 5 | GET | `/marketing/member-cards` | `?storeId=&page=&pageSize=&status=&kind=&keyword=` | 分页 `MemberCard` |
| 6 | GET | `/marketing/member-cards/:id` | — | `MemberCard` |
| 7 | GET | `/marketing/member-cards/:id/transactions` | `?page=&pageSize=` | 分页 `MemberCardTransaction` |
| 8 | POST | `/marketing/member-cards/issue` | `?storeId=` + body 见下 | `MemberCard` |
| 9 | GET | `/marketing/member-cards/identify` | `?storeId=&phone=` | `MemberCardIdentifyResult` |
| 10 | POST | `/marketing/member-cards/:id/adjust-times` | `?storeId=` + `{ delta: number; remark: string }` | `MemberCard` |
| 11 | GET | `/marketing/member-card-orders` | `?storeId=&page=&pageSize=&status=&source=` | 分页 `MemberCardOrder` |

### 2.1 `MemberCardPlan` 字段

```
id: string
name: string
kind: MemberCardKind
price: number            元
originalPrice?: number   元
validDays: number
totalTimes?: number      仅次数卡
perUseTimes: number      默认 1
usableSpaceTypes?: string[]
usableWeekdays?: number[] 1-7
maxGuestPerUse?: number
purchaseLimit?: number
soldCount?: number
isActive: boolean
createdAt: number
updatedAt?: number
```

创建请求：`{ name, kind, price, originalPrice?, validDays, totalTimes?, perUseTimes?, maxGuestPerUse?, purchaseLimit?, isActive }`
更新请求：上述字段全部可选，可空字段支持传 `null` 表示清空（`originalPrice` / `totalTimes` / `maxGuestPerUse` / `purchaseLimit`）。

### 2.2 `MemberCard` 字段

```
id: string
cardNo: string                唯一
kind: MemberCardKind
nameSnapshot: string
customerId: string
customerName?: string
customerPhone?: string        脱敏
status: MemberCardStatus
startsAt: number
expiresAt?: number
totalTimes?: number           仅次数卡
usedTimes?: number
remainTimes?: number
pricePaid?: number            元
sourceType: MemberCardSourceType
remainingDays?: number        后端计算
createdAt: number
```

### 2.3 线下办卡请求

```
{ phone: string; planId: string; startsAt: string /* yyyy-MM-dd，按门店时区 */;
  paymentChannel: 'cash' | 'wechat' | 'gift'; paidAmount: number /* 元，赠送为 0 */; remark?: string }
```

### 2.4 `identify` 响应

```
{
  customerId: string; name: string; phone?: string /* 脱敏 */;
  clubLevelLabel?: string;   // 会员等级显示名，如「金卡」
  balance: number;           // 元
  cards: MemberCard[];       // 仅返回当前可用卡
  vouchers: { code: string; productName: string; faceAmount: number /* 元 */; expiresAt?: number }[]
}
```

**安全边界**：必须限定当前 `storeId` + 手机号**精确匹配**；禁止返回消费明细、完整手机号、其他门店数据。

### 2.5 `MemberCardTransaction` 字段

```
id: string; cardId: string; changeType: MemberCardChangeType;
status: MemberCardTxnStatus; deltaTimes: number;   // 正增负减，时长卡恒 0
beforeTimes?: number; afterTimes?: number;
relatedSessionId?: string; relatedSpaceName?: string; relatedSaleOrderNo?: string;
operatorType: 'club' | 'cashier' | 'system'; operatorName?: string;
remark?: string; createdAt: number
```

### 2.6 `MemberCardOrder` 字段

```
id: string; orderNo: string; planNameSnapshot: string; kind: MemberCardKind;
amount: number /* 元 */; quantity: number; source: MemberCardOrderSource;
status: MemberCardOrderStatus; customerName?: string; customerPhone?: string;
operatorName?: string; paidAt?: number; createdAt: number
```

## 3. C 端接口（prefix 固定为 `/club`，当前门店由上下文注入）

| # | 方法 | 路径 | 请求 | 响应 |
|---|---|---|---|---|
| 1 | GET | `/club/cards/plans` | — | `MemberCardPlan[]`（仅 isActive） |
| 2 | POST | `/club/cards/orders` | `{ planId: string; quantity: number }` | `{ orderId, orderNo, paymentParams }` |
| 3 | GET | `/club/cards/orders/:id` | — | `{ orderId, orderNo, status, cardId? }` |
| 4 | POST | `/club/cards/orders/:id/confirm-paid` | — | `{ status }`（测试支付模式落账） |
| 5 | GET | `/club/cards` | `?page=&pageSize=` | 分页 `MemberCard` |
| 6 | GET | `/club/cards/:id` | — | `MemberCard & { transactions: MemberCardTransaction[] }` |

`paymentParams` 沿用现有微信 JSAPI 结构（与 `/club/recharge/orders` 一致）。

## 4. 开台与结账改造（前端已提交这些字段）

### 4.1 开台 `POST /space-sessions`

新增字段：

```
customerId?: string     // 会员识别命中的营销顾客 ID
activeCardId?: string   // 本次核销的持卡实例 ID
```

约束：选定 `activeCardId` 时，`billingMode` 前端已锁为 `items`；后端仍需二次校验，卡只抵台位费。

### 4.2 结账 `POST /space-sessions/:id/checkout`

新增字段：

```
settlements?: {
  kind: 'member_card' | 'voucher' | 'balance';
  target: 'time_fee' | 'items' | 'total';
  assetId?: string;      // 卡=持卡实例 ID；券=券码；余额=customerId
  assetLabel?: string;   // 名称快照
  amount: number;        // 元
}[];
expectedPayable?: number; // 元，仅用于比对，不参与计算
```

**硬约束（S0）**：
1. 应收一律后端重算，`expectedPayable` 仅比对，不一致直接拒；
2. `member_card` 只能抵 `time_fee`，且金额 ≤ 台位费；
3. 次数卡扣次与卡抵扣金额解耦：扣 `perUseTimes` 次，不是扣金额；
4. `reserve` → `done` 必须靠 `(cardId, relatedSessionId, changeType)` 唯一键幂等；
5. 余额扣减用条件更新 `updateMany({ where: { id, balance: { gte: n } } })`；
6. 卡抵扣写 `SYS_CARD_DEDUCTION` 系统行，并登记进 `isSpaceSessionDeductionProductId` 与 `isNonQuantitySystemItem`，否则销量与护理档案会重复计。

## 5. 金额口径

| 口径 | 落点 |
|---|---|
| 原价 | `SaleOrder.totalRevenue`（语义不变，勿改） |
| 卡抵扣 | `SaleOrder.cardDeductAmount` + `SpaceSession.cardDeductAmount` |
| 余额支付 | `SaleOrder.balancePaidAmount` |
| 本次实收 | 派生：`totalRevenue - cardDeductAmount - 券面额 - balancePaidAmount` |
| 卡销售收入 | `member_card_orders.paidAt` 当天确认，**不进 SaleOrder** |

## 6. 与现有代码对齐点

- 商家端控制器风格、`storeId` 取值、分页 DTO、`@ApiTags/@ApiOperation/@ApiBearerAuth` 参照 `src/purely-profit/marketing/` 现有商品控制器；
- 余额扣减与流水事务范式参照 `src/purely-club/voucher-orders/club-voucher-order-balance-settlement.helper.ts`；
- 系统虚拟行常量与判定参照 `src/purely-profit/operations/spaces/space-session-settlement-system-item.shared.ts`；
- 下单/支付/落账分层参照 `src/purely-club/recharge/`（creation → settlement → wechat-verify）；
- 流水表范式参照 `prisma/purely-profit/member/members.prisma` 的 `MemberBeanLog`。

# 数据库重构设计决策文档（第 0 步）

> **重要**：本文档是后续所有重构步骤的唯一权威依据。  
> 所有 schema 修改、代码改造、数据迁移必须严格遵守本文档定义的规则。  
> 修改本文档需要经过完整评审，不得在实施过程中随意调整。

---

## 文档状态

- **状态**：✅ 已完成设计决策冻结
- **版本**：v1.0.0
- **制定时间**：2026-06-25
- **预计执行起始时间**：2026-06-26
- **强制生效时间**：第 1 步开始执行时

---

## 0.1 会员域事实源与职责边界

### 当前问题

当前 `Member`、`MarketingCustomer`、`StoreMembershipProfile` 三张表存在职责重叠：

- `Member` 有：`points`、`totalConsumeAmount`、`level`
- `MarketingCustomer` 有：`points`、`totalSpent`、`tier`
- 两者通过 `storeId + phone` 隐式关联，无外键
- 代码中存在单向同步逻辑（`adjustCustomerPoints` 同步 `Member.points`）
- `purely-club` 侧同时查询两表并拼装数据

### 最终决策

#### **`StoreMembershipProfile`：平台会员/商家订阅**

**职责**：
- 负责商家购买平台能力的订阅状态
- 不参与顾客会员的余额、积分、消费累计

**保留字段**：
- `currentPlanId`
- `startsAt`
- `expiresAt`
- `totalPoints`（平台积分，商家购买套餐时赠送）
- `availablePoints`（平台积分余额）
- `subAccountQuota`

**关系**：
- 与 `Store` 一对一
- 与顾客会员体系完全隔离

---

#### **`MarketingCustomer`：顾客运行态账户事实源**

**职责**：
- 作为顾客账户的**唯一运行态事实源**
- 负责所有运行态数值字段

**保留字段（运行态数值）**：
- `balance`：储值余额（分）
- `points`：积分余额
- `totalSpent`：累计消费金额（分）
- `visitCount`：累计消费次数
- `lastVisitAt`：最后消费时间
- `tier`：会员等级（运行态，根据消费计算）

**新增字段**：
- `memberId`：显式外键关联到 `Member.id`（可为 null，兼容历史数据）
- `externalIdentifier`：外部身份标识（微信 openid / 其他第三方标识），可为 null
- `status`：顾客状态（active / inactive / banned）

**废弃 / 迁移字段**：
- `phone`：仅用于真实手机号，微信虚拟标识迁移到 `externalIdentifier`

---

#### **`Member`：顾客主档与业务标签层**

**职责**：
- 作为顾客主档
- 负责业务标签、静态属性、关系标识

**保留字段（主档与标签）**：
- `name`
- `phone`：真实手机号（可为 null）
- `gender`
- `birthday`
- `note`
- `tags`
- `status`：会员状态（ACTIVE / INACTIVE / BANNED）
- `isPartner`：是否合伙人
- `partnerLevel`：合伙人等级
- `bannedReason`：封禁原因

**废弃字段（已有运行态来源）**：
- ~~`points`~~：改为从 `MarketingCustomer.points` 读取
- ~~`totalConsumeAmount`~~：改为从 `MarketingCustomer.totalSpent` 读取
- ~~`level`~~：改为从 `MarketingCustomer.tier` 读取
- ~~`totalPointsEarned`~~：不再维护
- ~~`beanBalance`~~：迁移到 `MarketingCustomer` 或独立表
- ~~`totalRecharged`~~：不再维护
- ~~`rechargeCount`~~：不再维护
- ~~`lastConsumeAt`~~：改为从 `MarketingCustomer.lastVisitAt` 读取
- ~~`invitedCount`~~：迁移到合伙人专属表或不再维护

**新增字段**：
- `customerId`：显式外键关联到 `MarketingCustomer.id`（可为 null，兼容历史数据）

---

### 关系约束

```prisma
model Member {
  id         Int                @id @default(autoincrement())
  storeId    Int                @map("store_id")
  store      Store              @relation(...)
  customerId Int?               @unique @map("customer_id")
  customer   MarketingCustomer? @relation("MemberCustomer", fields: [customerId], references: [id], onDelete: SetNull)
  
  // 主档字段
  name       String
  phone      String?
  gender     MemberGender       @default(UNKNOWN)
  birthday   DateTime?
  note       String?
  tags       String[]           @default([])
  status     MemberStatus       @default(ACTIVE)
  
  // 业务标识
  isPartner     Boolean  @default(false) @map("is_partner")
  partnerLevel  String?  @map("partner_level")
  bannedReason  String?  @map("banned_reason")
  
  // 软删除
  deletedAt  DateTime? @map("deleted_at")
  
  createdAt  DateTime  @default(now()) @map("created_at")
  updatedAt  DateTime  @updatedAt @map("updated_at")
  
  @@unique([storeId, phone], map: "members_store_phone_key") // 将被改为 partial unique index
  @@index([customerId])
  @@map("members")
}

model MarketingCustomer {
  id         Int      @id @default(autoincrement())
  storeId    Int      @map("store_id")
  store      Store    @relation(...)
  memberId   Int?     @unique @map("member_id")
  member     Member?  @relation("MemberCustomer")
  
  // 身份标识
  name               String
  phone              String? // 仅用于真实手机号
  externalIdentifier String? @map("external_identifier") // 微信 openid / 其他第三方标识
  avatar             String?
  
  // 运行态数值（唯一事实源）
  balance    Int                   @default(0) // 储值余额（分）
  points     Int                   @default(0) // 积分余额
  totalSpent Int                   @default(0) @map("total_spent") // 累计消费金额（分）
  visitCount Int                   @default(0) @map("visit_count") // 累计消费次数
  lastVisitAt DateTime?            @map("last_visit_at") // 最后消费时间
  tier       MarketingCustomerTier @default(regular) // 会员等级（运行态）
  status     MarketingCustomerStatus @default(active) // 顾客状态
  
  remark     String?
  
  // 软删除
  deletedAt  DateTime? @map("deleted_at")
  
  createdAt  DateTime  @default(now()) @map("created_at")
  updatedAt  DateTime  @updatedAt @map("updated_at")
  
  @@unique([storeId, phone], map: "marketing_customers_store_phone_key") // 将被改为 partial unique index
  @@unique([storeId, externalIdentifier], map: "marketing_customers_store_external_key") // partial unique index
  @@index([memberId])
  @@map("marketing_customers")
}

enum MarketingCustomerStatus {
  active
  inactive
  banned
}
```

---

## 0.2 删除策略

### 原则

- **软删除**：主档类实体，需要支持"删除后重建"
- **禁止删除**：历史/流水/审计数据，只允许保留
- **允许硬删除**：纯配置子项、无审计价值的从属明细

### 软删除表清单

| 表名 | 理由 |
|---|---|
| `Store` | 门店主档，需要支持"注销后重开" |
| `Member` | 会员主档，需要支持"删除后重新注册" |
| `MarketingCustomer` | 顾客主档，需要支持"删除后重新建档" |
| `StorePartner` | 合伙人档案，需要保留历史关系 |
| `Employee` | 员工档案，需要保留历史排班/工资关联 |
| `Product` | 商品主档，删除后历史订单仍需追溯 |
| `ProductCategory` | 分类主档，删除后历史商品仍需追溯 |
| `Space` | 空间主档，删除后历史会话仍需追溯 |

### 禁止删除表清单（onDelete: Restrict 或 SetNull + Snapshot）

| 表名 | 策略 | 理由 |
|---|---|---|
| `SaleOrder` | `Restrict` | 销售订单是审计核心数据 |
| `SaleOrderItem` | `Cascade`（随父订单） | 明细从属于订单 |
| `FinanceCashFlowRecord` | `Restrict` | 财务流水必须永久保留 |
| `FinanceAccountRecord` | `Restrict` | 往来账必须永久保留 |
| `FinanceReconciliationRecord` | `Restrict` | 对账记录必须永久保留 |
| `MemberPointsLog` | `Restrict` + 快照 | 积分流水必须可追溯 |
| `MemberBeanLog` | `Restrict` + 快照 | 豆流水必须可追溯 |
| `MemberRechargeLog` | `Restrict` + 快照 | 充值流水必须可追溯 |
| `InventoryAdjustmentLog` | `Restrict` + 快照 | 库存调整历史必须可追溯 |
| `StorePartnerBeanLog` | `Restrict` + 快照 | 合伙人豆流水必须可追溯 |
| `PartnerWithdrawal` | `Restrict` + 快照 | 提现记录必须可追溯 |
| `CostRecord` | `Restrict` + 快照 | 成本记录必须可追溯 |
| `PurchaseOrder` | `Restrict` | 采购订单必须永久保留 |
| `StoreHandoverRecord` | `Restrict` + 快照 | 交接班记录必须可追溯 |
| `EmployeeShift` | `Restrict` + 快照 | 排班记录必须可追溯 |
| `EmployeeLeave` | `Restrict` + 快照 | 请假记录必须可追溯 |
| `EmployeePayroll` | `Restrict` | 工资记录必须永久保留 |
| `SpaceSession` | `Restrict` + 快照 | 空间会话必须可追溯 |
| `StoreMembershipOrder` | `Restrict` | 平台订单必须永久保留 |
| `StoreMembershipPointsLog` | `Restrict` | 平台积分流水必须可追溯 |
| `MarketingRecharge` | `Restrict` | 顾客储值记录必须可追溯 |
| `MarketingConsumption` | `Restrict` | 顾客消费记录必须可追溯 |
| `MarketingPointsRecord` | `Restrict` | 顾客积分流水必须可追溯 |

### 允许硬删除表清单

| 表名 | 理由 |
|---|---|
| `StorePartnerApplicationNote` | 纯附属明细，无独立审计价值 |
| `FinanceReconciliationItem` | 对账明细，随父记录删除 |
| `StoreHandoverAdditionalValue` | 交接班附加项值，随父记录删除 |

---

## 0.3 金额与时间标准

### 金额字段统一标准

**决策**：全仓统一为 **`Int` 类型，单位为"分"**

**理由**：
- `Int` 范围 ±21 亿，对应 ±2100 万元，对于 SaaS 场景足够
- 分为单位避免浮点精度问题
- 与 `marketing`、`member`、`membership` 现有设计一致

**迁移策略**：
- `finance`、`goods`、`operations` 的 `Decimal(12,2)` 字段改为 `Int`
- 数据迁移时乘以 100（元 → 分）
- 所有 DTO mapper 统一换算单位

**例外**：
- 汇率、折扣率等"比例类"字段仍可使用 `Decimal`
- 工资中的五险一金若需要保留小数，可保留 `Decimal`，但明确注释单位

### 时间字段统一标准

**决策**：

| 场景 | 类型 | 示例 |
|---|---|---|
| 时间点 | `DateTime` | `createdAt`、`startTime`、`endTime`、`paidAt` |
| 月份 | `DateTime`（月初零点） | `EmployeePayroll.month` 改为 `DateTime` |
| 排班时刻 | `String`（格式：`HH:mm`） | `EmployeeShift.startTime`、`EmployeeShift.endTime` |
| 时长 | `Int`（分钟数） | `SpaceSession.countdownMinutes` |

**排班时刻格式规范**：
- 格式：`HH:mm`（24 小时制）
- 示例：`09:00`、`18:30`
- 校验：应用层添加正则校验 `^([01][0-9]|2[0-3]):[0-5][0-9]$`

---

## 0.4 邀请码策略

### 当前问题

- 邀请码通过 `buildStoreInviteCode(storeId)` 实时计算
- 使用 LCG 算法，6 位纯数字，碰撞率高
- 没有持久化，没有唯一约束
- 无法支持"重新生成"、"禁用旧码"等需求

### 最终决策

**持久化邀请码**

新增表：

```prisma
model StoreInviteCode {
  id        Int      @id @default(autoincrement())
  storeId   Int      @map("store_id")
  store     Store    @relation(fields: [storeId], references: [id], onDelete: Cascade)
  code      String   @unique // 邀请码（6-8 位字符）
  isActive  Boolean  @default(true) @map("is_active") // 是否启用
  usedCount Int      @default(0) @map("used_count") // 使用次数
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")
  
  @@index([storeId, isActive])
  @@map("store_invite_codes")
}
```

**生成规则**：
- 字符集：`0-9A-Z`（去掉易混淆字符 `0OI1`）
- 长度：8 位
- 生成算法：`UUID v4` 取前 8 位并转换为字符集
- 碰撞检测：插入前查重，碰撞则重新生成

**迁移策略**：
- 为现有所有门店回填邀请码
- 回填时使用新算法生成，不再用 LCG
- 回填后将 `buildStoreInviteCode()` 函数废弃

---

## 0.5 敏感配置独立化

### 微信支付配置

**当前问题**：
- `Store.wechatApiV3Key` 明文存储
- 敏感配置与门店主档混在一起

**最终决策**：

新增表：

```prisma
model StoreWechatPayConfig {
  id              Int      @id @default(autoincrement())
  storeId         Int      @unique @map("store_id")
  store           Store    @relation(fields: [storeId], references: [id], onDelete: Cascade)
  mchId           String   @map("mch_id") // 商户号
  mchName         String   @map("mch_name") // 商户名称
  apiV3KeyEnc     String   @map("api_v3_key_enc") // 加密后的 API v3 密钥
  configuredAt    DateTime @map("configured_at")
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")
  
  @@index([mchId])
  @@map("store_wechat_pay_configs")
}
```

**加密方案**：
- 使用 AES-256-GCM
- 密钥通过环境变量 `WECHAT_PAY_KEY_ENCRYPTION_SECRET` 管理
- 解密只在支付回调/发起支付时进行，不暴露到 API 响应

**迁移策略**：
- 读取现有 `Store.wechatApiV3Key`
- 加密后写入新表
- 删除 `Store` 表的相关字段

---

## 0.6 `maxAccountSeats` 双写问题

### 当前问题

- `Store.maxAccountSeats`
- `StoreSubscription.maxAccountSeats`
- 两者可能不一致

### 最终决策

**唯一事实源**：`StoreMembershipProfile.subAccountQuota`

**废弃字段**：
- ~~`Store.maxAccountSeats`~~
- ~~`StoreSubscription.maxAccountSeats`~~

**理由**：
- `StoreMembershipProfile` 是平台会员权益的权威表
- 子账号配额是会员权益的一部分
- 应统一从 `PlatformMembershipAccessService` 读取

---

## 0.7 `Space.status` 运行态冗余问题

### 当前问题

- `Space.status` 与 `SpaceSession.status` 双写
- 两者可能不一致
- 代码中存在"发现不一致后修复"的逻辑

### 最终决策

**方案 A（推荐）**：去掉 `Space.status` 作为独立字段

- 运行态通过以下规则推导：
  - 若存在 `SpaceSession(spaceId, status=active)`：`occupied`
  - 若存在 `SpaceReservation(spaceId, status=pending)`：`reserved`
  - 其他情况：`idle`
- 保留 `Space.enableDirtyRoom` 字段支持"脏房"标记

**方案 B（备选）**：保留 `Space.status` 但降级为缓存字段

- 所有状态写入必须走统一 service
- 增加定时任务修复不一致
- 查询优先读缓存，关键操作重新推导

**最终选择**：**方案 A**

**理由**：
- 项目还未上线，数据量不大
- 去掉冗余字段能从根本上避免不一致
- 查询性能影响可通过索引优化

---

## 0.8 `StoreMembershipOrder` 支付状态机

### 当前问题

- `status` 默认值直接是 `paid`
- 缺少 `pending` 状态
- `paymentOrderId` 无唯一约束，回调不幂等

### 最终决策

**状态机**：

```
pending → paid
        → failed
        → refunded
```

**字段调整**：

```prisma
model StoreMembershipOrder {
  // ... 其他字段
  
  status         MembershipOrderStatus    @default(pending) // 改为 pending
  paymentChannel MembershipPaymentChannel @default(wechat) @map("payment_channel")
  paymentOrderId String?                  @unique @map("payment_order_id") // 增加 unique
  
  // ... 其他字段
}
```

**回调幂等逻辑**：

```typescript
// 支付回调伪代码
async handlePaymentCallback(paymentOrderId: string) {
  // 1. 尝试按 paymentOrderId 查订单
  const order = await prisma.storeMembershipOrder.findUnique({
    where: { paymentOrderId },
  });
  
  // 2. 若已处理过（status 非 pending），直接返回成功
  if (order && order.status !== 'pending') {
    return { success: true, alreadyProcessed: true };
  }
  
  // 3. 事务内更新订单状态 + 激活会员
  await prisma.$transaction(async (tx) => {
    await tx.storeMembershipOrder.update({
      where: { id: order.id, status: 'pending' }, // 加状态条件防并发
      data: { status: 'paid', paidAt: new Date() },
    });
    // ... 激活会员权益
  });
}
```

---

## 0.9 `StoreMembershipPromoRecord` 推广人关联

### 当前问题

- 推广人身份只存字符串 `inviteeName` / `inviteePhone`
- 无外键关联到 `StorePartner`

### 最终决策

**新增字段**：

```prisma
model StoreMembershipPromoRecord {
  id          Int                  @id @default(autoincrement())
  storeId     Int                  @map("store_id")
  store       Store                @relation(...)
  partnerId   Int?                 @map("partner_id") // 新增
  partner     StorePartner?        @relation(fields: [partnerId], references: [id], onDelete: SetNull) // 新增
  
  inviteeName  String               @map("invitee_name") // 保留作为快照
  inviteePhone String               @map("invitee_phone") // 保留作为快照
  
  // ... 其他字段
  
  @@index([partnerId, registeredAt])
}
```

**迁移策略**：
- 根据 `inviteePhone` 回填 `partnerId`
- 回填后保留 `inviteeName`/`inviteePhone` 作为历史快照

---

## 0.10 `pointsDeducted` / `pointsUsed` 重复字段

### 当前问题

```prisma
model StoreMembershipOrder {
  pointsDeducted Int @default(0) @map("points_deducted")
  pointsUsed     Int @default(0) @map("points_used")
  beanDeducted   Int @default(0) @map("bean_deducted")
  beansUsed      Int @default(0) @map("beans_used")
}
```

四个字段，语义不清晰。

### 最终决策

**保留单一字段**：

```prisma
model StoreMembershipOrder {
  pointsUsed Int @default(0) @map("points_used") // 实际使用的积分数量
  beansUsed  Int @default(0) @map("beans_used")  // 实际使用的豆数量
}
```

**废弃字段**：
- ~~`pointsDeducted`~~
- ~~`beanDeducted`~~

**理由**：
- 订单只需记录"实际使用了多少"
- "抵扣"和"使用"在这个场景是同义词

---

## 第 0 步验收标准

本步骤完成后，必须满足以下条件才能进入第 1 步：

### ✅ 文档完整性

- [ ] 已明确每张表的职责边界
- [ ] 已明确每个字段的事实源归属
- [ ] 已明确软删除表清单
- [ ] 已明确禁止删除表清单
- [ ] 已明确金额/时间统一标准
- [ ] 已明确邀请码最终方案
- [ ] 已明确敏感配置独立化方案
- [ ] 已明确运行态冗余字段处理方案
- [ ] 已明确支付状态机与幂等策略
- [ ] 已明确重复字段裁剪方案

### ✅ 规则冻结

- [ ] 本文档已通过技术评审
- [ ] 本文档版本号已确定（v1.0.0）
- [ ] 后续步骤不得擅自偏离本文档定义的规则

### ✅ 影响范围评估

- [ ] 已识别受影响的 schema 文件
- [ ] 已识别受影响的 service / controller
- [ ] 已识别受影响的 DTO / mapper
- [ ] 已识别受影响的测试文件
- [ ] 已评估数据迁移工作量

---

## 附录：术语表

| 术语 | 定义 |
|---|---|
| **事实源** | 某个业务事实的唯一权威数据来源，所有其他地方都应该从这里读取 |
| **主档** | 描述实体静态属性的表，如会员档案、商品档案 |
| **运行态** | 描述实体动态数值的表，如余额、积分、消费累计 |
| **软删除** | 通过 `deletedAt` 字段标记删除，物理记录仍保留 |
| **硬删除** | 物理删除数据库记录 |
| **审计数据** | 必须永久保留、可追溯的历史流水数据 |
| **快照字段** | 记录关联实体在某一时刻的值，防止主实体删除后无法追溯 |
| **冗余字段** | 从其他表可以推导出的字段，为性能缓存但可能不一致 |
| **双写** | 同一业务事实写入多个位置，容易产生不一致 |

---

## 下一步

执行 **第 1 步：修复删除与唯一性问题**


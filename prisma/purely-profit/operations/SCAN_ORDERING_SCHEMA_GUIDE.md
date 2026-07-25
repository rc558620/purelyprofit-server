# 扫码点餐模块 Schema 指南

## 📋 概述

本模块定义了整个扫码点餐功能的数据库模型和代码规范。

**重要**: 此 Schema 尚未应用于生产环境，当前处于 mock 驱动开发阶段。

---

## 🎯 核心原则

### 1. 命名规范

#### Prisma 模型命名
- **表名**: snake_case (下划线) - `scan_ordering_tables`
- **字段名**: snake_case (下划线) - `store_id`, `table_code`
- **枚举类型**: PascalCase (大驼峰) - `ScanOrderStatus`
- **Prisma 客户端引用**: `prisma.scan_ordering_tables` (snake_case)

#### TypeScript 代码规范
- **变量/参数**: camelCase (小驼峰) - `storeId`, `orderId`
- **DTO 类**: PascalCase (大驼峰) - `CreateScanOrderingAreaDto`
- **Service 类**: PascalCase + Service 后缀 - `ScanOrderingTableService`

#### SQL Migration 文件
- **列名**: snake_case (下划线) - `created_at`, `updated_at`
- **索引名**: descriptive_snake_case - `idx_store_id_status`

---

## 🔍 命名映射表

| Prisma 模型 | 表名 | Prisma 客户端引用 | 说明 |
|-------------|------|------------------|------|
| ScanOrderingArea | scan_ordering_areas | `prisma.scan_ordering_areas` | 区域表 |
| ScanOrderingTable | scan_ordering_tables | `prisma.scan_ordering_tables` | 桌台表 |
| ScanOrderingSession | scan_ordering_sessions | `prisma.scan_ordering_sessions` | 会话表 |
| ScanOrderingCartItem | scan_ordering_cart_items | `prisma.scan_ordering_cart_items` | 购物车项 |
| ScanOrders | scan_orders | `prisma.scan_orders` | 订单表 |
| ScanOrderItem | scan_order_items | `prisma.scan_order_items` | 订单项 |
| ScanOrderStatusHistory | scan_order_status_histories | `prisma.scan_order_status_histories` | 状态历史 |
| ScanOrderingMenuCategory | scan_ordering_menu_categories | `prisma.scan_ordering_menu_categories` | 菜单分类 |
| ScanOrderingMenuProduct | scan_ordering_menu_products | `prisma.scan_ordering_menu_products` | 菜单商品 |
| ScanOrderingSpecGroup | scan_ordering_spec_groups | `prisma.scan_ordering_spec_groups` | 规格组 |
| ScanOrderingSpecOption | scan_ordering_spec_options | `prisma.scan_ordering_spec_options` | 规格项 |
| ScanOrderingTableQrCode | scan_ordering_table_qr_codes | `prisma.scan_ordering_table_qr_codes` | 二维码 |

---

## ⚠️ 已知问题与待修复项

### 当前混用情况（❌ 错误示例）
```typescript
// ❌ 混合使用驼峰和下划线
this.prisma.scanOrderingArea.findMany(...)     // 错误！
this.prisma.scan_ordering_areas.findMany(...)  // 正确 ✅
```

### 修复步骤
1. 运行 Prisma 迁移生成客户端：
   ```bash
   cd /Users/f0rest/Mac/project/React/purelyprofit-server
   npx prisma migrate dev --name add_scan_ordering_schema
   npx prisma generate
   ```

2. 全局替换所有 Service 文件中的驼峰命名：
   ```bash
   # 在 src/purely-profit/operations/scan-ordering 目录下
   find . -name "*.ts" -type f -exec sed -i '' \
     's/\.scanOrderingArea\./.scan_ordering_areas./g' {} \;
   
   find . -name "*.ts" -type f -exec sed -i '' \
     's/\.scanOrderingTable\./.scan_ordering_tables./g' {} \;
   ```

3. 更新类型定义（如果需要）

---

## 📊 领域模型关系图

```
┌─────────────────────┐
│ ScanOrderingArea    │ 1 ──── ∞ ScanOrderingTable
│ (区域表)            │
└─────────────────────┘
                            │
                            │ 1 ──── ∞ ScanOrders
                            ▼
                    ┌──────────────────┐
                    │ ScanOrders       │ 订单表
                    │                  │
                    │ • status         │ 状态机
                    │ • version        │ 乐观锁
                    │ • amounts (cents)│ 金额（分）
                    └──────────────────┘
                            │
                            │ ∞
                            ▼
                    ┌──────────────────┐
                    │ ScanOrderItem    │ 订单项
                    └──────────────────┘
                            │
                            │ ∞
                            ▼
                    ┌──────────────────┐
                    │ ScanOrders...    │ ...
                    └──────────────────┘

同时还有独立的菜单体系：

┌──────────────────────┐
│ ScanOrderingMenuCat  │ 1 ──── ∞ ScanOrderingMenuProduct
│ egory                │          （分类包含多个商品）
└──────────────────────┘
                                 │
                                 │ 1 ──── ∞ ScanOrderingSpecGroup
                                 ▼
                        ┌────────────────────┐
                        │ SpecGroup          │ 规格组（如：辣度）
                        └────────────────────┘
                                 │
                                 │ 1 ──── ∞ ScanOrderingSpecOption
                                 ▼
                        ┌────────────────────┐
                        │ SpecOption         │ 规格项（如：加辣 ¥2）
                        └────────────────────┘
```

---

## 💾 金额处理规范

所有金额字段在数据库中必须以**分为单位**存储（Int 类型）：

```prisma
basePrice      Int   // 基础售价（分），不是元！
extraPrice     Int   // 加价（分）
lineTotalAmount Int  // 小计金额（分）
```

**转换工具**:
```typescript
import { Money } from '../../../shared/money.utils';

// 前端传入元 → 数据库存储分
const cents = Money.fromInputYuan(30).toDbCents();  // 3000

// 数据库取出分 → 前端展示元
const yuan = Money.fromDbCents(3000).toOutputYuan();  // 30
```

---

## 🔐 版本号控制

所有可更新的实体都包含 `version` 字段用于乐观锁：

```prisma
model ScanOrderingArea {
  version Int @default(0)
}

// 更新时的验证
await prisma.scan_ordering_areas.updateMany({
  where: { id: areaId, storeId, version: inputVersion },
  data: { name, version: { increment: 1 } }
});
```

---

## 📅 时间戳字段

所有表都需要标准的时间戳：

```prisma
createdAt  DateTime @default(now())
updatedAt  DateTime @updatedAt

// 业务特定时间点
acceptedAt DateTime?  // 接单时间
servedAt   DateTime?  // 出餐时间
paidAt     DateTime?  // 支付时间
completedAt DateTime? // 完成时间
cancelledAt  DateTime? // 取消时间
deletedAt  DateTime?  // 软删除标记
```

---

## 🗺️ 迁移文件位置

Migration SQL 文件位于：
```
/prisma/migrations/YYYYMMDDHHMMSS_migration_name/migration.sql
```

**创建新迁移的命令**:
```bash
npx prisma migrate dev --name add_scan_ordering_schema
```

---

## 🔄 后续优化建议

### P1 优先级
1. **添加软删除字段**：已部分实现，确保所有实体都有 `deletedAt`
2. **索引优化**：为常用查询条件添加组合索引
3. **外键约束**：明确定义主外键关系

### P2 优先级
1. **审计日志表**：记录所有关键操作
2. **分区表**：对于大规模数据，考虑按时间分区
3. **缓存失效策略**：定义 Redis 缓存的 TTL 和失效规则

---

## 📝 更新日志

| 日期 | 版本 | 修改内容 | 作者 |
|------|------|----------|------|
| 2026-07-22 | 1.0.0 | 初始定义 | f0rest |

---

## 🆘 常见问题

### Q: 如何添加新的字段？
1. 在 schema.prisma 中添加字段定义
2. 运行 `npx prisma migrate dev`
3. 如果已有数据，编写手动迁移脚本

### Q: Prisma 客户端不识别怎么办？
运行 `npx prisma generate` 重新生成类型定义

### Q: 金额计算出现精度问题？
永远不要在数据库中使用 Decimal/Float，统一使用 Int(分)

---

**最后更新**: 2026-07-22  
**维护者**: f0rest

# ScanOrdering Prisma Client 集成指南

## ✅ 已完成的工作

### 1. Schema 定义 (✅ 完成)
文件：`/prisma/purely-profit/operations/schema.prisma`
- ✅ 所有模型使用驼峰命名 (PascalCase for Models, camelCase for fields)
- ✅ 通过 `@map` 映射到数据库的 snake_case 列名
- ✅ 通过 `@@map` 映射表名为 snake_case
- ✅ 添加了完整的反向关联字段

### 2. 代码重命名 (✅ 完成)
全局替换了所有 Service 文件中的 Prisma Client 引用：
- `scan_ordering_areas` → `scanOrderingAreas`
- `scan_ordering_tables` → `scanOrderingTables`
- `scan_orders` → `scanOrders`
- ...等共 15 个模型

### 3. Prisma Client 生成 (✅ 完成)
成功在 `/prisma/purely-profit/src/generated/client` 生成了 TypeScript 客户端。

## ⚠️ 待完成的工作

### Prisma Service 集成问题

当前 `src/prisma/prisma.service.ts` 从 `@prisma/client` 导入，但这是旧的未定义的 client。

#### 解决方案 A：使用模块化合规方式（推荐）

修改 `src/prisma/prisma.service.ts`：

```typescript
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
// 引入新生成的 Client
import type { PrismaClient as ScanOrderingPrismaClient } 
  from '../prisma/purely-profit/src/generated/client/index.js';

@Injectable()
export class PrismaService extends 
  PrismaClient<ScanOrderingPrismaClient, 'query'> {
  // ... existing code
}
```

然后在所有 Service 中，直接使用 `this.scanOrderingAreas` 等驼峰方法。

#### 解决方案 B：创建别名导入（快速方案）

创建 `/src/prisma/custom-prisma.ts`：

```typescript
// Re-export from new generated client
export * from '../prisma/purely-profit/src/generated/client/index.js';
export { default as PrismaClient } 
  from '../prisma/purely-profit/src/generated/client/index.js';
export { Prisma };
```

然后修改 `prisma.service.ts`：
```typescript
import { Prisma, PrismaClient } from './custom-prisma';
```

## 🔄 下一步操作

### 立即执行（阻塞性问题）

1. **选择上述任一解决方案集成新 Client**
   - 方案 A 更规范，方案 B 更快
   
2. **验证类型检查**
   ```bash
   cd /Users/f0rest/Mac/project/React/purelyprofit-server
   npx tsc --noEmit -p tsconfig.json
   # 确保没有 scan-ordering 相关的 TS errors
   ```

3. **运行测试**
   ```bash
   npm test -- src/purely-profit/operations/scan-ordering/scan-ordering-area.service.spec.ts
   ```

### 数据库迁移（可选）

如果需要在真实数据库中应用此 Schema：

```bash
cd /Users/f0rest/Mac/project/React/purelyprofit-server

# 1. 先备份现有数据
npx prisma db pull

# 2. 创建 migration
npx prisma migrate dev --name add_scan_ordering_schema

# 3. 生成最终 client
npx prisma generate

# 4. 部署到生产
npx prisma migrate deploy
```

## 📋 完整的 Schema 清单

以下模型已全部定义并完成驼峰化：

| 模型名称 | TypeScript 访问 | 数据库表名 | 状态 |
|---------|---------------|-----------|------|
| ScanOrderingArea | `scanOrderingAreas` | scan_ordering_areas | ✅ |
| ScanOrderingTable | `scanOrderingTables` | scan_ordering_tables | ✅ |
| ScanOrderingSession | `scanOrderingSessions` | scan_ordering_sessions | ✅ |
| ScanOrderingCartItem | `scanOrderingCartItems` | scan_ordering_cart_items | ✅ |
| ScanOrderingCartItemSpec | `scanOrderingCartItemSpecs` | scan_ordering_cart_item_specs | ✅ |
| ScanOrders | `scanOrders` | scan_orders | ✅ |
| ScanOrderItem | `scanOrderItems` | scan_order_items | ✅ |
| ScanOrderItemSpec | `scanOrderItemSpecs` | scan_order_item_specs | ✅ |
| ScanOrderStatusHistory | `scanOrderStatusHistories` | scan_order_status_histories | ✅ |
| ScanOrderingMenuCategory | `scanOrderingMenuCategories` | scan_ordering_menu_categories | ✅ |
| ScanOrderingMenuProduct | `scanOrderingMenuProducts` | scan_ordering_menu_products | ✅ |
| ScanOrderingSpecGroup | `scanOrderingSpecGroups` | scan_ordering_spec_groups | ✅ |
| ScanOrderingSpecOption | `scanOrderingSpecOptions` | scan_ordering_spec_options | ✅ |
| ScanOrderingTableQrCode | `scanOrderingTableQrCodes` | scan_ordering_table_qr_codes | ✅ |

## 🎯 代码示例

### 使用驼峰式 API

```typescript
// BEFORE (旧方式)
await this.prisma.scan_ordering_areas.findMany({
  where: { store_id: storeId }
});

// AFTER (新方式 - 驼峰)
await this.prisma.scanOrderingAreas.findMany({
  where: { storeId }
});
```

### 创建区域

```typescript
const area = await this.prisma.scanOrderingAreas.create({
  data: {
    storeId,      // camelCase!
    name: '大厅',
    sortOrder: 10,
    isActive: true
  },
  select: { id: true, name: true }
});
```

### 带关系查询

```typescript
const tables = await this.prisma.scanOrderingTables.findMany({
  where: { storeId, areaId },
  include: {
    sessions: {
      where: { status: 'active' },
      take: 1
    },
    orders: {
      where: { status: 'pending_acceptance' }
    }
  }
});
```

## 📝 注意事项

1. **数据库列名仍保持 snake_case**  
   虽然代码中使用驼峰，但写入数据库时会自动映射为 `store_id`, `table_code` 等。

2. **TypeScript 类型安全**  
   新生成的 Client 提供完整的类型推导，IDE 可自动补全所有可用方法。

3. **向后兼容**  
   旧的 snake_case 调用方式将不再受支持，所有代码必须更新为驼峰式。

4. **Migration 注意事项**  
   如果已有数据，直接应用新 Schema 可能导致列名不匹配，需要先规划数据迁移策略。

---

**最后更新**: 2026-07-22  
**状态**: Schema 和代码已改造完成，等待 Prisma Client 集成测试  
**负责人**: f0rest

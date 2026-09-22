import { Money } from '../../../shared/money.utils';
import type { HandoverOrderItemDto } from './dto/handover-shared.dto';
import type { OrderItemRow } from './handover.types';
import { mapOrderItem } from './handover-order-item.mapper';

/**
 * 将扫码订单商品规格按数量展开为 spec 序列，与 saleOrderItem 按顺序一一对应。
 * 扫码订单的 saleOrderItem 创建顺序与 scanOrder.items 展开顺序一致，
 * 第 i 个 saleOrderItem 的规格对应展开列表中第 i 个单元的规格。
 */
function buildScanItemSpecsList(
  scanOrder: OrderItemRow['order']['scanOrder'],
): string[][] {
  if (!scanOrder?.items || scanOrder.items.length === 0) return [];

  const specsList: string[][] = [];
  for (const scanItem of scanOrder.items) {
    const specs = (scanItem.specs ?? []).map((s) => s.specOptionNameSnapshot);
    for (let i = 0; i < Math.max(scanItem.quantity, 0); i++) {
      specsList.push(specs);
    }
  }
  return specsList;
}

/**
 * 非扫码订单（空间会话结账）构建 spec 序列：
 * saleOrderItem 由 sessionItems **行级**复制（不按数量展开），
 * 因此按行索引一一对应，每行规格即该行 specNames。
 */
function buildSpaceItemSpecsList(
  spaceSession: OrderItemRow['order']['spaceSession'],
): string[][] {
  const items = spaceSession?.sessionItems;
  if (!items || items.length === 0) return [];
  return items.map((item) => {
    const names = Array.isArray(item.specNames)
      ? item.specNames.filter(
          (name): name is string => typeof name === 'string',
        )
      : [];
    return names;
  });
}

/**
 * 按「商品名称 + 规格」合并同一订单内的相同商品行：
 * 数量直接累加，金额按 salePrice × quantity 之和重算（分单位，后端统一计算）。
 * 规格仅用于分组判定（完全相同才合并），合并行不展示规格字段。
 */
function buildAggregatedOrderItem(
  items: OrderItemRow[],
  storeOwnerUserId: number | null,
  shiftOperatorName: string | null,
  refundedOrderIds: ReadonlySet<number>,
): HandoverOrderItemDto {
  const first = items[0];
  const base = mapOrderItem(
    first,
    storeOwnerUserId,
    shiftOperatorName,
    refundedOrderIds,
  );
  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
  // 整单金额 = 所有商品行金额之和（分），统一转元展示
  const totalRevenueCents = items.reduce((sum, item) => {
    return (
      sum +
      Money.fromDbCents(item.salePrice).multiply(item.quantity).toDbCents()
    );
  }, 0);

  return {
    ...base,
    quantity: totalQuantity,
    totalRevenue: Money.fromDbCents(totalRevenueCents).toOutputYuan(),
  };
}

type ProductGroup = { items: OrderItemRow[]; hasSpec: boolean };

/**
 * 对非手工补录的普通商品行按「订单 ID + 商品名称 + 规格」进行聚合：
 * 1. 按订单 ID 分组，组内按 id 升序（匹配扫码订单展开顺序）
 * 2. 扫码订单从 scanOrder.items 展开 spec 序列，每件商品行匹配对应规格
 * 3. 按「商品名称 + 规格字符串化」分组
 * 4. 每组内 >1 行的调用 buildAggregatedOrderItem 合并，单行的直接映射
 */
export function aggregateRegularOrderItems(
  items: OrderItemRow[],
  storeOwnerUserId: number | null,
  shiftOperatorName: string | null,
  refundedOrderIds: ReadonlySet<number>,
): HandoverOrderItemDto[] {
  const orderGroups = new Map<number, OrderItemRow[]>();
  for (const item of items) {
    const group = orderGroups.get(item.order.id) ?? [];
    group.push(item);
    orderGroups.set(item.order.id, group);
  }

  const result: HandoverOrderItemDto[] = [];

  for (const [, orderGroup] of orderGroups) {
    // 按 id 升序排序（与扫码订单商品展开顺序一致）
    orderGroup.sort((a, b) => a.id - b.id);

    // 扫码订单构建 spec 序列（按数量展开）；非扫码订单回退空间会话商品行规格（行级对应）
    const scanSpecsList = buildScanItemSpecsList(orderGroup[0].order.scanOrder);
    const spaceSpecsList =
      scanSpecsList.length === 0
        ? buildSpaceItemSpecsList(orderGroup[0].order.spaceSession)
        : [];

    // 按「商品名称 + 规格」分组（同时追踪该组是否有规格）
    const productGroups = new Map<string, ProductGroup>();
    orderGroup.forEach((item, index) => {
      const specs = scanSpecsList[index] ?? spaceSpecsList[index] ?? [];
      const hasSpec = specs.length > 0;
      const key = `${item.productName}_${JSON.stringify(specs)}`;
      const existing = productGroups.get(key) ?? {
        items: [],
        hasSpec: false,
      };
      existing.items.push(item);
      existing.hasSpec = hasSpec;
      productGroups.set(key, existing);
    });

    // 每组映射为 HandoverOrderItemDto 并补充 hasSpec 标记
    for (const [, group] of productGroups) {
      const dto: HandoverOrderItemDto =
        group.items.length === 1
          ? mapOrderItem(
              group.items[0],
              storeOwnerUserId,
              shiftOperatorName,
              refundedOrderIds,
            )
          : buildAggregatedOrderItem(
              group.items,
              storeOwnerUserId,
              shiftOperatorName,
              refundedOrderIds,
            );
      // 商品带规格时设置标记（前端渲染规格标签）
      if (group.hasSpec) {
        dto.hasSpec = true;
      }
      result.push(dto);
    }
  }

  return result;
}

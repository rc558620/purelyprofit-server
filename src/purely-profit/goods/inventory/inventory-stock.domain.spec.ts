import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  buildInventoryManualAdjustmentPlan,
  buildInventoryRevertStockPlan,
  buildInventoryStockChangePlan,
  resolveAdjustedStock,
} from './inventory-stock.domain';
import type {
  InventoryManualAdjustmentCommand,
  InventoryMutableProductRecord,
  InventoryStockChangeCommand,
} from './inventory.types';

describe('inventory-stock.domain', () => {
  const product: InventoryMutableProductRecord = {
    id: 101,
    name: '可口可乐 330ml',
    stock: 10,
  };

  /* BUG-3 修复：delta 模式下结果为负数时抛异常，而非静默截断到 0 */
  it('resolveAdjustedStock 在 delta 模式下结果为负数时抛出异常', () => {
    expect(() =>
      resolveAdjustedStock({
        currentStock: 3,
        delta: -5,
        mode: 'delta',
      }),
    ).toThrow(BadRequestException);
  });

  it('resolveAdjustedStock 在 delta 模式下正常减少库存', () => {
    expect(
      resolveAdjustedStock({
        currentStock: 10,
        delta: -3,
        mode: 'delta',
      }),
    ).toBe(7);
  });

  it('resolveAdjustedStock 在 set 模式缺少目标库存时抛出异常', () => {
    expect(() =>
      resolveAdjustedStock({
        currentStock: 10,
        mode: 'set',
      }),
    ).toThrow(BadRequestException);
  });

  /* BUG-3 修复：delta=-12 + stock=10 结果为负数，现在抛异常 */
  it('buildInventoryManualAdjustmentPlan 在 delta 导致负库存时抛出异常', () => {
    const command: InventoryManualAdjustmentCommand = {
      storeId: 18,
      productId: 101,
      operatorStaffId: 8,
      delta: -12,
      mode: 'delta',
      adjustType: 'manual',
      note: '盘点修正',
    };

    expect(() =>
      buildInventoryManualAdjustmentPlan({
        product,
        command,
      }),
    ).toThrow(BadRequestException);
  });

  it('buildInventoryManualAdjustmentPlan 会生成盘点调整计划', () => {
    const command: InventoryManualAdjustmentCommand = {
      storeId: 18,
      productId: 101,
      operatorStaffId: 8,
      delta: -3,
      mode: 'delta',
      adjustType: 'manual',
      note: '盘点修正',
    };

    expect(
      buildInventoryManualAdjustmentPlan({
        product,
        command,
      }),
    ).toEqual({
      productId: 101,
      afterStock: 7,
      log: {
        storeId: 18,
        productId: 101,
        operatorStaffId: 8,
        productName: '可口可乐 330ml',
        beforeStock: 10,
        afterStock: 7,
        delta: -3,
        adjustType: 'manual',
        note: '盘点修正',
      },
    });
  });

  it('buildInventoryManualAdjustmentPlan 在商品不存在时抛出异常', () => {
    const command: InventoryManualAdjustmentCommand = {
      storeId: 18,
      productId: 999,
      operatorStaffId: 8,
      targetStock: 20,
      mode: 'set',
      adjustType: 'manual',
    };

    expect(() =>
      buildInventoryManualAdjustmentPlan({
        product: null,
        command,
      }),
    ).toThrow(NotFoundException);
  });

  it('buildInventoryStockChangePlan 会生成销售扣减计划', () => {
    const command: InventoryStockChangeCommand = {
      storeId: 18,
      productId: 101,
      quantity: 4,
      operatorStaffId: 8,
      adjustType: 'sale',
      saleOrderId: 66,
      note: '销售扣减',
    };

    expect(
      buildInventoryStockChangePlan({
        product,
        command,
      }),
    ).toEqual({
      productId: 101,
      afterStock: 6,
      log: {
        storeId: 18,
        productId: 101,
        operatorStaffId: 8,
        productName: '可口可乐 330ml',
        beforeStock: 10,
        afterStock: 6,
        delta: -4,
        adjustType: 'sale',
        note: '销售扣减',
        saleOrderId: 66,
      },
    });
  });

  it('buildInventoryStockChangePlan 在库存不足时抛出异常', () => {
    const command: InventoryStockChangeCommand = {
      storeId: 18,
      productId: 101,
      quantity: 11,
      operatorStaffId: 8,
      adjustType: 'sale',
      saleOrderId: 66,
      note: '销售扣减',
    };

    expect(() =>
      buildInventoryStockChangePlan({
        product,
        command,
      }),
    ).toThrow(BadRequestException);
  });

  it('buildInventoryRevertStockPlan 会按日志 delta 回滚库存', () => {
    expect(
      buildInventoryRevertStockPlan({
        product: {
          id: 101,
          name: '可口可乐 330ml',
          stock: 6,
        },
        delta: -4,
      }),
    ).toEqual({
      productId: 101,
      stock: 10,
    });
  });
});

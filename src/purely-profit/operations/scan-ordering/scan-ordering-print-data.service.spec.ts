import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { ScanOrderingPrintDataService } from './scan-ordering-print-data.service';

describe('ScanOrderingPrintDataService', () => {
  let service: ScanOrderingPrintDataService;
  const prismaService = { scanOrders: { findFirst: jest.fn() } };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScanOrderingPrintDataService,
        { provide: PrismaService, useValue: prismaService },
      ],
    }).compile();
    service = module.get<ScanOrderingPrintDataService>(
      ScanOrderingPrintDataService,
    );
  });

  it('归一订单为打印结构：取餐号补零、金额转元、含商品与规格', async () => {
    prismaService.scanOrders.findFirst.mockResolvedValue({
      orderNo: 'SO-001',
      createdAt: new Date('2026-08-17T07:45:00.000Z'),
      pickupNumber: 5,
      remark: '不要辣',
      itemOriginalAmount: 5000,
      specificationExtraAmount: 500,
      productDiscountAmount: 1000,
      orderDiscountAmount: 800,
      serviceFeeAmount: 0,
      taxAmount: 0,
      payableAmount: 3300,
      marketingSnapshot: {
        pointsDeductAmount: 200,
        breakdownItems: [
          { label: '会员等级折扣 8折', amount: -1000, isStrikethrough: false },
          { label: '满50减8', amount: -800, isStrikethrough: false },
        ],
      },
      table: { name: 'A01' },
      items: [
        {
          productNameSnapshot: '牛肉面',
          quantity: 2,
          unitPriceAmount: 2500,
          lineTotalAmount: 5000,
          payableLineAmount: 4000,
          specs: [{ specOptionNameSnapshot: '微辣' }],
        },
      ],
    });
    const order = await service.loadOrder(11, 1);
    expect(order.orderNo).toBe('SO-001');
    expect(order.createdAtLabel).toBe('2026-08-17 15:45');
    expect(order.pickupNumberLabel).toBe('005');
    expect(order.payableAmount).toBe('33.00');
    expect(order.tableName).toBe('A01');
    expect(order.items[0].name).toBe('牛肉面');
    expect(order.items[0].quantity).toBe(2);
    expect(order.items[0].specs[0].name).toBe('微辣');
    // 单价与行金额：分转元
    expect(order.items[0].unitPrice).toBe(25);
    expect(order.items[0].payableLineAmount).toBe(40);
    // 优惠清单：仅保留减免项且金额转元
    expect(order.discountItems).toHaveLength(2);
    expect(order.discountItems[0].label).toBe('会员等级折扣 8折');
    expect(order.discountItems[0].amount).toBe(-10);
    // 已优惠总额：原价 50 + 加价 5 − 应付 33 = 22（减法口径大于加法兜底 20）
    expect(order.discountAmount).toBe(22);
    // 积分抵扣独立字段（元）
    expect(order.pointsDeductAmount).toBe(2);
    expect(order.itemOriginalAmount).toBe(50);
    expect(order.specificationExtraAmount).toBe(5);
  });

  it('无取餐号/无桌台时返回 null 与占位符', async () => {
    prismaService.scanOrders.findFirst.mockResolvedValue({
      orderNo: 'SO-002',
      pickupNumber: null,
      remark: null,
      itemOriginalAmount: 0,
      specificationExtraAmount: 0,
      productDiscountAmount: 0,
      orderDiscountAmount: 0,
      serviceFeeAmount: 0,
      taxAmount: 0,
      payableAmount: 100,
      marketingSnapshot: null,
      table: null,
      items: [],
    });
    const order = await service.loadOrder(11, 2);
    expect(order.pickupNumberLabel).toBeNull();
    expect(order.tableName).toBe('-');
    expect(order.discountItems).toEqual([]);
    expect(order.discountAmount).toBe(0);
    expect(order.pointsDeductAmount).toBe(0);
  });

  it('订单不存在时抛 404', async () => {
    prismaService.scanOrders.findFirst.mockResolvedValue(null);
    await expect(service.loadOrder(11, 999)).rejects.toThrow(NotFoundException);
  });
});

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
      pickupNumber: 5,
      remark: '不要辣',
      payableAmount: 4000,
      table: { name: 'A01' },
      items: [
        {
          productNameSnapshot: '牛肉面',
          quantity: 2,
          specs: [{ specOptionNameSnapshot: '微辣' }],
        },
      ],
    });
    const order = await service.loadOrder(11, 1);
    expect(order.orderNo).toBe('SO-001');
    expect(order.pickupNumberLabel).toBe('005');
    expect(order.payableAmount).toBe('40.00');
    expect(order.tableName).toBe('A01');
    expect(order.items[0].name).toBe('牛肉面');
    expect(order.items[0].quantity).toBe(2);
    expect(order.items[0].specs[0].name).toBe('微辣');
  });

  it('无取餐号/无桌台时返回 null 与占位符', async () => {
    prismaService.scanOrders.findFirst.mockResolvedValue({
      orderNo: 'SO-002',
      pickupNumber: null,
      remark: null,
      payableAmount: 100,
      table: null,
      items: [],
    });
    const order = await service.loadOrder(11, 2);
    expect(order.pickupNumberLabel).toBeNull();
    expect(order.tableName).toBe('-');
  });

  it('订单不存在时抛 404', async () => {
    prismaService.scanOrders.findFirst.mockResolvedValue(null);
    await expect(service.loadOrder(11, 999)).rejects.toThrow(NotFoundException);
  });
});

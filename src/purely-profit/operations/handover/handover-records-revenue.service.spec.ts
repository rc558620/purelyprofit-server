import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { HandoverRecordsRevenueService } from './handover-records-revenue.service';
import type { ShiftDateRange } from './handover.shared';

describe('HandoverRecordsRevenueService.countRecordRevenue (BUG-2 修复验证)', () => {
  let prisma = {
    saleOrder: { aggregate: jest.fn() },
    spaceSession: { aggregate: jest.fn(), findMany: jest.fn() },
  };
  let service: HandoverRecordsRevenueService;
  const shiftRange: ShiftDateRange = {
    startAt: new Date('2026-07-12T00:00:00.000Z'),
    endAt: new Date('2026-07-12T23:59:59.000Z'),
  };

  beforeEach(() => {
    prisma = {
      saleOrder: {
        aggregate: jest.fn(),
      },
      spaceSession: {
        aggregate: jest.fn(),
        findMany: jest.fn(),
      },
    };
    service = new HandoverRecordsRevenueService(
      prisma as unknown as PrismaService,
    );
  });

  it('应包含空间会话营收：totalRevenue = additional + space', async () => {
    prisma.saleOrder.aggregate
      .mockResolvedValueOnce({
        _sum: { totalRevenue: new Prisma.Decimal('50000') }, // 非空间销售 = 500 元
      })
      .mockResolvedValueOnce({
        _sum: { totalRevenue: null }, // 扫码点餐订单收入（本场景无）
      });
    prisma.spaceSession.aggregate.mockResolvedValue({
      _sum: {
        timeCost: new Prisma.Decimal('60000'), // 600 元
        itemsCost: new Prisma.Decimal('5000'), // 50 元
      },
    });

    const result = await service.countRecordRevenue(100, shiftRange, null);

    // 期望 500 + 650 = 1150，而非旧逻辑的 500
    expect(result).toBe(1150);
    expect(prisma.saleOrder.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ spaceSession: { is: null } }),
      }),
    );
    expect(prisma.spaceSession.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ _sum: { timeCost: true, itemsCost: true } }),
    );
  });

  it('存在空间会话退款时，totalRevenue 仍为 additional + space（退款不在此扣减）', async () => {
    prisma.saleOrder.aggregate
      .mockResolvedValueOnce({
        _sum: { totalRevenue: new Prisma.Decimal('50000') }, // 500 元
      })
      .mockResolvedValueOnce({
        _sum: { totalRevenue: null }, // 扫码点餐订单收入（本场景无）
      });
    prisma.spaceSession.aggregate.mockResolvedValue({
      _sum: {
        timeCost: new Prisma.Decimal('60000'), // 600 元
        itemsCost: new Prisma.Decimal('5000'), // 50 元
      },
    });
    // 某会话预付 300 元，消费 250 元 → 退款 50 元（来自空间会话）
    prisma.spaceSession.findMany.mockResolvedValue([
      {
        timeCost: 25000,
        itemsCost: 0,
        prepaidAmount: 30000,
        sessionRenewRecords: [],
      },
    ]);

    const result = await service.countRecordRevenue(100, shiftRange, null);

    // 退款不应在此扣减：仍为 1150，而非 500 - 50 = 450
    expect(result).toBe(1150);
  });

  it('仅有空间营收、无非空间销售时，totalRevenue = space', async () => {
    prisma.saleOrder.aggregate.mockResolvedValue({
      _sum: { totalRevenue: null },
    });
    prisma.spaceSession.aggregate.mockResolvedValue({
      _sum: {
        timeCost: new Prisma.Decimal('0'),
        itemsCost: new Prisma.Decimal('12345'), // 123.45 元
      },
    });

    const result = await service.countRecordRevenue(100, shiftRange, null);
    expect(result).toBeCloseTo(123.45, 2);
  });

  it('无营收时 totalRevenue = 0', async () => {
    prisma.saleOrder.aggregate.mockResolvedValue({
      _sum: { totalRevenue: null },
    });
    prisma.spaceSession.aggregate.mockResolvedValue({
      _sum: { timeCost: null, itemsCost: null },
    });

    const result = await service.countRecordRevenue(100, shiftRange, null);
    expect(result).toBe(0);
  });
});

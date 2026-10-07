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

describe('HandoverRecordsRevenueService.countRecordRevenueBatch', () => {
  let prisma: Record<string, jest.Mock>;
  let service: HandoverRecordsRevenueService;

  const shiftRanges: ShiftDateRange[] = [
    {
      startAt: new Date('2026-07-12T00:00:00.000Z'),
      endAt: new Date('2026-07-12T23:59:59.000Z'),
    },
    {
      startAt: new Date('2026-07-13T00:00:00.000Z'),
      endAt: new Date('2026-07-13T23:59:59.000Z'),
    },
  ];

  beforeEach(() => {
    prisma = {
      $queryRaw: jest.fn(),
    };
    service = new HandoverRecordsRevenueService(
      prisma as unknown as PrismaService,
    );
  });

  it('空数组时返回空数组', async () => {
    const result = await service.countRecordRevenueBatch(100, []);
    expect(result).toEqual([]);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('批量返回各 shiftRange 的 totalRevenue，口径与 countRecordRevenue 一致', async () => {
    // 3 次 $queryRaw 分别对应 additional / space / scanOrdering
    prisma.$queryRaw
      // record 0: additional=50000(500元), record 1: additional=30000(300元)
      .mockResolvedValueOnce([
        { idx: 1, total: BigInt(50000) },
        { idx: 2, total: BigInt(30000) },
      ])
      // record 0: space(timeCost+itemsCost)=65000(650元), record 1: space=0
      .mockResolvedValueOnce([
        { idx: 1, total: BigInt(65000) },
        { idx: 2, total: BigInt(0) },
      ])
      // record 0: scanOrdering=0, record 1: scanOrdering=10000(100元)
      .mockResolvedValueOnce([
        { idx: 1, total: BigInt(0) },
        { idx: 2, total: BigInt(10000) },
      ]);

    const result = await service.countRecordRevenueBatch(100, shiftRanges);

    // record 0: 500 + 650 = 1150
    expect(result[0]).toBe(1150);
    // record 1: 300 + 100 = 400
    expect(result[1]).toBe(400);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(3);
  });

  it('所有营收为 null/0 时返回 0', async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([
        { idx: 1, total: BigInt(0) },
        { idx: 2, total: BigInt(0) },
      ])
      .mockResolvedValueOnce([
        { idx: 1, total: BigInt(0) },
        { idx: 2, total: BigInt(0) },
      ])
      .mockResolvedValueOnce([
        { idx: 1, total: BigInt(0) },
        { idx: 2, total: BigInt(0) },
      ]);

    const result = await service.countRecordRevenueBatch(100, shiftRanges);
    expect(result[0]).toBe(0);
    expect(result[1]).toBe(0);
  });
});

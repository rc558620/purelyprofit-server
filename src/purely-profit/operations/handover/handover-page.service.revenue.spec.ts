import { EmployeeShiftType, Prisma, SalesPaymentMethod } from '@prisma/client';
import {
  LATE_SHIFT_EMPLOYEE_A,
  MORNING_SHIFT_EMPLOYEE_A,
  setupHandoverPageSpec,
} from './handover-page.spec-helpers';
import { buildShiftDateRange } from './handover.shared';

describe('HandoverPageService - 收银统计与支付方式', () => {
  const ctx = setupHandoverPageSpec();
  const { prismaService, subAccountUser, mockEmptySaleOrderItems } = ctx;

  it('营业收入应统计 additional 本班次收入', async () => {
    mockEmptySaleOrderItems();

    const result = await ctx.service.getHandoverPage(subAccountUser, {
      shiftType: EmployeeShiftType.morning,
    });

    expect(prismaService.saleOrder.aggregate).toHaveBeenCalledWith({
      where: expect.objectContaining({
        storeId: 100,
        operatorStaffId: 2,
        spaceSession: { is: null },
      }),
      _sum: { totalRevenue: true },
    });
    expect(result.revenueSummary).toMatchObject({
      additionalRevenue: 988,
      spaceRevenue: 9.25,
      refundAmount: 0,
      totalRevenue: 997.25,
      orderCount: 3,
    });
  });

  it('班次超时未交班时 additional 收入仍应统计到当前交班页班次', async () => {
    ctx.setSystemTime('2026-06-02T18:30:00');
    ctx.mockShiftLists({
      defaultShifts: [MORNING_SHIFT_EMPLOYEE_A],
      shiftsByEmployeeId: {
        20: [MORNING_SHIFT_EMPLOYEE_A],
      },
    });
    ctx.mockHandoverRecordCounts({
      handoverAt: () => 0,
      createdAt: () => 0,
    });
    mockEmptySaleOrderItems();
    prismaService.saleOrder.aggregate.mockImplementation(({ where }) => {
      if (where?.spaceSession?.is === null) {
        return Promise.resolve({
          _sum: { totalRevenue: new Prisma.Decimal('66.80') },
        });
      }

      return Promise.resolve({
        _sum: { totalRevenue: null },
      });
    });
    prismaService.saleOrder.count.mockResolvedValue(1);
    prismaService.spaceSession.aggregate.mockResolvedValue({
      _sum: { timeCost: null },
    });

    const result = await ctx.service.getHandoverPage(subAccountUser, {});
    const expectedShiftRange = buildShiftDateRange(
      MORNING_SHIFT_EMPLOYEE_A.startTime,
      MORNING_SHIFT_EMPLOYEE_A.endTime,
      MORNING_SHIFT_EMPLOYEE_A.date,
    );
    const expectedShiftEndAt = new Date('2026-06-02T18:30:00');

    expect(result.selectedShiftType).toBe(EmployeeShiftType.morning);
    expect(result.revenueSummary).toMatchObject({
      additionalRevenue: 66.8,
      spaceRevenue: 0,
      refundAmount: 0,
      totalRevenue: 66.8,
      orderCount: 1,
    });
    expect(prismaService.saleOrder.aggregate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          storeId: 100,
          operatorStaffId: 2,
          date: {
            gte: expectedShiftRange.startAt,
            lte: expectedShiftEndAt,
          },
          spaceSession: { is: null },
        }),
      }),
    );
    expect(prismaService.saleOrder.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        storeId: 100,
        operatorStaffId: 2,
        date: {
          gte: expectedShiftRange.startAt,
          lte: expectedShiftEndAt,
        },
      }),
    });
  });
  it('班次超时未交班时 space-management 结账收入仍应统计到当前交班页班次', async () => {
    ctx.setSystemTime('2026-06-02T18:30:00');
    ctx.mockShiftLists({
      defaultShifts: [MORNING_SHIFT_EMPLOYEE_A],
      shiftsByEmployeeId: {
        20: [MORNING_SHIFT_EMPLOYEE_A],
      },
    });
    ctx.mockHandoverRecordCounts({
      handoverAt: () => 0,
      createdAt: () => 0,
    });
    mockEmptySaleOrderItems();
    prismaService.saleOrder.aggregate.mockResolvedValue({
      _sum: { totalRevenue: null },
    });
    prismaService.saleOrder.count.mockResolvedValue(1);
    prismaService.spaceSession.aggregate.mockResolvedValue({
      _sum: { timeCost: new Prisma.Decimal('88.60') },
    });

    const result = await ctx.service.getHandoverPage(subAccountUser, {});
    const expectedShiftRange = buildShiftDateRange(
      MORNING_SHIFT_EMPLOYEE_A.startTime,
      MORNING_SHIFT_EMPLOYEE_A.endTime,
      MORNING_SHIFT_EMPLOYEE_A.date,
    );
    const expectedShiftEndAt = new Date('2026-06-02T18:30:00');

    expect(result.selectedShiftType).toBe(EmployeeShiftType.morning);
    expect(result.revenueSummary).toMatchObject({
      additionalRevenue: 0,
      spaceRevenue: 88.6,
      refundAmount: 0,
      totalRevenue: 88.6,
      orderCount: 1,
    });
    expect(prismaService.spaceSession.aggregate).toHaveBeenCalledWith({
      where: {
        storeId: 100,
        status: 'settled',
        endTime: {
          gte: expectedShiftRange.startAt,
          lte: expectedShiftEndAt,
        },
      },
      _sum: { timeCost: true },
    });
    expect(prismaService.saleOrder.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        storeId: 100,
        operatorStaffId: 2,
        date: {
          gte: expectedShiftRange.startAt,
          lte: expectedShiftEndAt,
        },
      }),
    });
  });
  it('切到存在后续班次的超时班次时收入范围应截断到下一班开始时刻', async () => {
    ctx.setSystemTime('2026-06-05T20:00:00');
    const firstShift = ctx.createShiftRecord({
      id: 701,
      employeeId: 20,
      employeeName: '收银员1',
      shiftType: EmployeeShiftType.custom,
      shiftName: '收银员1',
      date: new Date('2026-06-05T00:00:00.000Z'),
      startTime: '16:01',
      endTime: '17:03',
      createdAt: new Date('2026-06-05T15:55:00.000Z'),
    });
    const secondShift = ctx.createShiftRecord({
      id: 702,
      employeeId: 30,
      employeeName: '收银员2',
      shiftType: EmployeeShiftType.custom,
      shiftName: '收银员2',
      date: new Date('2026-06-05T00:00:00.000Z'),
      startTime: '17:06',
      endTime: '17:10',
      createdAt: new Date('2026-06-05T17:00:00.000Z'),
    });
    const thirdShift = ctx.createShiftRecord({
      id: 703,
      employeeId: 40,
      employeeName: '收银员3',
      shiftType: EmployeeShiftType.custom,
      shiftName: '收银员3',
      date: new Date('2026-06-05T00:00:00.000Z'),
      startTime: '17:11',
      endTime: '17:15',
      createdAt: new Date('2026-06-05T17:05:00.000Z'),
    });
    ctx.mockShiftLists({
      defaultShifts: [firstShift, secondShift, thirdShift],
      shiftsByEmployeeId: {
        20: [firstShift],
      },
    });
    prismaService.storeHandoverRecord.count.mockImplementation(({ where }) => {
      const snapshotCondition = Array.isArray(where?.OR)
        ? where.OR.find((item) => item?.employeeShiftIdSnapshot)
        : null;
      return Promise.resolve(snapshotCondition?.employeeShiftIdSnapshot === 701 ? 1 : 0);
    });
    mockEmptySaleOrderItems();
    prismaService.saleOrder.aggregate.mockResolvedValue({
      _sum: { totalRevenue: null },
    });
    prismaService.saleOrder.count.mockResolvedValue(0);
    prismaService.spaceSession.aggregate.mockResolvedValue({
      _sum: { timeCost: null },
    });

    const result = await ctx.service.getHandoverPage(subAccountUser, {});

    expect(result.shiftInfo).toMatchObject({
      operatorName: '收银员2',
      startTime: '17:06',
      endTime: '17:10',
    });
    expect(result.receiverName).toBe('收银员3');
    expect(prismaService.spaceSession.aggregate).toHaveBeenCalledWith({
      where: {
        storeId: 100,
        status: 'settled',
        endTime: {
          gte: new Date(2026, 5, 5, 17, 6, 0),
          lte: new Date(2026, 5, 5, 17, 11, 0),
        },
      },
      _sum: { timeCost: true },
    });
    expect(result.revenueSummary).toMatchObject({
      additionalRevenue: 0,
      spaceRevenue: 0,
      totalRevenue: 0,
      orderCount: 0,
    });
  });

  it('收款方式明细只统计收款并按收款总额计算占比', async () => {
    prismaService.saleOrderItem.findMany.mockResolvedValue([
      {
        id: 1,
        productName: '米线',
        salePrice: new Prisma.Decimal('300.00'),
        quantity: 1,
        product: null,
        order: {
          id: 201,
          date: new Date('2026-06-04T04:00:00.000Z'),
          paymentMethod: SalesPaymentMethod.cash,
          spaceSession: null,
        },
      },
      {
        id: 2,
        productName: '果茶',
        salePrice: new Prisma.Decimal('100.00'),
        quantity: 1,
        product: null,
        order: {
          id: 202,
          date: new Date('2026-06-04T04:05:00.000Z'),
          paymentMethod: SalesPaymentMethod.wechat,
          spaceSession: null,
        },
      },
      {
        id: 3,
        productName: '预付抵扣',
        salePrice: new Prisma.Decimal('-20.00'),
        quantity: 1,
        product: null,
        order: {
          id: 203,
          date: new Date('2026-06-04T04:10:00.000Z'),
          paymentMethod: SalesPaymentMethod.alipay,
          spaceSession: {
            prepaidPaymentMethod: SalesPaymentMethod.card,
            renewRecords: [],
          },
        },
      },
    ]);

    const result = await ctx.service.getHandoverPage(subAccountUser, {
      shiftType: EmployeeShiftType.morning,
    });

    expect(prismaService.saleOrderItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          storeId: 100,
          order: expect.objectContaining({
            operatorStaffId: 2,
          }),
        }),
      }),
    );
    expect(result.paymentItems).toEqual([
      expect.objectContaining({
        method: SalesPaymentMethod.cash,
        amount: 300,
        ratio: 0.71,
      }),
      expect.objectContaining({
        method: SalesPaymentMethod.wechat,
        amount: 100,
        ratio: 0.24,
      }),
      expect.objectContaining({
        method: SalesPaymentMethod.card,
        amount: 20,
        ratio: 0.05,
      }),
    ]);
  });

  it('空间管理退款应回传 refundAmount 并展示在 orderItems 中', async () => {
    prismaService.saleOrderItem.findMany.mockResolvedValue([
      {
        id: 3,
        productName: '台位费（1分钟）',
        salePrice: new Prisma.Decimal('11.10'),
        quantity: 1,
        product: null,
        order: {
          id: 88,
          date: new Date('2026-06-04T04:21:00.000Z'),
          paymentMethod: SalesPaymentMethod.alipay,
          spaceSession: {
            prepaidPaymentMethod: SalesPaymentMethod.wechat,
            renewRecords: [],
          },
        },
      },
    ]);
    prismaService.saleOrder.findMany.mockResolvedValue([
      {
        id: 88,
        date: new Date('2026-06-04T04:21:00.000Z'),
        paymentMethod: SalesPaymentMethod.alipay,
        totalRevenue: new Prisma.Decimal('-547.60'),
        spaceSession: {
          space: {
            name: '很多事',
          },
        },
      },
    ]);
    prismaService.saleOrder.aggregate
      .mockResolvedValueOnce({
        _sum: { totalRevenue: new Prisma.Decimal('988.00') },
      })
      .mockResolvedValueOnce({
        _sum: { totalRevenue: new Prisma.Decimal('-547.60') },
      });

    const result = await ctx.service.getHandoverPage(subAccountUser, {
      shiftType: EmployeeShiftType.morning,
    });

    expect(result.revenueSummary).toMatchObject({
      additionalRevenue: 988,
      spaceRevenue: 9.25,
      refundAmount: 547.6,
      totalRevenue: 449.65,
    });
    expect(result.orderItems[0]).toMatchObject({
      id: 'refund-order-88',
      productName: '很多事',
      quantity: 1,
      totalRevenue: -547.6,
      paymentLabel: '支付宝退款',
      paymentColor: '#1677ff',
      currentStock: null,
      stockUnit: null,
    });
    expect(result.orderItems[1]).toMatchObject({
      id: '3',
      productName: '台位费（1分钟）',
      totalRevenue: 11.1,
      paymentLabel: '支付宝',
      paymentColor: '#1677ff',
    });
    expect(result.paymentItems).toEqual([
      expect.objectContaining({
        method: SalesPaymentMethod.alipay,
        amount: 11.1,
        ratio: 1,
      }),
    ]);
    expect(prismaService.saleOrder.findMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        storeId: 100,
        operatorStaffId: 2,
        totalRevenue: { lt: 0 },
        spaceSession: { isNot: null },
      }),
      select: {
        id: true,
        date: true,
        paymentMethod: true,
        totalRevenue: true,
        spaceSession: {
          select: {
            space: {
              select: {
                name: true,
              },
            },
          },
        },
      },
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      take: 50,
    });
    expect(prismaService.saleOrder.aggregate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          storeId: 100,
          operatorStaffId: 2,
          totalRevenue: { lt: 0 },
          spaceSession: { isNot: null },
        }),
        _sum: { totalRevenue: true },
      }),
    );
  });

  it('预付抵扣明细应展示开台时的支付方式', async () => {
    prismaService.saleOrderItem.findMany.mockResolvedValue([
      {
        id: 1,
        productName: '预付抵扣',
        salePrice: new Prisma.Decimal('-666.00'),
        quantity: 1,
        product: null,
        order: {
          id: 101,
          date: new Date('2026-06-02T10:06:00.000Z'),
          paymentMethod: SalesPaymentMethod.alipay,
          spaceSession: {
            prepaidPaymentMethod: SalesPaymentMethod.wechat,
            renewRecords: [],
          },
        },
      },
    ]);

    const result = await ctx.service.getHandoverPage(subAccountUser, {
      shiftType: EmployeeShiftType.morning,
    });

    expect(result.orderItems).toHaveLength(1);
    expect(result.orderItems[0]).toMatchObject({
      productName: '预付抵扣',
      totalRevenue: -666,
      paymentLabel: '微信',
      paymentColor: '#22c55e',
    });
    expect(result.paymentItems).toEqual([
      expect.objectContaining({
        method: SalesPaymentMethod.wechat,
        amount: 666,
        ratio: 1,
      }),
    ]);
  });

  it('普通销售明细仍使用销售单支付方式', async () => {
    prismaService.saleOrderItem.findMany.mockResolvedValue([
      {
        id: 2,
        productName: '台位费（1分钟）',
        salePrice: new Prisma.Decimal('9.25'),
        quantity: 1,
        product: null,
        order: {
          id: 102,
          date: new Date('2026-06-02T10:06:00.000Z'),
          paymentMethod: SalesPaymentMethod.alipay,
          spaceSession: {
            prepaidPaymentMethod: SalesPaymentMethod.wechat,
            renewRecords: [],
          },
        },
      },
    ]);

    const result = await ctx.service.getHandoverPage(subAccountUser, {
      shiftType: EmployeeShiftType.morning,
    });

    expect(result.orderItems[0]).toMatchObject({
      productName: '台位费（1分钟）',
      totalRevenue: 9.25,
      paymentLabel: '支付宝',
      paymentColor: '#1677ff',
    });
  });
});

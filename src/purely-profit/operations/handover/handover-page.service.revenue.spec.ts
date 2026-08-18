import { EmployeeShiftType, Prisma, SalesPaymentMethod } from '@prisma/client';
import {
  MORNING_SHIFT_EMPLOYEE_A,
  setupHandoverPageSpec,
} from './handover-page.spec-helpers';
import { buildShiftDateRange } from './handover.shared';
import { aDateOrObject } from '../../../spec-matchers';

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
        date: aDateOrObject,
        spaceSession: { is: null },
      }),
      _sum: { totalRevenue: true },
    });
    expect(result.revenueSummary).toMatchObject({
      additionalRevenue: 978.75,
      spaceRevenue: 9.25,
      refundAmount: 0,
      totalRevenue: 988,
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
      // 检测 additionalRevenue 查询（仅非空间会话订单）
      if (where?.spaceSession?.is === null) {
        return Promise.resolve({
          _sum: { totalRevenue: new Prisma.Decimal('6680') },
        });
      }

      return Promise.resolve({
        _sum: { totalRevenue: null },
      });
    });
    prismaService.saleOrder.count.mockResolvedValue(1);
    prismaService.spaceSession.aggregate.mockResolvedValue({
      _sum: { timeCost: null, itemsCost: null },
    });
    prismaService.spaceSession.findMany.mockResolvedValue([]);

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
          date: {
            gte: expectedShiftRange.startAt,
            lte: expectedShiftEndAt,
          },
          spaceSession: { is: null },
        }),
      }),
    );
    expect(prismaService.saleOrder.count).toHaveBeenCalledWith({
      where: {
        storeId: 100,
        date: {
          gte: expectedShiftRange.startAt,
          lte: expectedShiftEndAt,
        },
      },
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
      _sum: {
        timeCost: new Prisma.Decimal('8860'),
        itemsCost: new Prisma.Decimal('0'),
      },
    });
    prismaService.spaceSession.findMany.mockResolvedValue([]);

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
      _sum: { timeCost: true, itemsCost: true },
    });
    expect(prismaService.saleOrder.count).toHaveBeenCalledWith({
      where: {
        storeId: 100,
        date: {
          gte: expectedShiftRange.startAt,
          lte: expectedShiftEndAt,
        },
      },
    });
  });
  it('切到存在后续班次的超时班次时收入仍应继续累计到当前交班时刻', async () => {
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
        ? where.OR.find(
            (item: Record<string, unknown>) => item?.employeeShiftIdSnapshot,
          )
        : null;
      return Promise.resolve(
        snapshotCondition?.employeeShiftIdSnapshot === 701 ? 1 : 0,
      );
    });
    // loadHandedOverShiftIds 使用 findMany 批量加载已交班记录
    prismaService.storeHandoverRecord.findMany.mockResolvedValue([
      {
        employeeShiftIdSnapshot: 701,
        fromEmployeeId: 20,
        handoverAt: null,
        createdAt: new Date(0),
      },
    ] as never);
    mockEmptySaleOrderItems();
    prismaService.employee.findUnique.mockResolvedValueOnce(
      ctx.createEmployeeProfile({
        name: '收银员2',
        linkedStaffId: 30,
      }),
    );
    prismaService.saleOrder.aggregate.mockResolvedValue({
      _sum: { totalRevenue: null },
    });
    prismaService.saleOrder.count.mockResolvedValue(0);
    prismaService.spaceSession.aggregate.mockResolvedValue({
      _sum: { timeCost: null, itemsCost: null },
    });
    prismaService.spaceSession.findMany.mockResolvedValue([]);

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
          lte: new Date(2026, 5, 5, 20, 0, 0),
        },
      },
      _sum: { timeCost: true, itemsCost: true },
    });
    expect(prismaService.saleOrder.aggregate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          storeId: 100,
          date: {
            gte: new Date(2026, 5, 5, 17, 6, 0),
            lte: new Date(2026, 5, 5, 20, 0, 0),
          },
          spaceSession: { is: null },
        }),
      }),
    );
  });

  it('上一班延迟交班后下一班应从实际交接时刻开始初始化', async () => {
    ctx.setSystemTime('2026-06-05T17:14:30');
    const firstShift = ctx.createShiftRecord({
      id: 711,
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
      id: 712,
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
      id: 713,
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
        ? where.OR.find(
            (item: Record<string, unknown>) => item?.employeeShiftIdSnapshot,
          )
        : null;
      return Promise.resolve(
        snapshotCondition?.employeeShiftIdSnapshot === 711 ? 1 : 0,
      );
    });
    // loadHandedOverShiftIds 使用 findMany 批量加载已交班记录
    prismaService.storeHandoverRecord.findMany.mockResolvedValue([
      {
        employeeShiftIdSnapshot: 711,
        fromEmployeeId: 20,
        handoverAt: null,
        createdAt: new Date(0),
      },
    ] as never);
    prismaService.storeHandoverRecord.findFirst.mockResolvedValue({
      handoverAt: new Date(2026, 5, 5, 17, 14, 0),
    });
    mockEmptySaleOrderItems();
    prismaService.employee.findUnique.mockResolvedValueOnce(
      ctx.createEmployeeProfile({
        name: '收银员2',
        linkedStaffId: 30,
      }),
    );
    prismaService.saleOrder.aggregate.mockResolvedValue({
      _sum: { totalRevenue: null },
    });
    prismaService.saleOrder.count.mockResolvedValue(0);
    prismaService.spaceSession.aggregate.mockResolvedValue({
      _sum: { timeCost: null, itemsCost: null },
    });
    prismaService.spaceSession.findMany.mockResolvedValue([]);

    const result = await ctx.service.getHandoverPage(subAccountUser, {});

    expect(result.shiftInfo).toMatchObject({
      operatorName: '收银员2',
      startTime: '17:06',
      endTime: '17:10',
    });
    expect(result.revenueSummary).toMatchObject({
      additionalRevenue: 0,
      spaceRevenue: 0,
      refundAmount: 0,
      totalRevenue: 0,
      orderCount: 0,
    });
    expect(prismaService.storeHandoverRecord.findFirst).toHaveBeenCalledWith({
      where: {
        storeId: 100,
        status: 'completed',
        handoverAt: {
          gt: new Date(2026, 5, 5, 17, 6, 0),
          lte: new Date(2026, 5, 5, 17, 14, 30),
        },
      },
      select: {
        handoverAt: true,
      },
      orderBy: [{ handoverAt: 'desc' }, { id: 'desc' }],
    });
    expect(prismaService.spaceSession.aggregate).toHaveBeenCalledWith({
      where: {
        storeId: 100,
        status: 'settled',
        endTime: {
          gte: new Date(2026, 5, 5, 17, 14, 0),
          lte: new Date(2026, 5, 5, 17, 14, 30),
        },
      },
      _sum: { timeCost: true, itemsCost: true },
    });
    expect(prismaService.saleOrder.aggregate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          storeId: 100,
          date: {
            gte: new Date(2026, 5, 5, 17, 14, 0),
            lte: new Date(2026, 5, 5, 17, 14, 30),
          },
          spaceSession: { is: null },
        }),
      }),
    );
  });

  it('收款方式明细只统计收款并按收款总额计算占比', async () => {
    prismaService.saleOrderItem.findMany.mockResolvedValue([
      {
        id: 1,
        productName: '米线',
        salePrice: new Prisma.Decimal('30000'),
        quantity: 1,
        product: null,
        order: {
          id: 201,
          date: new Date('2026-06-04T04:00:00.000Z'),
          paymentMethod: SalesPaymentMethod.cash,
          operatorNameSnapshot: null,
          operatorStaff: null,
          spaceSession: null,
        },
      },
      {
        id: 2,
        productName: '果茶',
        salePrice: new Prisma.Decimal('10000'),
        quantity: 1,
        product: null,
        order: {
          id: 202,
          date: new Date('2026-06-04T04:05:00.000Z'),
          paymentMethod: SalesPaymentMethod.wechat,
          operatorNameSnapshot: null,
          operatorStaff: null,
          spaceSession: null,
        },
      },
      {
        id: 3,
        productName: '预付款',
        salePrice: new Prisma.Decimal('-2000'),
        quantity: 1,
        product: null,
        order: {
          id: 203,
          date: new Date('2026-06-04T04:10:00.000Z'),
          paymentMethod: SalesPaymentMethod.alipay,
          operatorNameSnapshot: null,
          operatorStaff: null,
          spaceSession: {
            prepaidPaymentMethod: SalesPaymentMethod.card,
            sessionRenewRecords: [],
            space: {
              name: '大厅A01',
            },
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
            storeId: 100,
            date: aDateOrObject,
          }),
        }),
      }),
    );
    expect(result.paymentItems).toEqual([
      expect.objectContaining({
        method: SalesPaymentMethod.cash,
        amount: 300,
        ratio: 71,
      }),
      expect.objectContaining({
        method: SalesPaymentMethod.wechat,
        amount: 100,
        ratio: 24,
      }),
      expect.objectContaining({
        method: SalesPaymentMethod.card,
        amount: 20,
        ratio: 5,
      }),
    ]);
  });

  it('空间管理退款应回传 refundAmount 并展示在 orderItems 中', async () => {
    prismaService.saleOrderItem.findMany.mockResolvedValue([
      {
        id: 3,
        productName: '台位费（1分钟）',
        salePrice: new Prisma.Decimal('1110'),
        quantity: 1,
        product: null,
        order: {
          id: 88,
          date: new Date('2026-06-04T04:21:00.000Z'),
          paymentMethod: SalesPaymentMethod.alipay,
          operatorNameSnapshot: null,
          operatorStaff: null,
          spaceSession: {
            prepaidPaymentMethod: SalesPaymentMethod.wechat,
            sessionRenewRecords: [],
            space: {
              name: '大厅A02',
            },
          },
        },
      },
    ]);
    // 退款展示项现在从 SpaceSession 数据构建，saleOrder.findMany 不再返回退款订单
    prismaService.saleOrder.findMany.mockResolvedValue([]);
    // 退款金额现在从 SpaceSession 数据计算：prepaidAmount > consumption 时的差额
    prismaService.spaceSession.findMany.mockResolvedValue([
      {
        id: 88,
        timeCost: 925,
        itemsCost: 0,
        prepaidAmount: 54760,
        endTime: new Date('2026-06-04T04:21:00.000Z'),
        space: { name: '很多事' },
        saleOrder: {
          paymentMethod: 'alipay',
          date: new Date('2026-06-04T04:21:00.000Z'),
          operatorNameSnapshot: null,
          operatorStaff: null,
        },
        sessionRenewRecords: [],
      },
    ]);

    const result = await ctx.service.getHandoverPage(subAccountUser, {
      shiftType: EmployeeShiftType.morning,
    });

    // refund = prepaid(547.60) - consumption(9.25) = 538.35
    expect(result.revenueSummary).toMatchObject({
      additionalRevenue: 978.75,
      spaceRevenue: 9.25,
      refundAmount: 538.35,
      totalRevenue: 988,
    });
    expect(result.orderItems[0]).toMatchObject({
      id: 'refund-session-88',
      productName: '很多事 · 退款',
      quantity: 1,
      totalRevenue: -538.35, // prepaid(547.60) - consumption(9.25) = 538.35
      paymentLabel: '支付宝退款',
      paymentColor: '#1677ff',
      operatorName: '空间自动结账',
      currentStock: null,
      stockUnit: null,
    });

    expect(result.orderItems[1]).toMatchObject({
      id: '3',
      productName: '大厅A02 · 台位费（1分钟）',
      totalRevenue: 11.1,
      paymentLabel: '支付宝',
      paymentColor: '#1677ff',
      operatorName: '空间自动结账',
    });

    expect(result.paymentItems).toEqual([
      expect.objectContaining({
        method: SalesPaymentMethod.alipay,
        amount: 11.1,
        ratio: 100,
      }),
    ]);
  });

  it('自动结账退款即使归属到待交班员工也应展示在当前交班页', async () => {
    prismaService.saleOrderItem.findMany.mockResolvedValue([]);
    prismaService.saleOrder.findMany.mockResolvedValue([
      {
        id: 99,
        date: new Date('2026-06-02T18:55:00.000Z'),
        paymentMethod: SalesPaymentMethod.wechat,
        totalRevenue: new Prisma.Decimal('-8880'),
        operatorNameSnapshot: null,
        operatorStaff: null,
        spaceSession: {
          space: {
            name: 'A01',
          },
        },
      },
    ]);
    prismaService.saleOrder.count.mockResolvedValue(0);
    prismaService.spaceSession.aggregate.mockResolvedValue({
      _sum: { timeCost: null, itemsCost: null },
    });
    // 退款金额现在从 SpaceSession 数据计算：prepaidAmount > consumption 时的差额
    prismaService.spaceSession.findMany.mockResolvedValue([
      {
        id: 99,
        timeCost: null,
        itemsCost: 0,
        prepaidAmount: 8880,
        endTime: new Date('2026-06-02T18:55:00.000Z'),
        space: { name: 'A01' },
        saleOrder: {
          paymentMethod: 'wechat',
          date: new Date('2026-06-02T18:55:00.000Z'),
          operatorNameSnapshot: null,
          operatorStaff: null,
        },
        sessionRenewRecords: [],
      },
    ]);
    prismaService.saleOrder.aggregate.mockResolvedValueOnce({
      _sum: { totalRevenue: null },
    });

    const result = await ctx.service.getHandoverPage(subAccountUser, {
      shiftType: EmployeeShiftType.morning,
    });

    expect(result.revenueSummary).toMatchObject({
      additionalRevenue: 0,
      spaceRevenue: 0,
      refundAmount: 88.8,
      totalRevenue: 0,
    });
    expect(result.orderItems[0]).toMatchObject({
      id: 'refund-session-99',
      productName: 'A01 · 退款',
      totalRevenue: -88.8,
      paymentLabel: '微信退款',
      operatorName: '空间自动结账',
    });
  });

  it('预付款明细应展示开台时的支付方式', async () => {
    prismaService.saleOrderItem.findMany.mockResolvedValue([
      {
        id: 1,
        productName: '预付款',
        salePrice: new Prisma.Decimal('-66600'),
        quantity: 1,
        product: null,
        order: {
          id: 101,
          date: new Date('2026-06-02T10:06:00.000Z'),
          paymentMethod: SalesPaymentMethod.alipay,
          operatorNameSnapshot: null,
          operatorStaff: null,
          spaceSession: {
            prepaidPaymentMethod: SalesPaymentMethod.wechat,
            sessionRenewRecords: [],
            space: {
              name: '大厅A03',
            },
          },
        },
      },
    ]);

    const result = await ctx.service.getHandoverPage(subAccountUser, {
      shiftType: EmployeeShiftType.morning,
    });

    expect(result.orderItems).toHaveLength(1);
    expect(result.orderItems[0]).toMatchObject({
      productName: '大厅A03 · 预付款',
      totalRevenue: 666, // 预付款 = 已收预付款，展示正数
      paymentLabel: '微信',
      paymentColor: '#22c55e',
      operatorName: '空间自动结账',
    });

    expect(result.paymentItems).toEqual([
      expect.objectContaining({
        method: SalesPaymentMethod.wechat,
        amount: 666,
        ratio: 100,
      }),
    ]);
  });

  it('普通销售明细仍使用销售单支付方式', async () => {
    prismaService.saleOrderItem.findMany.mockResolvedValue([
      {
        id: 2,
        productName: '台位费（1分钟）',
        salePrice: new Prisma.Decimal('925'),
        quantity: 1,
        product: null,
        order: {
          id: 102,
          date: new Date('2026-06-02T10:06:00.000Z'),
          paymentMethod: SalesPaymentMethod.alipay,
          operatorNameSnapshot: null,
          operatorStaff: null,
          spaceSession: {
            prepaidPaymentMethod: SalesPaymentMethod.wechat,
            sessionRenewRecords: [],
            space: {
              name: '大厅A04',
            },
          },
        },
      },
    ]);

    const result = await ctx.service.getHandoverPage(subAccountUser, {
      shiftType: EmployeeShiftType.morning,
    });

    expect(result.orderItems[0]).toMatchObject({
      productName: '大厅A04 · 台位费（1分钟）',
      totalRevenue: 9.25,
      paymentLabel: '支付宝',
      paymentColor: '#1677ff',
      operatorName: '空间自动结账',
    });
  });

  it('录入单子退款时下单行合并为 1 行（整单金额）与退款行组成 2 行', async () => {
    // 录入单子（manualEntry=true）同一订单 3 个商品行 + 1 条退款
    prismaService.saleOrderItem.findMany.mockResolvedValue([
      {
        id: 967,
        productName: '酸菜肉丝面',
        salePrice: new Prisma.Decimal('1212'),
        quantity: 1,
        product: { stock: 9999, unit: '份' },
        order: {
          id: 593,
          date: new Date('2026-08-16T02:25:48.045Z'),
          paymentMethod: SalesPaymentMethod.platform,
          manualEntry: true,
          operatorNameSnapshot: 'f0rest2012',
          operatorStaff: null,
          scanOrder: null,
          spaceSession: null,
        },
      },
      {
        id: 968,
        productName: '猪肉白菜水饺（12只）',
        salePrice: new Prisma.Decimal('1077'),
        quantity: 1,
        product: { stock: 9999, unit: '份' },
        order: {
          id: 593,
          date: new Date('2026-08-16T02:25:48.045Z'),
          paymentMethod: SalesPaymentMethod.platform,
          manualEntry: true,
          operatorNameSnapshot: 'f0rest2012',
          operatorStaff: null,
          scanOrder: null,
          spaceSession: null,
        },
      },
      {
        id: 969,
        productName: '重庆小面',
        salePrice: new Prisma.Decimal('1011'),
        quantity: 1,
        product: { stock: 9993, unit: '份' },
        order: {
          id: 593,
          date: new Date('2026-08-16T02:25:48.045Z'),
          paymentMethod: SalesPaymentMethod.platform,
          manualEntry: true,
          operatorNameSnapshot: 'f0rest2012',
          operatorStaff: null,
          scanOrder: null,
          spaceSession: null,
        },
      },
    ]);
    prismaService.saleOrderRefund.findMany.mockResolvedValue([
      {
        id: 92,
        amount: 3300,
        paymentMethod: SalesPaymentMethod.platform,
        refundedAt: new Date('2026-08-16T02:26:07.405Z'),
        saleOrder: {
          id: 593,
          date: new Date('2026-08-16T02:25:48.045Z'),
          manualEntry: true,
          operatorNameSnapshot: 'f0rest2012',
          operatorStaff: null,
          scanOrder: null,
          items: [
            {
              productName: '酸菜肉丝面',
              product: { stock: 9999, unit: '份' },
            },
          ],
        },
      },
    ]);

    const result = await ctx.service.getHandoverPage(subAccountUser, {
      shiftType: EmployeeShiftType.morning,
    });

    // 3 个商品行合并为 1 个下单行（整单金额），与退款行组成 2 行
    expect(result.orderItems).toHaveLength(2);
    // 退款行：负数金额 + 有库存
    expect(result.orderItems[0]).toMatchObject({
      id: 'scan-refund-92',
      productName: '堂食 · 酸菜肉丝面',
      quantity: 1,
      totalRevenue: -33,
      paymentLabel: '退回平台结算',
      currentStock: 9999,
    });
    // 下单行：第一条商品名 + 整单金额 + 库存列不展示（isRefundedOrder）
    expect(result.orderItems[1]).toMatchObject({
      id: 'manual-entry-593',
      productName: '堂食 · 酸菜肉丝面',
      quantity: 1,
      totalRevenue: 33,
      paymentLabel: '平台结算',
      isRefundedOrder: true,
    });
  });
});

import { EmployeeShiftType } from '@prisma/client';
import {
  LATE_SHIFT_CASHIER_2,
  LATE_SHIFT_EMPLOYEE_A,
  MORNING_SHIFT_EMPLOYEE_A,
  setupHandoverPageSpec,
} from './handover-page.spec-helpers';

describe('HandoverPageService - 已交班后切班逻辑', () => {
  const ctx = setupHandoverPageSpec();
  const {
    prismaService,
    subAccountUser,
    createEmployeeProfile,
    setSystemTime,
    mockShiftLists,
    mockZeroSummaryAggregates,
    mockHandoverRecordCounts,
  } = ctx;

  it('交班完成后应初始化到下一班且原员工不可继续操作', async () => {
    setSystemTime('2026-06-02T18:00:00');
    prismaService.employeeShift.findFirst.mockResolvedValueOnce(
      MORNING_SHIFT_EMPLOYEE_A,
    );
    mockShiftLists({
      defaultShifts: [MORNING_SHIFT_EMPLOYEE_A, LATE_SHIFT_CASHIER_2],
      shiftsByEmployeeId: {
        20: [MORNING_SHIFT_EMPLOYEE_A],
      },
    });
    prismaService.storeHandoverRecord.count.mockImplementation(({ where }) => {
      const hasCreatedAtFallback = Array.isArray(where?.OR)
        ? where.OR.some((item) => item?.createdAt?.gte instanceof Date)
        : false;
      if (hasCreatedAtFallback && where?.fromEmployeeId === 20) {
        return Promise.resolve(1);
      }
      return Promise.resolve(0);
    });
    prismaService.employee.findUnique.mockResolvedValueOnce(
      createEmployeeProfile({ linkedStaffId: 101 }),
    );
    mockZeroSummaryAggregates();

    const result = await ctx.service.getHandoverPage(subAccountUser, {
      shiftType: EmployeeShiftType.morning,
    });

    expect(result.selectedShiftType).toBe(EmployeeShiftType.late);
    expect(result.shiftInfo).toMatchObject({
      shiftType: EmployeeShiftType.late,
      startTime: '17:00',
      endTime: '23:00',
      operatorName: '收银员2',
    });
    expect(result.canOperate).toBe(false);
    expect(result.operationBlockedReason).toBe(
      '当前班次不属于该收银员，暂不允许操作',
    );
  });

  it('当前班次已交班时应自动切换到下一班次并重新初始化数据', async () => {
    setSystemTime('2026-06-02T10:00:00');
    prismaService.employeeShift.findMany.mockResolvedValue([
      MORNING_SHIFT_EMPLOYEE_A,
      LATE_SHIFT_EMPLOYEE_A,
    ]);
    mockHandoverRecordCounts({
      handoverAt: (startAt) => (startAt.getHours() === 9 ? 1 : 0),
      createdAt: () => 1,
    });
    mockZeroSummaryAggregates();

    const result = await ctx.service.getHandoverPage(subAccountUser, {});

    expect(result.selectedShiftType).toBe(EmployeeShiftType.late);
    expect(result.shiftInfo).toMatchObject({
      shiftType: EmployeeShiftType.late,
      startTime: '17:00',
      endTime: '23:00',
      operatorName: '员工A',
    });
    const shiftedAt = new Date(result.shiftInfo.shiftReferenceAt);
    expect(shiftedAt.getFullYear()).toBe(2026);
    expect(shiftedAt.getMonth()).toBe(5);
    expect(shiftedAt.getDate()).toBe(2);
    expect(shiftedAt.getHours()).toBe(17);
    expect(shiftedAt.getMinutes()).toBe(0);
    expect(result.revenueSummary).toMatchObject({
      additionalRevenue: 0,
      spaceRevenue: 0,
      refundAmount: 0,
      totalRevenue: 0,
      orderCount: 0,
    });
  });

  it('收银员查询已完成交班的班次时应自动切换到下一班次', async () => {
    setSystemTime('2026-06-02T10:00:00');
    prismaService.employeeShift.findFirst.mockResolvedValueOnce(
      MORNING_SHIFT_EMPLOYEE_A,
    );
    prismaService.employeeShift.findMany.mockResolvedValue([
      MORNING_SHIFT_EMPLOYEE_A,
      LATE_SHIFT_EMPLOYEE_A,
    ]);
    mockHandoverRecordCounts({
      handoverAt: (startAt) => (startAt.getHours() === 9 ? 1 : 0),
      createdAt: () => 1,
    });
    mockZeroSummaryAggregates();

    const result = await ctx.service.getHandoverPage(subAccountUser, {
      shiftType: EmployeeShiftType.morning,
    });

    expect(result.selectedShiftType).toBe(EmployeeShiftType.late);
    expect(result.canOperate).toBe(true);
  });

  it('同日重排班后应优先展示最新开始的未交班班次', async () => {
    setSystemTime('2026-06-05T16:20:00');
    const earlierShift = ctx.createShiftRecord({
      id: 301,
      employeeId: 20,
      employeeName: '员工A',
      shiftType: EmployeeShiftType.custom,
      shiftName: '旧测试班',
      date: new Date('2026-06-05T00:00:00.000Z'),
      startTime: '10:00',
      endTime: '11:00',
      createdAt: new Date('2026-06-05T09:50:00.000Z'),
    });
    const latestShift = ctx.createShiftRecord({
      id: 302,
      employeeId: 20,
      employeeName: '员工A',
      shiftType: EmployeeShiftType.custom,
      shiftName: '新早班',
      date: new Date('2026-06-05T00:00:00.000Z'),
      startTime: '16:01',
      endTime: '17:03',
      createdAt: new Date('2026-06-05T16:05:00.000Z'),
    });
    prismaService.employeeShift.findMany.mockResolvedValue([
      earlierShift,
      latestShift,
    ]);
    prismaService.storeHandoverRecord.count.mockImplementation(({ where }) => {
      if (Array.isArray(where?.OR) && where.OR.length > 0) {
        const byShiftId = where.OR.find(
          (item) =>
            item &&
            typeof item === 'object' &&
            'employeeShiftIdSnapshot' in item,
        ) as { employeeShiftIdSnapshot?: number | null } | undefined;
        return Promise.resolve(
          byShiftId?.employeeShiftIdSnapshot === 301 ? 1 : 0,
        );
      }
      return Promise.resolve(0);
    });
    mockZeroSummaryAggregates();

    const result = await ctx.service.getHandoverPage(subAccountUser, {});

    expect(result.selectedShiftType).toBe(EmployeeShiftType.custom);
    expect(result.shiftInfo).toMatchObject({
      shiftType: EmployeeShiftType.custom,
      shiftLabel: '新早班',
      startTime: '16:01',
      endTime: '17:03',
    });
  });

  it('快照排班晚于交班记录创建时不应把新排班误判成已交班', async () => {
    setSystemTime('2026-06-05T16:20:00');
    const latestShift = ctx.createShiftRecord({
      id: 302,
      employeeId: 20,
      employeeName: '员工A',
      shiftType: EmployeeShiftType.custom,
      shiftName: '新早班',
      date: new Date('2026-06-05T00:00:00.000Z'),
      startTime: '16:01',
      endTime: '17:03',
      createdAt: new Date('2026-06-05T16:05:00.000Z'),
    });
    prismaService.employeeShift.findMany.mockResolvedValue([latestShift]);
    prismaService.storeHandoverRecord.count.mockResolvedValue(0);
    mockZeroSummaryAggregates();

    const result = await ctx.service.getHandoverPage(subAccountUser, {});

    expect(result.selectedShiftType).toBe(EmployeeShiftType.custom);
    expect(result.shiftInfo).toMatchObject({
      shiftLabel: '新早班',
      startTime: '16:01',
      endTime: '17:03',
    });
    expect(prismaService.storeHandoverRecord.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({
              employeeShiftIdSnapshot: 302,
              createdAt: expect.objectContaining({
                gte: latestShift.createdAt,
              }),
            }),
          ]),
        }),
      }),
    );
  });

  it('存在更早超时未交班班次时应优先回到最早未交班班次', async () => {
    setSystemTime('2026-06-05T17:20:00');
    const firstShift = ctx.createShiftRecord({
      id: 401,
      employeeId: 20,
      employeeName: '员工A',
      shiftType: EmployeeShiftType.custom,
      shiftName: '收银员1',
      date: new Date('2026-06-05T00:00:00.000Z'),
      startTime: '16:01',
      endTime: '17:03',
      createdAt: new Date('2026-06-05T15:55:00.000Z'),
    });
    const secondShift = ctx.createShiftRecord({
      id: 402,
      employeeId: 20,
      employeeName: '员工A',
      shiftType: EmployeeShiftType.custom,
      shiftName: '收银员2',
      date: new Date('2026-06-05T00:00:00.000Z'),
      startTime: '17:06',
      endTime: '17:10',
      createdAt: new Date('2026-06-05T17:00:00.000Z'),
    });
    const thirdShift = ctx.createShiftRecord({
      id: 403,
      employeeId: 20,
      employeeName: '收银员3',
      shiftType: EmployeeShiftType.custom,
      shiftName: '收银员3',
      date: new Date('2026-06-05T00:00:00.000Z'),
      startTime: '17:11',
      endTime: '17:15',
      createdAt: new Date('2026-06-05T17:05:00.000Z'),
    });
    prismaService.employeeShift.findMany.mockResolvedValue([
      firstShift,
      secondShift,
      thirdShift,
    ]);
    prismaService.storeHandoverRecord.count.mockResolvedValue(0);
    mockZeroSummaryAggregates();

    const result = await ctx.service.getHandoverPage(subAccountUser, {});

    expect(result.shiftInfo).toMatchObject({
      operatorName: '员工A',
      startTime: '16:01',
      endTime: '17:03',
    });
  });

  it('16:01 已交班后应切到 17:06–17:10 并指向 17:11 接班', async () => {
    setSystemTime('2026-06-05T17:20:00');
    const firstShift = ctx.createShiftRecord({
      id: 501,
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
      id: 502,
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
      id: 503,
      employeeId: 40,
      employeeName: '收银员3',
      shiftType: EmployeeShiftType.custom,
      shiftName: '收银员3',
      date: new Date('2026-06-05T00:00:00.000Z'),
      startTime: '17:11',
      endTime: '17:15',
      createdAt: new Date('2026-06-05T17:05:00.000Z'),
    });
    prismaService.employeeShift.findMany.mockResolvedValue([
      firstShift,
      secondShift,
      thirdShift,
    ]);
    prismaService.storeHandoverRecord.count.mockImplementation(({ where }) => {
      const snapshotCondition = Array.isArray(where?.OR)
        ? where.OR.find((item) => item?.employeeShiftIdSnapshot)
        : null;
      return Promise.resolve(
        snapshotCondition?.employeeShiftIdSnapshot === 501 ? 1 : 0,
      );
    });
    mockZeroSummaryAggregates();

    const result = await ctx.service.getHandoverPage(subAccountUser, {});

    expect(result.selectedShiftType).toBe(EmployeeShiftType.custom);
    expect(result.shiftInfo).toMatchObject({
      operatorName: '收银员2',
      startTime: '17:06',
      endTime: '17:10',
    });
    expect(result.receiverName).toBe('收银员3');
  });

  it('16:01 与 17:06 都已交班后应切到 17:11–17:15 且无后续接班人', async () => {
    setSystemTime('2026-06-05T17:20:00');
    const firstShift = ctx.createShiftRecord({
      id: 601,
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
      id: 602,
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
      id: 603,
      employeeId: 40,
      employeeName: '收银员3',
      shiftType: EmployeeShiftType.custom,
      shiftName: '收银员3',
      date: new Date('2026-06-05T00:00:00.000Z'),
      startTime: '17:11',
      endTime: '17:15',
      createdAt: new Date('2026-06-05T17:05:00.000Z'),
    });
    prismaService.employeeShift.findMany.mockResolvedValue([
      firstShift,
      secondShift,
      thirdShift,
    ]);
    prismaService.storeHandoverRecord.count.mockImplementation(({ where }) => {
      const snapshotCondition = Array.isArray(where?.OR)
        ? where.OR.find((item) => item?.employeeShiftIdSnapshot)
        : null;
      return Promise.resolve(
        snapshotCondition?.employeeShiftIdSnapshot === 601 ||
          snapshotCondition?.employeeShiftIdSnapshot === 602
          ? 1
          : 0,
      );
    });
    mockZeroSummaryAggregates();

    const result = await ctx.service.getHandoverPage(subAccountUser, {});

    expect(result.selectedShiftType).toBe(EmployeeShiftType.custom);
    expect(result.shiftInfo).toMatchObject({
      operatorName: '收银员3',
      startTime: '17:11',
      endTime: '17:15',
    });
    expect(result.receiverName).toBe('');
    expect(result.handoverCompletedAndNoUpcomingShift).toBe(true);
  });

  it('仅带 operatorName 刷新时不应锁定到同员工后续班次', async () => {
    setSystemTime('2026-06-05T17:20:00');
    const firstShift = ctx.createShiftRecord({
      id: 801,
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
      id: 802,
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
      id: 803,
      employeeId: 20,
      employeeName: '收银员1',
      shiftType: EmployeeShiftType.custom,
      shiftName: '收银员1-返岗',
      date: new Date('2026-06-05T00:00:00.000Z'),
      startTime: '17:11',
      endTime: '17:15',
      createdAt: new Date('2026-06-05T17:05:00.000Z'),
    });
    prismaService.employeeShift.findFirst.mockImplementation(({ where }) => {
      if (where?.employeeName === '收银员1') {
        return Promise.resolve(firstShift);
      }

      return Promise.resolve(null);
    });
    prismaService.employeeShift.findMany.mockImplementation(({ where }) => {
      if (where?.employeeId === 20) {
        return Promise.resolve([firstShift, thirdShift]);
      }

      return Promise.resolve([firstShift, secondShift, thirdShift]);
    });
    prismaService.storeHandoverRecord.count.mockImplementation(({ where }) => {
      const snapshotCondition = Array.isArray(where?.OR)
        ? where.OR.find((item) => item?.employeeShiftIdSnapshot)
        : null;
      return Promise.resolve(
        snapshotCondition?.employeeShiftIdSnapshot === 801 ? 1 : 0,
      );
    });
    prismaService.employee.findUnique.mockResolvedValueOnce(
      createEmployeeProfile({
        name: '收银员2',
        linkedStaffId: 102,
      }),
    );
    mockZeroSummaryAggregates();

    const result = await ctx.service.getHandoverPage(subAccountUser, {
      operatorName: '收银员1',
    });

    expect(result.selectedShiftType).toBe(EmployeeShiftType.custom);
    expect(result.shiftInfo).toMatchObject({
      shiftType: EmployeeShiftType.custom,
      startTime: '17:06',
      endTime: '17:10',
      operatorName: '收银员2',
    });
    expect(result.receiverName).toBe('收银员1');
  });

  it('带 operatorName 查询已交班班次时也应切到下一班并初始化数据', async () => {
    setSystemTime('2026-06-02T10:00:00');
    prismaService.employeeShift.findFirst.mockImplementation(({ where }) => {
      if (where?.employeeName === '员工A') {
        return Promise.resolve(MORNING_SHIFT_EMPLOYEE_A);
      }

      if (
        where?.employeeId === 20 &&
        where?.shiftType === EmployeeShiftType.morning
      ) {
        return Promise.resolve(MORNING_SHIFT_EMPLOYEE_A);
      }

      if (where?.shiftType === EmployeeShiftType.morning) {
        return Promise.resolve(MORNING_SHIFT_EMPLOYEE_A);
      }

      return Promise.resolve(null);
    });
    prismaService.employeeShift.findMany.mockResolvedValue([
      MORNING_SHIFT_EMPLOYEE_A,
      LATE_SHIFT_EMPLOYEE_A,
    ]);
    mockHandoverRecordCounts({
      handoverAt: (startAt) => (startAt.getHours() === 9 ? 1 : 0),
      createdAt: () => 1,
    });
    prismaService.employee.findUnique.mockResolvedValueOnce(
      createEmployeeProfile({
        name: '员工A',
        linkedStaffId: 102,
      }),
    );
    mockZeroSummaryAggregates();

    const result = await ctx.service.getHandoverPage(subAccountUser, {
      shiftType: EmployeeShiftType.morning,
      operatorName: '员工A',
    });

    expect(result.selectedShiftType).toBe(EmployeeShiftType.late);
    expect(result.shiftInfo).toMatchObject({
      shiftType: EmployeeShiftType.late,
      startTime: '17:00',
      endTime: '23:00',
      operatorName: '员工A',
    });
    expect(result.revenueSummary).toMatchObject({
      additionalRevenue: 0,
      spaceRevenue: 0,
      refundAmount: 0,
      totalRevenue: 0,
      orderCount: 0,
    });
  });
});

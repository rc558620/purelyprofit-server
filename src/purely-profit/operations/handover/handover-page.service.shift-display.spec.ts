import { EmployeeShiftType } from '@prisma/client';
import {
  LATE_SHIFT_CASHIER_2,
  MORNING_SHIFT_CASHIER_1,
  setupHandoverPageSpec,
} from './handover-page.spec-helpers';
import { createManagerUser } from './hover.spec-helpers';

describe('HandoverPageService - 班次展示与 fallback', () => {
  const ctx = setupHandoverPageSpec();
  const {
    prismaService,
    storeSubAccountService,
    subAccountUser,
    ownerUser,
    createCashierUser,
    createEmployeeProfile,
    createShiftRecord,
    mockEmptySaleOrderItems,
    expectEmployeeDetailLookup,
    setSystemTime,
    mockShiftLists,
  } = ctx;
  const managerUser = createManagerUser();

  it('收银员无本人班次时应展示当前排班员工头像并按其 staffId 聚合数据', async () => {
    prismaService.employeeShift.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(MORNING_SHIFT_CASHIER_1);
    prismaService.employeeShift.findMany.mockResolvedValue([
      MORNING_SHIFT_CASHIER_1,
      LATE_SHIFT_CASHIER_2,
    ]);
    prismaService.employee.findUnique.mockResolvedValueOnce(
      createEmployeeProfile({
        name: '收银员1',
        avatar: 'https://cdn.example.com/cashier-1.png',
        linkedStaffId: 101,
        linkedStaffAvatar: 'https://cdn.example.com/user-cashier-1.png',
      }),
    );
    mockEmptySaleOrderItems();

    const result = await ctx.service.getHandoverPage(subAccountUser, {
      shiftType: EmployeeShiftType.morning,
    });

    expect(result.selectedShiftType).toBe(EmployeeShiftType.morning);
    expect(result.shiftInfo).toMatchObject({
      shiftType: EmployeeShiftType.morning,
      startTime: '08:00',
      endTime: '14:00',
      operatorName: '收银员1',
      operatorAvatar: 'https://cdn.example.com/cashier-1.png',
      avatar: 'https://cdn.example.com/cashier-1.png',
    });
    expect(result.receiverName).toBe('收银员2');
    expect(result.canOperate).toBe(false);
    expect(result.operationBlockedReason).toBe(
      '当前班次不属于该收银员，暂不允许操作',
    );
    expect(prismaService.saleOrderItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          storeId: 100,
          order: expect.objectContaining({
            storeId: 100,
            date: expect.any(Object),
          }),
        }),
      }),
    );
    expectEmployeeDetailLookup(10);
    expect(
      storeSubAccountService.findAssignedSubAccountByEmployee,
    ).toHaveBeenCalledWith(100, 30);
  });

  it('子账号无排班记录时应从员工表取姓名与头像而非登录用户名', async () => {
    prismaService.employeeShift.findFirst.mockResolvedValue(null);
    prismaService.employeeShift.findMany.mockResolvedValue([]);
    prismaService.employee.findUnique.mockResolvedValue(
      createEmployeeProfile({
        name: '张三',
        avatar: 'https://cdn.example.com/employee-20.png',
        linkedStaffId: 2,
        linkedStaffAvatar: 'https://cdn.example.com/user-20.png',
      }),
    );
    mockEmptySaleOrderItems();

    const result = await ctx.service.getHandoverPage(subAccountUser, {
      shiftType: EmployeeShiftType.morning,
      operatorName: '收银员1号',
    });

    expect(result.shiftInfo.operatorName).toBe('张三');
    expect(result.shiftInfo.operatorAvatar).toBe(
      'https://cdn.example.com/employee-20.png',
    );
    expect(result.shiftInfo.avatar).toBe(
      'https://cdn.example.com/employee-20.png',
    );
    expectEmployeeDetailLookup(20);
  });

  it('店长账号应可操作门店当前班次交班', async () => {
    setSystemTime('2026-06-02T10:00:00');
    mockShiftLists({
      defaultShifts: [MORNING_SHIFT_CASHIER_1, LATE_SHIFT_CASHIER_2],
      shiftsByEmployeeId: {
        30: [LATE_SHIFT_CASHIER_2],
      },
    });
    prismaService.employee.findUnique.mockResolvedValueOnce(
      createEmployeeProfile({
        name: '收银员1',
        avatar: 'https://cdn.example.com/cashier-1.png',
        linkedStaffId: 101,
      }),
    );
    mockEmptySaleOrderItems();

    const result = await ctx.service.getHandoverPage(managerUser, {});

    expect(result.selectedShiftType).toBe(EmployeeShiftType.morning);
    expect(result.shiftInfo).toMatchObject({
      shiftType: EmployeeShiftType.morning,
      startTime: '08:00',
      endTime: '14:00',
      operatorName: '收银员1',
      operatorAvatar: 'https://cdn.example.com/cashier-1.png',
      avatar: 'https://cdn.example.com/cashier-1.png',
    });
    expect(result.receiverName).toBe('收银员2');
    expect(result.canOperate).toBe(true);
    expect(result.operationBlockedReason).toBeNull();
    expectEmployeeDetailLookup(10);
  });

  it('收银员本人有后续班次时仍应展示门店当前班次和下一班接班人', async () => {
    setSystemTime('2026-06-02T10:00:00');
    const cashier2User = createCashierUser({
      name: '收银员2账号',
      linkedEmployeeId: 30,
      staffId: 3,
    });
    mockShiftLists({
      defaultShifts: [MORNING_SHIFT_CASHIER_1, LATE_SHIFT_CASHIER_2],
      shiftsByEmployeeId: {
        30: [LATE_SHIFT_CASHIER_2],
      },
    });
    prismaService.employee.findUnique.mockResolvedValueOnce(
      createEmployeeProfile({ linkedStaffId: 101 }),
    );
    mockEmptySaleOrderItems();

    const result = await ctx.service.getHandoverPage(cashier2User, {});

    expect(result.selectedShiftType).toBe(EmployeeShiftType.morning);
    expect(result.shiftInfo.operatorName).toBe('收银员1');
    expect(result.receiverName).toBe('收银员2');
    expect(result.canOperate).toBe(false);
    expect(result.operationBlockedReason).toBe(
      '当前时段没有该收银员本人班次，暂不允许操作',
    );
  });

  it('上一个班次未交班时应继续展示该未交班班次', async () => {
    setSystemTime('2026-06-02T18:00:00');
    const cashier2User = createCashierUser({
      name: '收银员2账号',
      linkedEmployeeId: 30,
      staffId: 3,
    });
    mockShiftLists({
      defaultShifts: [MORNING_SHIFT_CASHIER_1, LATE_SHIFT_CASHIER_2],
      shiftsByEmployeeId: {
        30: [LATE_SHIFT_CASHIER_2],
      },
    });
    prismaService.employee.findUnique.mockResolvedValueOnce(
      createEmployeeProfile({ linkedStaffId: 101 }),
    );
    mockEmptySaleOrderItems();

    const result = await ctx.service.getHandoverPage(cashier2User, {});

    expect(result.selectedShiftType).toBe(EmployeeShiftType.morning);
    expect(result.shiftInfo).toMatchObject({
      shiftType: EmployeeShiftType.morning,
      startTime: '08:00',
      endTime: '14:00',
      operatorName: '收银员1',
    });
    expect(result.receiverName).toBe('收银员2');
    expect(result.canOperate).toBe(false);
    expect(result.operationBlockedReason).toBe(
      '当前时段没有该收银员本人班次，暂不允许操作',
    );
  });

  it('刷新时即使带了下一班 shiftType 也应继续展示未交班当前班次', async () => {
    setSystemTime('2026-06-02T18:00:00');
    const cashier2User = createCashierUser({
      name: '收银员2账号',
      linkedEmployeeId: 30,
      staffId: 3,
    });
    prismaService.employeeShift.findFirst.mockResolvedValueOnce(
      LATE_SHIFT_CASHIER_2,
    );
    mockShiftLists({
      defaultShifts: [MORNING_SHIFT_CASHIER_1, LATE_SHIFT_CASHIER_2],
      shiftsByEmployeeId: {
        30: [LATE_SHIFT_CASHIER_2],
      },
    });
    prismaService.employee.findUnique.mockResolvedValueOnce(
      createEmployeeProfile({ linkedStaffId: 101 }),
    );
    mockEmptySaleOrderItems();
    prismaService.storeHandoverRecord.count.mockResolvedValue(0);

    const result = await ctx.service.getHandoverPage(cashier2User, {
      shiftType: EmployeeShiftType.late,
    });

    expect(result.selectedShiftType).toBe(EmployeeShiftType.morning);
    expect(result.shiftInfo).toMatchObject({
      shiftType: EmployeeShiftType.morning,
      startTime: '08:00',
      endTime: '14:00',
      operatorName: '收银员1',
    });
    expect(result.receiverName).toBe('收银员2');
    expect(result.canOperate).toBe(false);
    expect(result.operationBlockedReason).toBe(
      '当前班次不属于该收银员，暂不允许操作',
    );
  });

  it('自定义班次应优先展示排班定义名称而不是类型兜底文案', async () => {
    prismaService.employeeShift.findFirst.mockResolvedValue(
      createShiftRecord({
        employeeId: 20,
        employeeName: '张三',
        shiftType: EmployeeShiftType.custom,
        shiftName: '晚晚班',
        startTime: '15:49',
        endTime: '15:57',
      }),
    );
    prismaService.employeeShift.findMany.mockResolvedValue([
      createShiftRecord({
        employeeId: 20,
        employeeName: '张三',
        shiftType: EmployeeShiftType.custom,
        shiftName: '晚晚班',
        startTime: '15:49',
        endTime: '15:57',
      }),
    ]);
    prismaService.employee.findUnique.mockResolvedValueOnce(
      createEmployeeProfile({
        name: '张三',
        linkedStaffId: 2,
      }),
    );
    mockEmptySaleOrderItems();

    const result = await ctx.service.getHandoverPage(subAccountUser, {
      shiftType: EmployeeShiftType.custom,
    });

    expect(result.selectedShiftType).toBe(EmployeeShiftType.custom);
    expect(result.shiftInfo).toMatchObject({
      shiftType: EmployeeShiftType.custom,
      shiftName: '晚晚班',
      shiftLabel: '晚晚班',
      startTime: '15:49',
      endTime: '15:57',
      operatorName: '张三',
    });
  });

  it('跨天未交班时应继续展示上一天未交班班次', async () => {
    setSystemTime('2026-06-05T09:00:00');
    const previousLateShift = createShiftRecord({
      employeeId: 30,
      employeeName: '收银员2',
      shiftType: EmployeeShiftType.late,
      date: new Date('2026-06-04T00:00:00'),
      startTime: '17:00',
      endTime: '23:00',
    });
    const currentMorningShift = createShiftRecord({
      employeeId: 10,
      employeeName: '收银员1',
      shiftType: EmployeeShiftType.morning,
      date: new Date('2026-06-05T00:00:00'),
      startTime: '08:00',
      endTime: '14:00',
    });
    mockShiftLists({
      defaultShifts: [previousLateShift, currentMorningShift],
      shiftsByEmployeeId: {
        30: [previousLateShift],
      },
    });
    prismaService.employee.findUnique.mockResolvedValueOnce(
      createEmployeeProfile({
        name: '收银员2',
        linkedStaffId: 102,
      }),
    );
    mockEmptySaleOrderItems();

    const result = await ctx.service.getHandoverPage(ownerUser, {});

    expect(result.selectedShiftType).toBe(EmployeeShiftType.late);
    expect(result.shiftInfo).toMatchObject({
      shiftType: EmployeeShiftType.late,
      startTime: '17:00',
      endTime: '23:00',
      operatorName: '收银员2',
    });
    expect(new Date(result.shiftInfo.shiftReferenceAt).getFullYear()).toBe(
      2026,
    );
    expect(new Date(result.shiftInfo.shiftReferenceAt).getMonth()).toBe(5);
    expect(new Date(result.shiftInfo.shiftReferenceAt).getDate()).toBe(4);
    expect(result.receiverName).toBe('收银员1');
    expect(prismaService.saleOrderItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          order: expect.objectContaining({
            storeId: 100,
            date: expect.objectContaining({
              gte: expect.any(Date),
              lte: expect.any(Date),
            }),
          }),
        }),
      }),
    );
    const firstOrderQuery =
      prismaService.saleOrderItem.findMany.mock.calls[0][0];
    const firstOrderBranch = firstOrderQuery.where.order;
    expect(firstOrderBranch.date.gte.getFullYear()).toBe(2026);
    expect(firstOrderBranch.date.gte.getMonth()).toBe(5);
    expect(firstOrderBranch.date.gte.getDate()).toBe(4);
    expect(firstOrderBranch.date.lte.getFullYear()).toBe(2026);
    expect(firstOrderBranch.date.lte.getMonth()).toBe(5);
    expect(firstOrderBranch.date.lte.getDate()).toBe(5);
  });

  it('主账号查看收银员班次时应返回收银员头像', async () => {
    prismaService.employeeShift.findFirst.mockResolvedValue(
      createShiftRecord({
        employeeId: 20,
        employeeName: '收银员1',
      }),
    );
    prismaService.employeeShift.findMany.mockResolvedValue([
      createShiftRecord({
        employeeId: 20,
        employeeName: '收银员1',
      }),
      createShiftRecord({
        employeeId: 30,
        employeeName: '收银员2',
        shiftType: EmployeeShiftType.late,
        startTime: '18:00',
        endTime: '23:00',
      }),
    ]);
    prismaService.employee.findUnique.mockResolvedValueOnce(
      createEmployeeProfile({
        name: '收银员1',
        avatar: null,
        linkedStaffId: 2,
        linkedStaffAvatar: 'https://cdn.example.com/sub-account-user.png',
      }),
    );
    mockEmptySaleOrderItems();
    storeSubAccountService.findAssignedSubAccountByEmployee.mockResolvedValue({
      id: 6,
    });

    const result = await ctx.service.getHandoverPage(ownerUser, {
      shiftType: EmployeeShiftType.morning,
    });

    expect(result.shiftInfo).toMatchObject({
      operatorName: '收银员1',
      operatorAvatar: 'https://cdn.example.com/sub-account-user.png',
      avatar: 'https://cdn.example.com/sub-account-user.png',
    });
    expect(prismaService.saleOrderItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          order: expect.objectContaining({
            storeId: 100,
            date: expect.any(Object),
          }),
        }),
      }),
    );
  });
});

import { EmployeeShiftType } from '@prisma/client';
import { setupHandoverPageSpec } from './handover-page.spec-helpers';

describe('HandoverPageService - 收银员可操作性', () => {
  const ctx = setupHandoverPageSpec();
  const {
    prismaService,
    subAccountUser,
    createCashierUser,
    mockEmptySaleOrderItems,
  } = ctx;

  it('收银员未排班时应返回不可操作状态', async () => {
    prismaService.employeeShift.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    prismaService.employeeShift.findMany.mockResolvedValue([]);
    mockEmptySaleOrderItems();

    const result = await ctx.service.getHandoverPage(subAccountUser, {
      shiftType: EmployeeShiftType.late,
    });

    expect(result.canOperate).toBe(false);
    expect(result.operationBlockedReason).toBe(
      '当前班次不属于该收银员，暂不允许操作',
    );
  });

  it('收银员 linkedEmployeeId 为 null 时应展示门店当前班次但返回不可操作', async () => {
    const userWithoutEmployee = createCashierUser({ linkedEmployeeId: null });
    mockEmptySaleOrderItems();

    const result = await ctx.service.getHandoverPage(userWithoutEmployee, {
      shiftType: EmployeeShiftType.morning,
    });

    expect(result.selectedShiftType).toBe(EmployeeShiftType.morning);
    expect(result.shiftInfo).toMatchObject({
      shiftType: EmployeeShiftType.morning,
      operatorName: '员工A',
      startTime: '09:00',
      endTime: '18:00',
    });
    expect(result.canOperate).toBe(false);
    expect(result.operationBlockedReason).toBe(
      '当前收银员账号未关联员工，暂不允许操作',
    );
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { EmployeeShiftType, Prisma, SalesPaymentMethod } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { StoreSubAccountService } from '../../member/platform-membership/store-sub-account.service';
import { HandoverPageService } from './handover-page.service';
import {
  createHandoverPrismaMock,
  createStoreSubAccountServiceMock,
  createSubAccountUser,
} from './hover.spec-helpers';

describe('HandoverPageService', () => {
  let service: HandoverPageService;

  const prismaService = createHandoverPrismaMock();
  const storeSubAccountService = createStoreSubAccountServiceMock();
  const subAccountUser = createSubAccountUser();

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HandoverPageService,
        { provide: PrismaService, useValue: prismaService },
        {
          provide: StoreSubAccountService,
          useValue: storeSubAccountService,
        },
      ],
    }).compile();

    service = module.get<HandoverPageService>(HandoverPageService);

    prismaService.employee.findUnique.mockResolvedValue({ name: '员工A' });
    prismaService.employeeShift.findFirst.mockResolvedValue({
      employeeId: 20,
      employeeName: '员工A',
      shiftType: EmployeeShiftType.morning,
      startTime: '09:00',
      endTime: '18:00',
    });
    prismaService.saleOrder.groupBy.mockResolvedValue([
      {
        paymentMethod: SalesPaymentMethod.alipay,
        _sum: { totalRevenue: new Prisma.Decimal('1004.65') },
      },
    ]);
    prismaService.saleOrder.aggregate.mockResolvedValue({
      _sum: { totalRevenue: new Prisma.Decimal('988.00') },
    });
    prismaService.saleOrder.count.mockResolvedValue(3);
    prismaService.spaceSession.aggregate.mockResolvedValue({
      _sum: { timeCost: new Prisma.Decimal('9.25') },
    });
    prismaService.financeCashFlowRecord.aggregate
      .mockResolvedValueOnce({ _sum: { amount: null } })
      .mockResolvedValueOnce({ _sum: { amount: null } });
    storeSubAccountService.listAssignableHandoverCandidates.mockResolvedValue(
      [],
    );
    prismaService.storeHandoverRecord.count.mockResolvedValue(0);
  });

  it('营业收入应统计 additional 本班次收入', async () => {
    prismaService.saleOrderItem.findMany.mockResolvedValue([]);

    const result = await service.getHandoverPage(subAccountUser, {
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
      totalRevenue: 1004.65,
      orderCount: 3,
    });
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
          date: new Date('2026-06-02T10:06:00.000Z'),
          paymentMethod: SalesPaymentMethod.alipay,
          spaceSession: {
            prepaidPaymentMethod: SalesPaymentMethod.wechat,
            renewRecords: [],
          },
        },
      },
    ]);

    const result = await service.getHandoverPage(subAccountUser, {
      shiftType: EmployeeShiftType.morning,
    });

    expect(result.orderItems).toHaveLength(1);
    expect(result.orderItems[0]).toMatchObject({
      productName: '预付抵扣',
      totalRevenue: -666,
      paymentLabel: '微信',
      paymentColor: '#22c55e',
    });
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
          date: new Date('2026-06-02T10:06:00.000Z'),
          paymentMethod: SalesPaymentMethod.alipay,
          spaceSession: {
            prepaidPaymentMethod: SalesPaymentMethod.wechat,
            renewRecords: [],
          },
        },
      },
    ]);

    const result = await service.getHandoverPage(subAccountUser, {
      shiftType: EmployeeShiftType.morning,
    });

    expect(result.orderItems[0]).toMatchObject({
      productName: '台位费（1分钟）',
      totalRevenue: 9.25,
      paymentLabel: '支付宝',
      paymentColor: '#1677ff',
    });
  });

  it('收银员未排班时应返回不可操作状态', async () => {
    prismaService.employeeShift.findFirst.mockResolvedValueOnce(null);
    prismaService.saleOrderItem.findMany.mockResolvedValue([]);

    const result = await service.getHandoverPage(subAccountUser, {
      shiftType: EmployeeShiftType.late,
    });

    expect(result.canOperate).toBe(false);
    expect(result.operationBlockedReason).toBe(
      '当前班次不属于该收银员，暂不允许操作',
    );
  });

  it('子账号无排班记录时 operatorName 应从员工表取员工真实姓名而非登录用户名', async () => {
    prismaService.employeeShift.findFirst.mockResolvedValue(null);
    prismaService.employee.findUnique.mockResolvedValue({ name: '张三' });
    prismaService.saleOrderItem.findMany.mockResolvedValue([]);

    const result = await service.getHandoverPage(subAccountUser, {
      shiftType: EmployeeShiftType.morning,
      operatorName: '收银员1号',
    });

    // operatorName 应来自员工表（张三），而不是 query.operatorName（收银员1号）或 user.name（员工A）
    expect(result.shiftInfo.operatorName).toBe('张三');
    // 确认确实查询了员工表
    expect(prismaService.employee.findUnique).toHaveBeenCalledWith({
      where: { id: 20 },
      select: { name: true },
    });
  });

  it('收银员 linkedEmployeeId 为 null 时不应展示他人班次且返回不可操作', async () => {
    const userWithoutEmployee = {
      ...createSubAccountUser(),
      currentMembership: {
        ...createSubAccountUser().currentMembership!,
        linkedEmployeeId: null,
      },
    };
    prismaService.saleOrderItem.findMany.mockResolvedValue([]);

    const result = await service.getHandoverPage(userWithoutEmployee, {
      shiftType: EmployeeShiftType.morning,
    });

    // 不应调用 findFirst 查询班次（因为 linkedEmployeeId 为 null 时应跳过班次查询）
    expect(prismaService.employeeShift.findFirst).not.toHaveBeenCalled();
    expect(result.canOperate).toBe(false);
    expect(result.operationBlockedReason).toBe(
      '当前收银员账号未关联员工，暂不允许操作',
    );
  });

  it('当前班次已交班时应自动切换到下一班次并重新初始化数据', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-02T10:00:00.000Z'));
    prismaService.employeeShift.findMany.mockResolvedValue([
      {
        employeeId: 20,
        employeeName: '员工A',
        shiftType: EmployeeShiftType.morning,
        startTime: '09:00',
        endTime: '14:00',
      },
      {
        employeeId: 20,
        employeeName: '员工A',
        shiftType: EmployeeShiftType.late,
        startTime: '17:00',
        endTime: '23:00',
      },
    ]);
    prismaService.storeHandoverRecord.count
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);
    prismaService.saleOrderItem.findMany.mockResolvedValue([]);
    prismaService.saleOrder.groupBy.mockResolvedValue([]);
    prismaService.saleOrder.aggregate.mockResolvedValue({
      _sum: { totalRevenue: null },
    });
    prismaService.saleOrder.count.mockResolvedValue(0);
    prismaService.spaceSession.aggregate.mockResolvedValue({
      _sum: { timeCost: null },
    });
    prismaService.financeCashFlowRecord.aggregate.mockResolvedValue({
      _sum: { amount: null },
    });

    const result = await service.getHandoverPage(subAccountUser, {});

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
      totalRevenue: 0,
      orderCount: 0,
    });

    jest.useRealTimers();
  });

  it('收银员查询已完成交班的班次时应自动切换到下一班次', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-02T10:00:00.000Z'));
    prismaService.employeeShift.findFirst.mockResolvedValueOnce({
      employeeId: 20,
      employeeName: '员工A',
      shiftType: EmployeeShiftType.morning,
      startTime: '09:00',
      endTime: '14:00',
    });
    prismaService.employeeShift.findMany.mockResolvedValue([
      {
        employeeId: 20,
        employeeName: '员工A',
        shiftType: EmployeeShiftType.morning,
        startTime: '09:00',
        endTime: '14:00',
      },
      {
        employeeId: 20,
        employeeName: '员工A',
        shiftType: EmployeeShiftType.late,
        startTime: '17:00',
        endTime: '23:00',
      },
    ]);
    prismaService.storeHandoverRecord.count
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);
    prismaService.saleOrderItem.findMany.mockResolvedValue([]);
    prismaService.saleOrder.groupBy.mockResolvedValue([]);
    prismaService.saleOrder.aggregate.mockResolvedValue({
      _sum: { totalRevenue: null },
    });
    prismaService.saleOrder.count.mockResolvedValue(0);
    prismaService.spaceSession.aggregate.mockResolvedValue({
      _sum: { timeCost: null },
    });
    prismaService.financeCashFlowRecord.aggregate.mockResolvedValue({
      _sum: { amount: null },
    });

    const result = await service.getHandoverPage(subAccountUser, {
      shiftType: EmployeeShiftType.morning,
    });

    expect(result.selectedShiftType).toBe(EmployeeShiftType.late);
    expect(result.canOperate).toBe(true);

    jest.useRealTimers();
  });
});

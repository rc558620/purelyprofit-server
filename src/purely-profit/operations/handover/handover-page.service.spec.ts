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

    prismaService.employeeShift.findFirst.mockResolvedValue({
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
});

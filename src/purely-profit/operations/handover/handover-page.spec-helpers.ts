import { Test, type TestingModule } from '@nestjs/testing';
import { EmployeeShiftType, Prisma, SalesPaymentMethod } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { StoreSubAccountService } from '../../member/platform-membership/store-sub-account.service';
import {
  createCashierUser,
  createEmployeeProfile,
  createHandoverPrismaMock,
  createOwnerUser,
  createShiftRecord,
  createStoreSubAccountServiceMock,
  createSubAccountUser,
} from './hover.spec-helpers';
import { HandoverPageService } from './handover-page.service';
import { HandoverPageShiftRecordService } from './handover-page-shift-record.service';
import { HandoverPageShiftSelectorService } from './handover-page-shift-selector.service';
import { HandoverPageShiftService } from './handover-page-shift.service';
import { HandoverPageShiftViewService } from './handover-page-shift-view.service';

export const EMPLOYEE_DETAIL_SELECT = {
  name: true,
  avatar: true,
  linkedStaffId: true,
  linkedStaff: {
    select: {
      user: {
        select: {
          avatar: true,
        },
      },
    },
  },
} as const;

export const MORNING_SHIFT_CASHIER_1 = createShiftRecord({
  employeeId: 10,
  employeeName: '收银员1',
  startTime: '08:00',
  endTime: '14:00',
});

export const MORNING_SHIFT_EMPLOYEE_A = createShiftRecord({
  startTime: '09:00',
  endTime: '14:00',
});

export const LATE_SHIFT_CASHIER_2 = createShiftRecord({
  employeeId: 30,
  employeeName: '收银员2',
  shiftType: EmployeeShiftType.late,
  startTime: '17:00',
  endTime: '23:00',
});

export const LATE_SHIFT_EMPLOYEE_A = createShiftRecord({
  shiftType: EmployeeShiftType.late,
  startTime: '17:00',
  endTime: '23:00',
});

type ShiftRecord = ReturnType<typeof createShiftRecord>;
type HandoverPrismaMock = ReturnType<typeof createHandoverPrismaMock>;
type StoreSubAccountServiceMock = ReturnType<
  typeof createStoreSubAccountServiceMock
>;

type ShiftListMockOptions = {
  defaultShifts: ShiftRecord[];
  shiftsByEmployeeId?: Record<number, ShiftRecord[]>;
};

type HandoverRecordCountMockOptions = {
  handoverAt?: (startAt: Date) => number;
  createdAt?: (fromEmployeeId: number | undefined) => number;
  fallback?: number;
};

type ShiftListWhere = {
  employeeId?: number;
};

type HandoverRecordCountWhere = {
  handoverAt?: { gte?: Date };
  createdAt?: { gte?: Date };
  fromEmployeeId?: number;
  OR?: Array<{
    handoverAt?: { gte?: Date };
    createdAt?: { gte?: Date };
    employeeShiftIdSnapshot?: number | null;
  }>;
};

export const setupHandoverPageSpec = (): {
  readonly service: HandoverPageService;
  readonly prismaService: HandoverPrismaMock;
  readonly storeSubAccountService: StoreSubAccountServiceMock;
  readonly subAccountUser: ReturnType<typeof createSubAccountUser>;
  readonly ownerUser: ReturnType<typeof createOwnerUser>;
  readonly createCashierUser: typeof createCashierUser;
  readonly mockEmptySaleOrderItems: () => void;
  readonly expectEmployeeDetailLookup: (employeeId: number) => void;
  readonly setSystemTime: (value: string) => void;
  readonly mockShiftLists: (options: ShiftListMockOptions) => void;
  readonly mockZeroSummaryAggregates: () => void;
  readonly mockHandoverRecordCounts: (
    options: HandoverRecordCountMockOptions,
  ) => void;
  readonly createEmployeeProfile: typeof createEmployeeProfile;
  readonly createShiftRecord: typeof createShiftRecord;
} => {
  const prismaService = createHandoverPrismaMock();
  const storeSubAccountService = createStoreSubAccountServiceMock();
  const subAccountUser = createSubAccountUser();
  const ownerUser = createOwnerUser();

  let service: HandoverPageService | null = null;

  const getService = (): HandoverPageService => {
    if (!service) {
      throw new Error('HandoverPageService 尚未完成初始化');
    }

    return service;
  };

  const mockEmptySaleOrderItems = (): void => {
    prismaService.saleOrderItem.findMany.mockResolvedValue([]);
  };

  const expectEmployeeDetailLookup = (employeeId: number): void => {
    expect(prismaService.employee.findUnique).toHaveBeenCalledWith({
      where: { id: employeeId },
      select: EMPLOYEE_DETAIL_SELECT,
    });
  };

  const setSystemTime = (value: string): void => {
    jest.useFakeTimers().setSystemTime(new Date(value));
  };

  const mockShiftLists = (options: ShiftListMockOptions): void => {
    prismaService.employeeShift.findMany.mockImplementation(
      ({ where }: { where?: ShiftListWhere }) => {
        const employeeId = where?.employeeId;
        if (typeof employeeId === 'number') {
          return Promise.resolve(
            options.shiftsByEmployeeId?.[employeeId] ?? options.defaultShifts,
          );
        }

        return Promise.resolve(options.defaultShifts);
      },
    );
  };

  const mockZeroSummaryAggregates = (): void => {
    mockEmptySaleOrderItems();
    prismaService.saleOrder.aggregate.mockResolvedValue({
      _sum: { totalRevenue: null },
    });
    prismaService.saleOrder.count.mockResolvedValue(0);
    prismaService.spaceSession.aggregate.mockResolvedValue({
      _sum: { timeCost: null, itemsCost: null },
    });
    prismaService.spaceSession.findMany.mockResolvedValue([]);
    prismaService.financeCashFlowRecord.aggregate.mockResolvedValue({
      _sum: { amount: null },
    });
  };

  const mockHandoverRecordCounts = (
    options: HandoverRecordCountMockOptions,
  ): void => {
    prismaService.storeHandoverRecord.count.mockImplementation(
      ({ where }: { where?: HandoverRecordCountWhere }) => {
        const handoverAtCondition =
          where?.handoverAt?.gte instanceof Date
            ? where.handoverAt
            : where?.OR?.find((item) => item.handoverAt?.gte instanceof Date)
                ?.handoverAt;
        if (handoverAtCondition?.gte instanceof Date) {
          return Promise.resolve(
            options.handoverAt?.(handoverAtCondition.gte) ?? 0,
          );
        }

        const createdAtCondition =
          where?.createdAt?.gte instanceof Date
            ? where.createdAt
            : where?.OR?.find((item) => item.createdAt?.gte instanceof Date)
                ?.createdAt;
        if (createdAtCondition?.gte instanceof Date) {
          return Promise.resolve(
            options.createdAt?.(where?.fromEmployeeId) ?? 0,
          );
        }

        return Promise.resolve(options.fallback ?? 0);
      },
    );
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HandoverPageService,
        HandoverPageShiftRecordService,
        HandoverPageShiftSelectorService,
        HandoverPageShiftService,
        HandoverPageShiftViewService,
        { provide: PrismaService, useValue: prismaService },
        {
          provide: StoreSubAccountService,
          useValue: storeSubAccountService,
        },
      ],
    }).compile();

    service = module.get<HandoverPageService>(HandoverPageService);

    prismaService.employee.findUnique.mockResolvedValue(
      createEmployeeProfile({ name: '员工A' }),
    );
    prismaService.employeeShift.findFirst.mockResolvedValue(
      createShiftRecord(),
    );
    prismaService.employeeShift.findMany.mockResolvedValue([
      createShiftRecord(),
    ]);
    prismaService.saleOrder.groupBy.mockResolvedValue([
      {
        paymentMethod: SalesPaymentMethod.alipay,
        _sum: { totalRevenue: new Prisma.Decimal('1004.65') },
      },
    ]);
    prismaService.saleOrder.aggregate.mockImplementation(({ where }) => {
      // additionalRevenue 查询（仅非空间会话订单，spaceSession.is === null）
      if (where?.spaceSession?.is === null) {
        return Promise.resolve({
          _sum: { totalRevenue: new Prisma.Decimal('978.75') },
        });
      }

      if (
        where?.spaceSession?.isNot === null &&
        where?.totalRevenue?.lt === 0
      ) {
        return Promise.resolve({
          _sum: { totalRevenue: null },
        });
      }

      return Promise.resolve({
        _sum: { totalRevenue: null },
      });
    });
    prismaService.saleOrder.findMany.mockResolvedValue([]);
    prismaService.saleOrder.count.mockResolvedValue(3);
    prismaService.spaceSession.aggregate.mockResolvedValue({
      _sum: { timeCost: new Prisma.Decimal('9.25'), itemsCost: new Prisma.Decimal('0') },
    });
    prismaService.spaceSession.findMany.mockResolvedValue([]);
    prismaService.financeCashFlowRecord.aggregate
      .mockResolvedValueOnce({ _sum: { amount: null } })
      .mockResolvedValueOnce({ _sum: { amount: null } });
    storeSubAccountService.listAssignableHandoverCandidates.mockResolvedValue(
      [],
    );
    storeSubAccountService.findAssignedSubAccountByEmployee.mockResolvedValue(
      null,
    );
    prismaService.storeHandoverRecord.count.mockResolvedValue(0);
    prismaService.storeHandoverRecord.findFirst.mockResolvedValue(null);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  return {
    get service(): HandoverPageService {
      return getService();
    },
    prismaService,
    storeSubAccountService,
    subAccountUser,
    ownerUser,
    createCashierUser,
    mockEmptySaleOrderItems,
    expectEmployeeDetailLookup,
    setSystemTime,
    mockShiftLists,
    mockZeroSummaryAggregates,
    mockHandoverRecordCounts,
    createEmployeeProfile,
    createShiftRecord,
  };
};

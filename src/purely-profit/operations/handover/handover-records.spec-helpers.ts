import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { StoreSubAccountService } from '../../member/platform-membership/store-sub-account.service';
import {
  createHandoverPrismaMock,
  createManagerUser,
  createMockCandidates,
  createMockRecord,
  createOwnerUser,
  createStoreSubAccountServiceMock,
  createSubAccountUser,
} from './hover.spec-helpers';
import { HandoverRecordsDetailService } from './handover-records-detail.service';
import { HandoverRecordsQueryService } from './handover-records-query.service';
import { HandoverRecordsRevenueService } from './handover-records-revenue.service';
import { HandoverRecordsService } from './handover-records.service';
import { HandoverRecordsViewContextService } from './handover-records-view-context.service';

type HandoverPrismaMock = ReturnType<typeof createHandoverPrismaMock>;
type StoreSubAccountServiceMock = ReturnType<
  typeof createStoreSubAccountServiceMock
>;

export const setupHandoverRecordsSpec = (): {
  readonly service: HandoverRecordsService;
  readonly prismaService: HandoverPrismaMock;
  readonly storeSubAccountService: StoreSubAccountServiceMock;
  readonly ownerUser: ReturnType<typeof createOwnerUser>;
  readonly subAccountUser: ReturnType<typeof createSubAccountUser>;
  readonly managerUser: ReturnType<typeof createManagerUser>;
  readonly mockRecord: ReturnType<typeof createMockRecord>;
  readonly mockCandidates: ReturnType<typeof createMockCandidates>;
} => {
  const prismaService = createHandoverPrismaMock();
  const storeSubAccountService = createStoreSubAccountServiceMock();
  const ownerUser = createOwnerUser();
  const subAccountUser = createSubAccountUser();
  const managerUser = createManagerUser();
  const mockRecord = createMockRecord();
  const mockCandidates = createMockCandidates();

  let service: HandoverRecordsService | null = null;

  const getService = (): HandoverRecordsService => {
    if (!service) {
      throw new Error('HandoverRecordsService 尚未完成初始化');
    }

    return service;
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    prismaService.employee.findUnique.mockResolvedValue({ linkedStaffId: 1 });
    prismaService.saleOrderItem.findMany.mockResolvedValue([]);
    prismaService.saleOrder.findMany.mockResolvedValue([]);
    prismaService.saleOrder.count.mockResolvedValue(0);
    prismaService.saleOrder.aggregate.mockResolvedValue({
      _sum: { totalRevenue: null },
    });
    prismaService.spaceSession.aggregate.mockResolvedValue({
      _sum: { timeCost: null },
    });
    prismaService.financeCashFlowRecord.aggregate.mockResolvedValue({
      _sum: { amount: null },
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HandoverRecordsService,
        HandoverRecordsQueryService,
        HandoverRecordsDetailService,
        HandoverRecordsRevenueService,
        HandoverRecordsViewContextService,
        { provide: PrismaService, useValue: prismaService },
        {
          provide: StoreSubAccountService,
          useValue: storeSubAccountService,
        },
      ],
    }).compile();

    service = module.get<HandoverRecordsService>(HandoverRecordsService);
  });

  return {
    get service(): HandoverRecordsService {
      return getService();
    },
    prismaService,
    storeSubAccountService,
    ownerUser,
    subAccountUser,
    managerUser,
    mockRecord,
    mockCandidates,
  };
};

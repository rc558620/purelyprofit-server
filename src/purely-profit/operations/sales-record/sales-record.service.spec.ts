import { Test, TestingModule } from '@nestjs/testing';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import type {
  CreateSalesRecordDto,
  ListSalesProductsQueryDto,
  ListSalesRecordsQueryDto,
  SalesRecordResponseDto,
  SalesReportQueryDto,
  SalesStatsQueryDto,
} from './dto/sales-record.dto';
import type { CreateSalesRecordOptions } from './sales-record-item-preparation.service';
import { SalesRecordReadService } from './sales-record-read.service';
import { SalesRecordService } from './sales-record.service';
import { SalesRecordWriteService } from './sales-record-write.service';

describe('SalesRecordService', () => {
  let service: SalesRecordService;

  const salesRecordReadService = {
    listProducts: jest.fn(),
    list: jest.fn(),
    listFrontendOrders: jest.fn(),
    getStats: jest.fn(),
    getReport: jest.fn(),
  };

  const salesRecordWriteService = {
    create: jest.fn(),
    remove: jest.fn(),
  };

  const user: AuthenticatedUser = {
    id: 1,
    email: 'boss@example.com',
    phone: '13800138000',
    name: '老板',
    createdAt: new Date('2026-05-12T00:00:00.000Z'),
    updatedAt: new Date('2026-05-13T00:00:00.000Z'),
    currentMembership: {
      staffId: 8,
      storeId: 18,
      role: 'OWNER',
      permissions: ['*'],
      isActive: true,
      subjectType: 'owner',
      linkedEmployeeId: null,
      subAccountId: null,
      subAccountRole: null,
      subAccountStatus: null,
      subAccountAssigned: false,
      canAccessHome: true,
      canUseHandover: true,
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalesRecordService,
        { provide: SalesRecordReadService, useValue: salesRecordReadService },
        { provide: SalesRecordWriteService, useValue: salesRecordWriteService },
      ],
    }).compile();

    service = module.get<SalesRecordService>(SalesRecordService);
  });

  it('listProducts 会透传给 read service', async () => {
    const query: ListSalesProductsQueryDto = { storeId: 18, keyword: '可乐' };
    salesRecordReadService.listProducts.mockResolvedValue([{ id: '201' }]);

    await expect(service.listProducts(user, query)).resolves.toEqual([
      { id: '201' },
    ]);
    expect(salesRecordReadService.listProducts).toHaveBeenCalledWith(
      user,
      query,
    );
  });

  it('list 会透传给 read service', async () => {
    const query: ListSalesRecordsQueryDto = { storeId: 18, period: 'all' };
    salesRecordReadService.list.mockResolvedValue({
      items: [{ id: '11' }],
      meta: { page: 1, pageSize: 1, total: 1, totalPages: 1 },
    });

    await expect(service.list(user, query)).resolves.toEqual({
      items: [{ id: '11' }],
      meta: { page: 1, pageSize: 1, total: 1, totalPages: 1 },
    });
    expect(salesRecordReadService.list).toHaveBeenCalledWith(user, query);
  });

  it('listFrontendOrders 会透传给 read service', async () => {
    const query: ListSalesRecordsQueryDto = { storeId: 18 };
    salesRecordReadService.listFrontendOrders.mockResolvedValue({
      items: [{ id: '11' }],
      meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    });

    await expect(service.listFrontendOrders(user, query)).resolves.toEqual({
      items: [{ id: '11' }],
      meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    });
    expect(salesRecordReadService.listFrontendOrders).toHaveBeenCalledWith(
      user,
      query,
    );
  });

  it('getStats 会透传给 read service', async () => {
    const query: SalesStatsQueryDto = { storeId: 18, period: 'today' };
    salesRecordReadService.getStats.mockResolvedValue({ totalRevenue: 200 });

    await expect(service.getStats(user, query)).resolves.toEqual({
      totalRevenue: 200,
    });
    expect(salesRecordReadService.getStats).toHaveBeenCalledWith(user, query);
  });

  it('getReport 会透传给 read service', async () => {
    const query: SalesReportQueryDto = { storeId: 18, period: 'month' };
    salesRecordReadService.getReport.mockResolvedValue({
      summary: { totalRevenue: 49.5 },
      dailySales: [],
    });

    await expect(service.getReport(user, query)).resolves.toEqual({
      summary: { totalRevenue: 49.5 },
      dailySales: [],
    });
    expect(salesRecordReadService.getReport).toHaveBeenCalledWith(user, query);
  });

  it('create 会透传给 write service', async () => {
    const dto = {
      storeId: 18,
      items: [],
      totalRevenue: 0,
      totalProfit: 0,
      totalQuantity: 1,
      paymentMethod: 'cash',
      calcMode: 'business',
    } as unknown as CreateSalesRecordDto;
    const options: CreateSalesRecordOptions = {
      skipInventoryValidationAndDeduction: true,
    };
    const response: Partial<SalesRecordResponseDto> = { id: '11' };
    salesRecordWriteService.create.mockResolvedValue(response);

    await expect(service.create(user, dto, options)).resolves.toEqual(response);
    expect(salesRecordWriteService.create).toHaveBeenCalledWith(
      user,
      dto,
      options,
    );
  });

  it('remove 会透传给 write service', async () => {
    salesRecordWriteService.remove.mockResolvedValue(undefined);

    await expect(service.remove(user, 11)).resolves.toBeUndefined();
    expect(salesRecordWriteService.remove).toHaveBeenCalledWith(user, 11);
  });
});

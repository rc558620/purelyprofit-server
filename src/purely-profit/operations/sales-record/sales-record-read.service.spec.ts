import { Test, TestingModule } from '@nestjs/testing';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import type {
  ListSalesProductsQueryDto,
  ListSalesRecordsQueryDto,
  SalesReportQueryDto,
  SalesStatsQueryDto,
} from './dto/sales-record.dto';
import { SalesRecordListService } from './sales-record-list.service';
import { SalesRecordProductsService } from './sales-record-products.service';
import { SalesRecordReadService } from './sales-record-read.service';
import { SalesRecordReportService } from './sales-record-report.service';
import { SalesRecordStatsService } from './sales-record-stats.service';

describe('SalesRecordReadService', () => {
  let service: SalesRecordReadService;

  const salesRecordProductsService = {
    listProducts: jest.fn(),
  };

  const salesRecordListService = {
    list: jest.fn(),
    listFrontendOrders: jest.fn(),
  };

  const salesRecordStatsService = {
    getStats: jest.fn(),
  };

  const salesRecordReportService = {
    getReport: jest.fn(),
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
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalesRecordReadService,
        {
          provide: SalesRecordProductsService,
          useValue: salesRecordProductsService,
        },
        { provide: SalesRecordListService, useValue: salesRecordListService },
        { provide: SalesRecordStatsService, useValue: salesRecordStatsService },
        {
          provide: SalesRecordReportService,
          useValue: salesRecordReportService,
        },
      ],
    }).compile();

    service = module.get<SalesRecordReadService>(SalesRecordReadService);
  });

  it('listProducts 会透传给 products service', async () => {
    const query: ListSalesProductsQueryDto = { storeId: 18, keyword: '可乐' };
    salesRecordProductsService.listProducts.mockResolvedValue([{ id: '201' }]);

    await expect(service.listProducts(user, query)).resolves.toEqual([
      { id: '201' },
    ]);
    expect(salesRecordProductsService.listProducts).toHaveBeenCalledWith(
      user,
      query,
    );
  });

  it('list 会透传给 list service', async () => {
    const query: ListSalesRecordsQueryDto = { storeId: 18, period: 'all' };
    salesRecordListService.list.mockResolvedValue({
      items: [{ id: '11' }],
      meta: { page: 1, pageSize: 1, total: 1, totalPages: 1 },
    });

    await expect(service.list(user, query)).resolves.toEqual({
      items: [{ id: '11' }],
      meta: { page: 1, pageSize: 1, total: 1, totalPages: 1 },
    });
    expect(salesRecordListService.list).toHaveBeenCalledWith(user, query);
  });

  it('listFrontendOrders 会透传给 list service', async () => {
    const query: ListSalesRecordsQueryDto = { storeId: 18 };
    salesRecordListService.listFrontendOrders.mockResolvedValue({
      items: [{ id: '11' }],
      meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    });

    await expect(service.listFrontendOrders(user, query)).resolves.toEqual({
      items: [{ id: '11' }],
      meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    });
    expect(salesRecordListService.listFrontendOrders).toHaveBeenCalledWith(
      user,
      query,
    );
  });

  it('getStats 会透传给 stats service', async () => {
    const query: SalesStatsQueryDto = { storeId: 18, period: 'today' };
    salesRecordStatsService.getStats.mockResolvedValue({ totalRevenue: 200 });

    await expect(service.getStats(user, query)).resolves.toEqual({
      totalRevenue: 200,
    });
    expect(salesRecordStatsService.getStats).toHaveBeenCalledWith(user, query);
  });

  it('getReport 会透传给 report service', async () => {
    const query: SalesReportQueryDto = { storeId: 18, period: 'month' };
    salesRecordReportService.getReport.mockResolvedValue({
      summary: { totalRevenue: 49.5 },
      dailySales: [],
    });

    await expect(service.getReport(user, query)).resolves.toEqual({
      summary: { totalRevenue: 49.5 },
      dailySales: [],
    });
    expect(salesRecordReportService.getReport).toHaveBeenCalledWith(
      user,
      query,
    );
  });
});

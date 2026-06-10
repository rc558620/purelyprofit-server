import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { CostsReadService } from './costs-read.service';
import {
  createCostsCommerceAccessServiceMock,
  createCostsPlatformMembershipAccessServiceMock,
  createCostsPrismaMock,
  createCostsReadProviders,
  createCostsSpecUser,
} from './costs.spec-helpers';

describe('CostsReadService', () => {
  let service: CostsReadService;
  let prismaService: ReturnType<typeof createCostsPrismaMock>;
  let commerceAccessService: ReturnType<
    typeof createCostsCommerceAccessServiceMock
  >;
  let platformMembershipAccessService: ReturnType<
    typeof createCostsPlatformMembershipAccessServiceMock
  >;
  const user = createCostsSpecUser();

  beforeEach(async () => {
    prismaService = createCostsPrismaMock();
    commerceAccessService = createCostsCommerceAccessServiceMock();
    platformMembershipAccessService =
      createCostsPlatformMembershipAccessServiceMock();
    platformMembershipAccessService.clampHistoryRange.mockImplementation(
      (_storeId: number, range: { start: number; end: number }) =>
        Promise.resolve({
          start: range.start,
          end: range.end,
          clamped: false,
          empty: false,
        }),
    );
    platformMembershipAccessService.ensureReportExportEnabled.mockResolvedValue(
      undefined,
    );
    platformMembershipAccessService.getHistoryWindowStart.mockResolvedValue(
      null,
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: createCostsReadProviders(
        prismaService,
        commerceAccessService,
        platformMembershipAccessService,
      ),
    }).compile();

    service = module.get<CostsReadService>(CostsReadService);
  });

  it('listRecords 返回按前端结构映射后的成本记录', async () => {
    commerceAccessService.resolveViewStoreId.mockResolvedValue(18);
    prismaService.costRecord.findMany.mockResolvedValue([
      {
        id: 1,
        title: '房租',
        type: 'fixed',
        category: 'rent',
        sourceType: 'manual',
        amount: new Prisma.Decimal('5000.00'),
        note: '5 月房租',
        date: new Date('2026-05-01T00:00:00.000Z'),
        createdAt: new Date('2026-05-14T10:00:00.000Z'),
      },
    ]);

    await expect(
      service.listRecords(user, { period: 'month', typeFilter: 'fixed' }),
    ).resolves.toEqual([
      {
        id: '1',
        title: '房租',
        type: 'fixed',
        category: 'rent',
        amount: 5000,
        note: '5 月房租',
        date: new Date('2026-05-01T00:00:00.000Z').getTime(),
        sourceType: 'manual',
        deletable: true,
        createdAt: new Date('2026-05-14T10:00:00.000Z').getTime(),
      },
    ]);
  });

  it('getStats 计算总额、固定/变动支出与上期对比', async () => {
    commerceAccessService.resolveViewStoreId.mockResolvedValue(18);
    prismaService.costRecord.aggregate
      .mockResolvedValueOnce({
        _sum: { amount: new Prisma.Decimal('5300') },
        _count: { _all: 2 },
      })
      .mockResolvedValueOnce({
        _sum: { amount: new Prisma.Decimal('4240') },
      });
    prismaService.costRecord.groupBy.mockResolvedValue([
      {
        type: 'fixed',
        _sum: { amount: new Prisma.Decimal('5000') },
      },
      {
        type: 'variable',
        _sum: { amount: new Prisma.Decimal('300') },
      },
    ]);

    await expect(
      service.getStats(user, { period: 'month', typeFilter: 'all' }),
    ).resolves.toEqual({
      total: 5300,
      fixed: 5000,
      variable: 300,
      compareLastPeriod: 25,
      recordCount: 2,
    });
  });

  it('getStats 在自定义日期模式下不返回上期对比', async () => {
    commerceAccessService.resolveViewStoreId.mockResolvedValue(18);
    prismaService.costRecord.aggregate.mockResolvedValue({
      _sum: { amount: new Prisma.Decimal('1888') },
      _count: { _all: 1 },
    });
    prismaService.costRecord.groupBy.mockResolvedValue([
      {
        type: 'fixed',
        _sum: { amount: new Prisma.Decimal('1888') },
      },
    ]);

    await expect(
      service.getStats(user, {
        period: 'custom_month',
        customDate: new Date('2026-05-14T00:00:00.000Z').getTime(),
        typeFilter: 'all',
      }),
    ).resolves.toEqual({
      total: 1888,
      fixed: 1888,
      variable: 0,
      compareLastPeriod: null,
      recordCount: 1,
    });
    expect(prismaService.costRecord.aggregate).toHaveBeenCalledTimes(1);
  });

  it('listRecords 在 custom_range 结束早于开始时按前端逻辑钳制到开始日', async () => {
    commerceAccessService.resolveViewStoreId.mockResolvedValue(18);
    prismaService.costRecord.findMany.mockResolvedValue([]);

    const rangeStartDate = new Date(2026, 4, 20, 0, 0, 0, 0).getTime();
    const rangeEndDate = new Date(2026, 4, 10, 0, 0, 0, 0).getTime();

    await service.listRecords(user, {
      period: 'custom_range',
      rangeStartDate,
      rangeEndDate,
    });

    expect(prismaService.costRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          date: {
            gte: new Date(2026, 4, 20, 0, 0, 0, 0),
            lte: new Date(2026, 4, 20, 0, 0, 0, 0),
          },
        }),
      }),
    );
  });

  it('listRecords 会为自动沉淀记录返回不可删除标记', async () => {
    commerceAccessService.resolveViewStoreId.mockResolvedValue(18);
    prismaService.costRecord.findMany.mockResolvedValue([
      {
        id: 3,
        title: '王五2026-05工资',
        type: 'fixed',
        category: 'salary',
        sourceType: 'payroll_salary',
        amount: new Prisma.Decimal('5000.00'),
        note: '含加班',
        date: new Date('2026-05-01T00:00:00.000Z'),
        createdAt: new Date('2026-05-14T12:00:00.000Z'),
      },
    ]);

    await expect(
      service.listRecords(user, { period: 'month' }),
    ).resolves.toEqual([
      {
        id: '3',
        title: '王五2026-05工资',
        type: 'fixed',
        category: 'salary',
        amount: 5000,
        note: '含加班',
        date: new Date('2026-05-01T00:00:00.000Z').getTime(),
        sourceType: 'payroll_salary',
        deletable: false,
        createdAt: new Date('2026-05-14T12:00:00.000Z').getTime(),
      },
    ]);
  });

  it('getReport 返回报表中心成本分类汇总与上期对比', async () => {
    commerceAccessService.resolveViewStoreId.mockResolvedValue(18);
    prismaService.costRecord.findMany
      .mockResolvedValueOnce([
        {
          id: 1,
          title: '房租',
          type: 'fixed',
          category: 'rent',
          amount: new Prisma.Decimal('5000.00'),
          note: '5 月房租',
          date: new Date('2026-05-01T00:00:00.000Z'),
          createdAt: new Date('2026-05-14T10:00:00.000Z'),
        },
        {
          id: 2,
          title: '营销物料',
          type: 'variable',
          category: 'marketing',
          amount: new Prisma.Decimal('300.00'),
          note: null,
          date: new Date('2026-05-14T00:00:00.000Z'),
          createdAt: new Date('2026-05-14T10:05:00.000Z'),
        },
      ]);
    prismaService.costRecord.aggregate.mockResolvedValue({
      _sum: { amount: new Prisma.Decimal('4240.00') },
    });

    await expect(
      service.getReport(user, {
        storeId: 18,
        period: 'month',
        categoryFilter: 'all',
      }),
    ).resolves.toEqual({
      summary: {
        total: 5300,
        fixed: 5000,
        variable: 300,
        recordCount: 2,
        compareLastPeriod: 25,
      },
      categories: [
        {
          label: '租金',
          amount: 5000,
          percentage: 94.34,
          color: '#6366f1',
        },
        {
          label: '营销',
          amount: 300,
          percentage: 5.66,
          color: '#3b82f6',
        },
      ],
      detailRows: [],
    });
    expect(prismaService.employeePayroll.findMany).not.toHaveBeenCalled();
  });

  it('getReport 在 salary 分类下会合并工资草稿明细', async () => {
    commerceAccessService.resolveViewStoreId.mockResolvedValue(18);
    prismaService.costRecord.findMany
      .mockResolvedValueOnce([
        {
          id: 3,
          title: '王五2026-05工资',
          type: 'fixed',
          category: 'salary',
          amount: new Prisma.Decimal('5000.00'),
          note: '含加班',
          date: new Date('2026-05-01T00:00:00.000Z'),
          createdAt: new Date('2026-05-14T12:00:00.000Z'),
        },
      ]);
    prismaService.costRecord.aggregate.mockResolvedValue({
      _sum: { amount: new Prisma.Decimal('4000.00') },
    });
    prismaService.employeePayroll.findMany.mockResolvedValue([
      {
        id: 8,
        employeeName: '赵六',
        month: '2026-05',
        actualSalary: new Prisma.Decimal('4200.00'),
        note: '待确认',
      },
    ]);

    await expect(
      service.getReport(user, {
        storeId: 18,
        period: 'month',
        categoryFilter: 'salary',
      }),
    ).resolves.toEqual({
      summary: {
        total: 5000,
        fixed: 5000,
        variable: 0,
        recordCount: 1,
        compareLastPeriod: 25,
      },
      categories: [
        {
          label: '工资',
          amount: 5000,
          percentage: 100,
          color: '#f97316',
        },
      ],
      detailRows: [
        {
          id: '3',
          title: '王五2026-05工资',
          amount: 5000,
          date: new Date('2026-05-01T00:00:00.000Z').getTime(),
          dateLabel: '2026/05/01',
          note: '含加班',
        },
        {
          id: '8',
          title: '[草稿] 赵六 2026-05 工资',
          amount: 4200,
          date: new Date(2026, 4, 1, 0, 0, 0, 0).getTime(),
          dateLabel: '2026-05',
          note: '待确认',
        },
      ],
    });
  });
});

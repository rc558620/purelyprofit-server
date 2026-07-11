import { Test, TestingModule } from '@nestjs/testing';
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
        amount: 500000, // 5000 元 = 500000 分
        note: '5 月房租',
        date: new Date('2026-05-01T00:00:00.000Z'),
        createdAt: new Date('2026-05-14T10:00:00.000Z'),
      },
    ]);
    prismaService.costRecord.count.mockResolvedValue(1);

    await expect(
      service.listRecords(user, { period: 'month', typeFilter: 'fixed' }),
    ).resolves.toEqual({
      items: [
        {
          id: '1',
          title: '房租',
          type: 'fixed',
          category: 'rent',
          amount: 5000, // 分→元
          note: '5 月房租',
          date: new Date('2026-05-01T00:00:00.000Z').getTime(),
          sourceType: 'manual',
          deletable: true,
          createdAt: new Date('2026-05-14T10:00:00.000Z').getTime(),
        },
      ],
      meta: {
        page: 1,
        pageSize: 20,
        total: 1,
        totalPages: 1,
      },
    });
  });

  it('getStats 计算总额、固定/变动支出与上期对比', async () => {
    commerceAccessService.resolveViewStoreId.mockResolvedValue(18);
    prismaService.costRecord.aggregate
      .mockResolvedValueOnce({
        _sum: { amount: 530000 }, // 5300 元 = 530000 分
        _count: { _all: 2 },
      })
      .mockResolvedValueOnce({
        _sum: { amount: 424000 }, // 4240 元 = 424000 分
      });
    prismaService.costRecord.groupBy.mockResolvedValue([
      {
        type: 'fixed',
        _sum: { amount: 500000 }, // 5000 元
      },
      {
        type: 'variable',
        _sum: { amount: 30000 }, // 300 元
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
      _sum: { amount: 188800 }, // 1888 元 = 188800 分
      _count: { _all: 1 },
    });
    prismaService.costRecord.groupBy.mockResolvedValue([
      {
        type: 'fixed',
        _sum: { amount: 188800 }, // 1888 元
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
      compareLastPeriod: 0,
      recordCount: 1,
    });
    expect(prismaService.costRecord.aggregate).toHaveBeenCalledTimes(2);
  });

  it('listRecords 在 custom_range 结束早于开始时自动纠正为正确区间', async () => {
    commerceAccessService.resolveViewStoreId.mockResolvedValue(18);
    prismaService.costRecord.findMany.mockResolvedValue([]);
    prismaService.costRecord.count.mockResolvedValue(0);

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
            gte: new Date(2026, 4, 10, 0, 0, 0, 0),
            lte: new Date(2026, 4, 20, 23, 59, 59, 999),
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
        amount: 500000, // 5000 元 = 500000 分
        note: '含加班',
        date: new Date('2026-05-01T00:00:00.000Z'),
        createdAt: new Date('2026-05-14T12:00:00.000Z'),
      },
    ]);
    prismaService.costRecord.count.mockResolvedValue(1);

    const result = await service.listRecords(user, { period: 'month' });
    expect(result).toEqual({
      items: [
        {
          id: '3',
          title: '王五2026-05工资',
          type: 'fixed',
          category: 'salary',
          amount: 5000, // 分→元
          note: '含加班',
          date: new Date('2026-05-01T00:00:00.000Z').getTime(),
          sourceType: 'payroll_salary',
          deletable: false,
          createdAt: new Date('2026-05-14T12:00:00.000Z').getTime(),
        },
      ],
      meta: {
        page: 1,
        pageSize: 20,
        total: 1,
        totalPages: 1,
      },
    });
  });

  it('getReport 返回报表中心成本分类汇总与上期对比', async () => {
    commerceAccessService.resolveViewStoreId.mockResolvedValue(18);
    prismaService.costRecord.findMany.mockResolvedValueOnce([
      {
        id: 1,
        title: '房租',
        type: 'fixed',
        category: 'rent',
        amount: 500000, // 5000 元
        note: '5 月房租',
        date: new Date('2026-05-01T00:00:00.000Z'),
        createdAt: new Date('2026-05-14T10:00:00.000Z'),
      },
      {
        id: 2,
        title: '营销物料',
        type: 'variable',
        category: 'marketing',
        amount: 30000, // 300 元
        note: null,
        date: new Date('2026-05-14T00:00:00.000Z'),
        createdAt: new Date('2026-05-14T10:05:00.000Z'),
      },
    ]);
    prismaService.costRecord.aggregate
      .mockResolvedValueOnce({
        _sum: { amount: 424000 }, // 4240 元 = 424000 分（上期）
      })
      .mockResolvedValueOnce({
        _sum: { amount: 530000 }, // 5300 元 = 530000 分（本期）
        _count: { _all: 2 },
      });
    prismaService.costRecord.groupBy
      .mockResolvedValueOnce([
        { type: 'fixed', _sum: { amount: 500000 } }, // 5000 元
        { type: 'variable', _sum: { amount: 30000 } }, // 300 元
      ])
      .mockResolvedValueOnce([
        { category: 'rent', _sum: { amount: 500000 } }, // 5000 元
        { category: 'marketing', _sum: { amount: 30000 } }, // 300 元
      ]);

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
        fixedPercentage: 94.34,
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
      detailRows: [
        {
          id: '2',
          title: '营销物料',
          amount: 300,
          date: new Date('2026-05-14T00:00:00.000Z').getTime(),
          dateLabel: '2026/05/14',
        },
        {
          id: '1',
          title: '房租',
          amount: 5000,
          date: new Date('2026-05-01T00:00:00.000Z').getTime(),
          dateLabel: '2026/05/01',
          note: '5 月房租',
        },
      ],
    });
    expect(prismaService.employeePayroll.findMany).not.toHaveBeenCalled();
  });

  it('getReport 在 salary 分类下汇总仅含已确认记录，草稿明细标记 draft', async () => {
    commerceAccessService.resolveViewStoreId.mockResolvedValue(18);
    // Mock 返回多分类数据 —— 验证 categoryFilter='salary' 只查 salary 行
    prismaService.costRecord.findMany.mockResolvedValueOnce([
      {
        id: 3,
        title: '王五2026-05工资',
        type: 'fixed',
        category: 'salary',
        amount: 500000, // 5000 元
        note: '含加班',
        date: new Date('2026-05-01T00:00:00.000Z'),
        createdAt: new Date('2026-05-14T12:00:00.000Z'),
      },
    ]);
    prismaService.costRecord.aggregate
      .mockResolvedValueOnce({
        _sum: { amount: 400000 }, // 4000 元 = 400000 分（上期）
      })
      .mockResolvedValueOnce({
        _sum: { amount: 500000 }, // 5000 元 = 500000 分（本期）
        _count: { _all: 1 },
      });
    prismaService.costRecord.groupBy
      .mockResolvedValueOnce([
        { type: 'fixed', _sum: { amount: 500000 } }, // 5000 元
      ])
      .mockResolvedValueOnce([
        { category: 'salary', _sum: { amount: 500000 } }, // 5000 元
      ]);
    prismaService.employeePayroll.findMany.mockResolvedValue([
      {
        id: 8,
        employeeName: '赵六',
        month: new Date('2026-05-01T00:00:00.000Z'),
        actualSalary: 420000, // 4200 元 = 420000 分
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
        fixedPercentage: 100,
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
          amount: 5000, // 分→元
          date: new Date('2026-05-01T00:00:00.000Z').getTime(),
          dateLabel: '2026/05/01',
          note: '含加班',
        },
        {
          id: '8',
          title: '[草稿] 赵六 2026-05 工资',
          amount: 4200, // 分→元
          date: new Date('2026-05-01T00:00:00.000Z').getTime(),
          dateLabel: '2026-05',
          draft: true,
          note: '待确认',
        },
      ],
    });

    // 验证 findMany 查询条件包含 category 过滤
    expect(prismaService.costRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          category: 'salary',
        }),
      }),
    );
    // 验证 aggregate（上期对比）查询条件包含 category 过滤
    expect(prismaService.costRecord.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          category: 'salary',
        }),
      }),
    );
  });

  it('getReport 在 rent 分类下只统计租金分类数据', async () => {
    commerceAccessService.resolveViewStoreId.mockResolvedValue(18);
    prismaService.costRecord.findMany.mockResolvedValueOnce([
      {
        id: 1,
        title: '房租',
        type: 'fixed',
        category: 'rent',
        amount: 500000, // 5000 元
        note: '5 月房租',
        date: new Date('2026-05-01T00:00:00.000Z'),
        createdAt: new Date('2026-05-14T10:00:00.000Z'),
      },
    ]);
    prismaService.costRecord.aggregate
      .mockResolvedValueOnce({
        _sum: { amount: 450000 }, // 4500 元 = 450000 分（上期）
      })
      .mockResolvedValueOnce({
        _sum: { amount: 500000 }, // 5000 元 = 500000 分（本期）
        _count: { _all: 1 },
      });
    prismaService.costRecord.groupBy
      .mockResolvedValueOnce([
        { type: 'fixed', _sum: { amount: 500000 } }, // 5000 元
      ])
      .mockResolvedValueOnce([
        { category: 'rent', _sum: { amount: 500000 } }, // 5000 元
      ]);

    await expect(
      service.getReport(user, {
        storeId: 18,
        period: 'month',
        categoryFilter: 'rent',
      }),
    ).resolves.toEqual({
      summary: {
        total: 5000,
        fixed: 5000,
        variable: 0,
        fixedPercentage: 100,
        recordCount: 1,
        compareLastPeriod: 11.11,
      },
      categories: [
        {
          label: '租金',
          amount: 5000,
          percentage: 100,
          color: '#6366f1',
        },
      ],
      detailRows: [
        {
          id: '1',
          title: '房租',
          amount: 5000, // 分→元
          date: new Date('2026-05-01T00:00:00.000Z').getTime(),
          dateLabel: '2026/05/01',
          note: '5 月房租',
        },
      ],
    });

    // 验证 findMany 查询条件包含 category 过滤
    expect(prismaService.costRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          category: 'rent',
        }),
      }),
    );
    // 验证 aggregate（上期对比）查询条件包含 category 过滤
    expect(prismaService.costRecord.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          category: 'rent',
        }),
      }),
    );
    // 非 salary 分类不应查 payroll 草稿
    expect(prismaService.employeePayroll.findMany).not.toHaveBeenCalled();
  });
});

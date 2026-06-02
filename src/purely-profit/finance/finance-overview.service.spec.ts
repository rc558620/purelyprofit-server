import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { FinanceAccountStatus, Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { FinanceOverviewService } from './finance-overview.service';
import {
  createFinanceOverviewPrismaMock,
  createFinanceOverviewProviders,
  createFinanceSpecUser,
  createPlatformMembershipAccessServiceMock,
  useFinanceSpecFakeTimers,
  useFinanceSpecRealTimers,
} from './finance.spec-helpers';

describe('FinanceOverviewService', () => {
  let service: FinanceOverviewService;
  let prismaService: ReturnType<typeof createFinanceOverviewPrismaMock>;
  let platformMembershipAccessService: ReturnType<
    typeof createPlatformMembershipAccessServiceMock
  >;

  const user: AuthenticatedUser = createFinanceSpecUser();

  beforeEach(async () => {
    useFinanceSpecFakeTimers();
    prismaService = createFinanceOverviewPrismaMock();
    platformMembershipAccessService =
      createPlatformMembershipAccessServiceMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: createFinanceOverviewProviders(
        prismaService,
        platformMembershipAccessService,
      ),
    }).compile();

    service = module.get<FinanceOverviewService>(FinanceOverviewService);
  });

  afterEach(() => {
    useFinanceSpecRealTimers();
  });

  it('getOverview 在会员不支持财务管理时拒绝访问', async () => {
    platformMembershipAccessService.ensureFinanceFeatureEnabled.mockRejectedValue(
      new ForbiddenException('当前会员套餐暂不支持财务管理，请升级会员后使用'),
    );

    await expect(
      service.getOverview(user, { period: 'month' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prismaService.financeCashFlowRecord.findMany).not.toHaveBeenCalled();
  });

  it('getOverview 会按会员历史窗口裁剪查询范围', async () => {
    const clampedStart = new Date('2026-05-08T00:00:00.000Z').getTime();
    const clampedEnd = new Date('2026-05-14T23:59:59.999Z').getTime();

    platformMembershipAccessService.clampHistoryRange
      .mockResolvedValueOnce({
        start: clampedStart,
        end: clampedEnd,
        empty: false,
      })
      .mockResolvedValueOnce({
        start: new Date('2026-04-01T00:00:00.000Z').getTime(),
        end: new Date('2026-04-30T23:59:59.999Z').getTime(),
        empty: true,
      });
    prismaService.financeCashFlowRecord.findMany.mockResolvedValue([]);

    await service.getOverview(user, { period: 'month' });

    expect(prismaService.financeCashFlowRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          storeId: 18,
          date: {
            gte: new Date(clampedStart),
            lte: new Date(clampedEnd),
          },
        }),
      }),
    );
  });

  it('getOverview 在历史窗口被裁空时返回空结构', async () => {
    platformMembershipAccessService.clampHistoryRange.mockResolvedValueOnce({
      start: new Date('2026-05-08T00:00:00.000Z').getTime(),
      end: new Date('2026-05-07T23:59:59.999Z').getTime(),
      empty: true,
    });

    await expect(
      service.getOverview(user, { period: 'month' }),
    ).resolves.toMatchObject({
      heroSummary: {
        netIncome: { current: 0, previous: 0, changeRate: null },
        totalIncome: { current: 0, previous: 0, changeRate: null },
        totalExpense: { current: 0, previous: 0, changeRate: null },
        profitRate: { current: 0, previous: 0, changeRate: 0 },
        incomeExpenseRatio: null,
      },
      dailyTrend: [],
      incomeGroup: {
        total: 0,
        items: [
          { type: 'sales', amount: 0, percent: 0 },
          { type: 'additional', amount: 0, percent: 0 },
        ],
      },
      expenseGroup: {
        total: 0,
        items: [
          { type: 'cost', amount: 0, percent: 0 },
          { type: 'purchase', amount: 0, percent: 0 },
        ],
      },
    });
    expect(prismaService.financeCashFlowRecord.findMany).not.toHaveBeenCalled();
  });

  it('getOverview 将 refund/transfer_in/other_income 统一归到附加收入', async () => {
    prismaService.financeCashFlowRecord.findMany.mockResolvedValue([
      {
        category: 'sales',
        amount: new Prisma.Decimal('1000.00'),
        date: new Date('2026-05-12T10:00:00.000Z'),
      },
      {
        category: 'refund',
        amount: new Prisma.Decimal('80.00'),
        date: new Date('2026-05-12T11:00:00.000Z'),
      },
      {
        category: 'transfer_in',
        amount: new Prisma.Decimal('20.00'),
        date: new Date('2026-05-13T09:00:00.000Z'),
      },
      {
        category: 'other_income',
        amount: new Prisma.Decimal('200.00'),
        date: new Date('2026-05-13T10:00:00.000Z'),
      },
      {
        category: 'purchase',
        amount: new Prisma.Decimal('300.00'),
        date: new Date('2026-05-11T10:00:00.000Z'),
      },
      {
        category: 'rent',
        amount: new Prisma.Decimal('100.00'),
        date: new Date('2026-05-10T10:00:00.000Z'),
      },
      {
        category: 'sales',
        amount: new Prisma.Decimal('500.00'),
        date: new Date('2026-04-20T10:00:00.000Z'),
      },
      {
        category: 'refund',
        amount: new Prisma.Decimal('50.00'),
        date: new Date('2026-04-21T10:00:00.000Z'),
      },
      {
        category: 'purchase',
        amount: new Prisma.Decimal('100.00'),
        date: new Date('2026-04-25T10:00:00.000Z'),
      },
    ]);

    await expect(
      service.getOverview(user, { period: 'month' }),
    ).resolves.toMatchObject({
      heroSummary: {
        netIncome: { current: 900, previous: 450, changeRate: 100 },
        totalIncome: { current: 1300, previous: 550, changeRate: 136.36 },
        totalExpense: { current: 400, previous: 100, changeRate: 300 },
        profitRate: { current: 69.23, previous: 81.82, changeRate: -12.59 },
        incomeExpenseRatio: 3.25,
      },
      incomeGroup: {
        total: 1300,
        items: [
          { type: 'sales', amount: 1000, percent: 77 },
          { type: 'additional', amount: 300, percent: 23 },
        ],
      },
      expenseGroup: {
        total: 400,
        items: [
          { type: 'cost', amount: 100, percent: 25 },
          { type: 'purchase', amount: 300, percent: 75 },
        ],
      },
    });
  });

  it('getOverview 将 salary/transfer_out/other_expense 统一归到成本支出', async () => {
    prismaService.financeCashFlowRecord.findMany.mockResolvedValue([
      {
        category: 'salary',
        amount: new Prisma.Decimal('50.00'),
        date: new Date('2026-05-12T10:00:00.000Z'),
      },
      {
        category: 'transfer_out',
        amount: new Prisma.Decimal('30.00'),
        date: new Date('2026-05-13T11:00:00.000Z'),
      },
      {
        category: 'other_expense',
        amount: new Prisma.Decimal('20.00'),
        date: new Date('2026-05-13T12:00:00.000Z'),
      },
      {
        category: 'purchase',
        amount: new Prisma.Decimal('40.00'),
        date: new Date('2026-05-13T13:00:00.000Z'),
      },
    ]);

    await expect(
      service.getOverview(user, { period: 'month' }),
    ).resolves.toMatchObject({
      incomeGroup: {
        total: 0,
        items: [
          { type: 'sales', amount: 0, percent: 0 },
          { type: 'additional', amount: 0, percent: 0 },
        ],
      },
      expenseGroup: {
        total: 140,
        items: [
          { type: 'cost', amount: 100, percent: 71 },
          { type: 'purchase', amount: 40, percent: 29 },
        ],
      },
    });
  });

  it('getReport 在导出时校验报表导出权限', async () => {
    platformMembershipAccessService.ensureReportExportEnabled.mockRejectedValueOnce(
      new ForbiddenException('当前会员套餐不支持导出报表，请升级会员后使用'),
    );

    await expect(
      service.getReport(user, {
        period: 'month',
        export: true,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(
      platformMembershipAccessService.ensureReportExportEnabled,
    ).toHaveBeenCalledWith(18, false);
    expect(prismaService.financeCashFlowRecord.findMany).not.toHaveBeenCalled();
  });

  it('getReport 返回报表中心财务契约并支持 year 周期', async () => {
    prismaService.financeCashFlowRecord.findMany
      .mockResolvedValueOnce([
        {
          id: 1,
          direction: 'income',
          category: 'sales',
          title: '午市营业额',
          amount: new Prisma.Decimal('500.00'),
          payment: 'wechat',
          note: null,
          date: new Date('2025-05-14T10:00:00.000Z'),
          createdAt: new Date('2025-05-14T10:05:00.000Z'),
        },
        {
          id: 2,
          direction: 'expense',
          category: 'purchase',
          title: '采购牛奶',
          amount: new Prisma.Decimal('120.00'),
          payment: 'bank',
          note: null,
          date: new Date('2025-05-13T08:00:00.000Z'),
          createdAt: new Date('2025-05-13T08:05:00.000Z'),
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 3,
          direction: 'income',
          category: 'sales',
          title: '去年营业额',
          amount: new Prisma.Decimal('300.00'),
          payment: 'cash',
          note: null,
          date: new Date('2024-05-14T10:00:00.000Z'),
          createdAt: new Date('2024-05-14T10:05:00.000Z'),
        },
        {
          id: 4,
          direction: 'expense',
          category: 'rent',
          title: '去年房租',
          amount: new Prisma.Decimal('100.00'),
          payment: 'bank',
          note: null,
          date: new Date('2024-05-02T10:00:00.000Z'),
          createdAt: new Date('2024-05-02T10:05:00.000Z'),
        },
      ]);
    prismaService.financeAccountRecord.findMany.mockResolvedValue([
      {
        id: 8,
        type: 'receivable',
        category: 'sales_credit',
        counterpart: '张三水果店',
        amount: new Prisma.Decimal('500.00'),
        paidAmount: new Prisma.Decimal('200.00'),
        remaining: new Prisma.Decimal('300.00'),
        status: FinanceAccountStatus.partial,
        dueDate: null,
        date: new Date('2025-05-12T10:00:00.000Z'),
        note: null,
        createdAt: new Date('2025-05-12T10:10:00.000Z'),
        updatedAt: new Date('2025-05-12T10:10:00.000Z'),
      },
      {
        id: 9,
        type: 'payable',
        category: 'supplier_debt',
        counterpart: '供应商A',
        amount: new Prisma.Decimal('260.00'),
        paidAmount: new Prisma.Decimal('60.00'),
        remaining: new Prisma.Decimal('200.00'),
        status: FinanceAccountStatus.partial,
        dueDate: null,
        date: new Date('2025-05-10T10:00:00.000Z'),
        note: null,
        createdAt: new Date('2025-05-10T10:10:00.000Z'),
        updatedAt: new Date('2025-05-10T10:10:00.000Z'),
      },
      {
        id: 10,
        type: 'payable',
        category: 'loan',
        counterpart: '银行',
        amount: new Prisma.Decimal('100.00'),
        paidAmount: new Prisma.Decimal('100.00'),
        remaining: new Prisma.Decimal('0.00'),
        status: FinanceAccountStatus.settled,
        dueDate: null,
        date: new Date('2025-05-01T10:00:00.000Z'),
        note: null,
        createdAt: new Date('2025-05-01T10:10:00.000Z'),
        updatedAt: new Date('2025-05-01T10:10:00.000Z'),
      },
    ]);

    await expect(
      service.getReport(user, {
        period: 'year',
        year: 2025,
      }),
    ).resolves.toEqual({
      summary: {
        totalIncome: 500,
        totalExpense: 120,
        netCashFlow: 380,
        recordCount: 2,
        receivableTotal: 300,
        payableTotal: 200,
        compareLastPeriod: 90,
      },
      cashFlowRows: [
        {
          id: '1',
          dateLabel: '2025-5-14',
          title: '午市营业额',
          direction: 'income',
          categoryLabel: '销售收入',
          amount: 500,
          paymentLabel: '微信',
        },
        {
          id: '2',
          dateLabel: '2025-5-13',
          title: '采购牛奶',
          direction: 'expense',
          categoryLabel: '采购进货',
          amount: 120,
          paymentLabel: '银行转账',
        },
      ],
      accountRows: [
        {
          id: '8',
          type: 'receivable',
          typeLabel: '应收',
          counterpart: '张三水果店',
          amount: 500,
          remaining: 300,
          statusLabel: '部分收付',
          statusKey: 'partial',
          dateLabel: '2025-5-12',
        },
        {
          id: '9',
          type: 'payable',
          typeLabel: '应付',
          counterpart: '供应商A',
          amount: 260,
          remaining: 200,
          statusLabel: '部分收付',
          statusKey: 'partial',
          dateLabel: '2025-5-10',
        },
      ],
    });

    expect(
      prismaService.financeCashFlowRecord.findMany,
    ).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          storeId: 18,
          date: {
            gte: new Date(2025, 0, 1, 0, 0, 0, 0),
            lte: new Date(2025, 11, 31, 23, 59, 59, 999),
          },
        }),
      }),
    );
    expect(
      prismaService.financeCashFlowRecord.findMany,
    ).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          storeId: 18,
          date: {
            gte: new Date(2024, 0, 1, 0, 0, 0, 0),
            lte: new Date(2024, 11, 31, 23, 59, 59, 999),
          },
        }),
      }),
    );
  });
});

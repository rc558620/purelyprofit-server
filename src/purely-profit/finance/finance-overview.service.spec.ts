import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { ServerResponse } from 'node:http';
import { FinanceAccountStatus, Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { RefreshableCacheService } from '../../redis/refreshable-cache.service';
import { FinanceOverviewService } from './finance-overview.service';
import { iterateFinanceReportCashFlowRows } from './finance-overview-report.query';
import { FINANCE_REPORT_ACCOUNT_ROW_LIMIT } from './finance.constants';
import {
  createFinanceOverviewPrismaMock,
  createFinanceOverviewProviders,
  createFinanceSpecUser,
  createMembershipAccessContextMock,
  createMembershipRuleSnapshotMock,
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
  let refreshableCache: {
    getOrLoadRefreshableJson: jest.Mock;
  };

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
    refreshableCache = module.get(RefreshableCacheService);
  });

  afterEach(() => {
    useFinanceSpecRealTimers();
  });

  it('getOverview 在会员不支持财务管理时拒绝访问', async () => {
    platformMembershipAccessService.createMembershipAccessContext.mockResolvedValueOnce(
      createMembershipAccessContextMock({
        snapshot: createMembershipRuleSnapshotMock({ financeEnabled: false }),
      }),
    );

    await expect(
      service.getOverview(user, { period: 'month' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prismaService.$queryRaw).not.toHaveBeenCalled();
  });

  it('getOverview 会按会员历史窗口裁剪查询范围，且只读一次会员档案', async () => {
    const clampedStart = new Date('2026-05-08T00:00:00.000Z').getTime();
    const clampedEnd = new Date('2026-05-14T23:59:59.999Z').getTime();
    const clamp = jest
      .fn()
      .mockReturnValueOnce({
        start: clampedStart,
        end: clampedEnd,
        empty: false,
      })
      .mockReturnValueOnce({
        start: new Date('2026-04-01T00:00:00.000Z').getTime(),
        end: new Date('2026-04-30T23:59:59.999Z').getTime(),
        empty: true,
      });

    platformMembershipAccessService.createMembershipAccessContext.mockResolvedValueOnce(
      createMembershipAccessContextMock({ clamp }),
    );
    prismaService.$queryRaw.mockResolvedValue([]);

    await service.getOverview(user, { period: 'month' });

    // 类目合计（本期 + 上期合并）与趋势各一条 SQL
    expect(prismaService.$queryRaw).toHaveBeenCalledTimes(2);
    const trendParams = prismaService.$queryRaw.mock.calls[1]?.slice(1);
    expect(trendParams).toContain(18);
    expect(trendParams).toContainEqual(new Date(clampedStart));
    expect(trendParams).toContainEqual(new Date(clampedEnd));
    // 本期 / 上期裁剪共用同一份会员档案：1 次读档 + 2 次纯内存裁剪
    expect(
      platformMembershipAccessService.createMembershipAccessContext,
    ).toHaveBeenCalledTimes(1);
    expect(clamp).toHaveBeenCalledTimes(2);
  });

  it('getOverview 在历史窗口被裁空时返回空结构', async () => {
    platformMembershipAccessService.createMembershipAccessContext.mockResolvedValueOnce(
      createMembershipAccessContextMock({
        clamp: () => ({
          start: new Date('2026-05-08T00:00:00.000Z').getTime(),
          end: new Date('2026-05-07T23:59:59.999Z').getTime(),
          empty: true,
        }),
      }),
    );

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
    expect(prismaService.$queryRaw).not.toHaveBeenCalled();
  });

  it('getOverview 将 refund 归到成本支出、transfer_in/other_income 归到附加收入', async () => {
    // 第一条 SQL：本期 + 上期合并的类目合计；第二条 SQL：趋势
    prismaService.$queryRaw
      .mockResolvedValueOnce([
        { category: 'sales', current_total: 100000, previous_total: 50000 },
        { category: 'refund', current_total: 8000, previous_total: 5000 },
        { category: 'transfer_in', current_total: 2000, previous_total: null },
        {
          category: 'other_income',
          current_total: 20000,
          previous_total: null,
        },
        { category: 'purchase', current_total: 30000, previous_total: 10000 },
        { category: 'rent', current_total: 10000, previous_total: null },
      ])
      .mockResolvedValueOnce([
        {
          period_start: new Date('2026-05-10T00:00:00.000Z'),
          income_total: new Prisma.Decimal('0.00'),
          expense_total: new Prisma.Decimal('10000.00'),
        },
        {
          period_start: new Date('2026-05-12T00:00:00.000Z'),
          income_total: new Prisma.Decimal('108000.00'),
          expense_total: new Prisma.Decimal('0.00'),
        },
        {
          period_start: new Date('2026-05-13T00:00:00.000Z'),
          income_total: new Prisma.Decimal('22000.00'),
          expense_total: new Prisma.Decimal('30000.00'),
        },
      ]);

    await expect(
      service.getOverview(user, { period: 'month' }),
    ).resolves.toMatchObject({
      heroSummary: {
        netIncome: { current: 740, previous: 350, changeRate: 111.4 },
        totalIncome: { current: 1220, previous: 500, changeRate: 144 },
        totalExpense: { current: 480, previous: 150, changeRate: 220 },
        profitRate: {
          current: 60.66,
          previous: 70,
          changeRate: expect.closeTo(-9.34, 2),
        },
        incomeExpenseRatio: 2.54,
      },
      incomeGroup: {
        total: 1220,
        items: [
          { type: 'sales', amount: 1000, percent: 81.97 },
          { type: 'additional', amount: 220, percent: 18.03 },
        ],
      },
      expenseGroup: {
        total: 480,
        items: [
          { type: 'cost', amount: 180, percent: 37.5 },
          { type: 'purchase', amount: 300, percent: 62.5 },
        ],
      },
    });
  });

  it('getOverview 将 salary/transfer_out/other_expense 统一归到成本支出', async () => {
    // 第一条 SQL：本期 + 上期合并的类目合计（上期无数据即 previous_total 为 null）；第二条：趋势
    prismaService.$queryRaw
      .mockResolvedValueOnce([
        { category: 'salary', current_total: 5000, previous_total: null },
        { category: 'transfer_out', current_total: 3000, previous_total: null },
        {
          category: 'other_expense',
          current_total: 2000,
          previous_total: null,
        },
        { category: 'purchase', current_total: 4000, previous_total: null },
      ])
      .mockResolvedValueOnce([
        {
          period_start: new Date('2026-05-12T00:00:00.000Z'),
          income_total: new Prisma.Decimal('0.00'),
          expense_total: new Prisma.Decimal('5000.00'),
        },
        {
          period_start: new Date('2026-05-13T00:00:00.000Z'),
          income_total: new Prisma.Decimal('0.00'),
          expense_total: new Prisma.Decimal('9000.00'),
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
          { type: 'cost', amount: 100, percent: 71.43 },
          { type: 'purchase', amount: 40, percent: 28.57 },
        ],
      },
    });
  });

  it('getReport 在导出时校验报表导出权限', async () => {
    platformMembershipAccessService.createMembershipAccessContext.mockResolvedValueOnce(
      createMembershipAccessContextMock({
        snapshot: createMembershipRuleSnapshotMock({
          reportExportEnabled: false,
        }),
      }),
    );

    await expect(
      service.getReport(user, {
        period: 'month',
        export: true,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prismaService.financeCashFlowRecord.findMany).not.toHaveBeenCalled();
  });

  it('getReport 会将 custom_month 解析为整月区间并对比上月', async () => {
    prismaService.financeCashFlowRecord.findMany.mockResolvedValueOnce([]);
    prismaService.financeCashFlowRecord.groupBy.mockResolvedValue([]);
    prismaService.financeAccountRecord.findMany.mockResolvedValue([]);

    await service.getReport(user, {
      period: 'custom_month',
      customDate: new Date('2025-05-14T10:00:00.000Z').getTime(),
    });

    expect(
      prismaService.financeCashFlowRecord.findMany,
    ).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          storeId: 18,
          date: {
            gte: new Date(2025, 4, 1, 0, 0, 0, 0),
            lte: new Date(2025, 4, 31, 23, 59, 59, 999),
          },
        }),
      }),
    );
    expect(prismaService.financeCashFlowRecord.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          storeId: 18,
          date: {
            gte: new Date(2025, 3, 1, 0, 0, 0, 0),
            lte: new Date(2025, 3, 30, 23, 59, 59, 999),
          },
        }),
      }),
    );
  });

  it('iterateFinanceReportCashFlowRows 会 keyset 分批拉取直到取完，不再按固定上限截断', async () => {
    const buildRow = (id: number, day: number) => ({
      id,
      direction: 'income' as const,
      category: 'sales' as const,
      title: `流水${id}`,
      amount: id * 100,
      payment: 'cash' as const,
      date: new Date(`2025-05-${String(day).padStart(2, '0')}T10:00:00.000Z`),
      createdAt: new Date(
        `2025-05-${String(day).padStart(2, '0')}T10:05:00.000Z`,
      ),
    });
    prismaService.financeCashFlowRecord.findMany
      .mockResolvedValueOnce([buildRow(5, 14), buildRow(4, 13)])
      .mockResolvedValueOnce([buildRow(3, 12)]);

    const collected: Array<{ id: number }> = [];
    for await (const row of iterateFinanceReportCashFlowRows(
      prismaService as unknown as PrismaService,
      {
        storeId: 18,
        range: {
          start: new Date('2025-05-01T00:00:00.000Z').getTime(),
          end: new Date('2025-05-31T23:59:59.999Z').getTime(),
          empty: false,
        },
      },
      2,
    )) {
      collected.push(row);
    }

    expect(collected.map((row) => row.id)).toEqual([5, 4, 3]);
    expect(prismaService.financeCashFlowRecord.findMany).toHaveBeenCalledTimes(
      2,
    );
    // 第二批必须带 keyset 游标（date / createdAt / id 三级比较），否则翻页会重复或漏读
    const secondCallWhere =
      prismaService.financeCashFlowRecord.findMany.mock.calls[1][0].where;
    expect(secondCallWhere.AND[1]).toEqual({
      OR: [
        { date: { lt: new Date('2025-05-13T10:00:00.000Z') } },
        {
          date: new Date('2025-05-13T10:00:00.000Z'),
          createdAt: { lt: new Date('2025-05-13T10:05:00.000Z') },
        },
        {
          date: new Date('2025-05-13T10:00:00.000Z'),
          createdAt: new Date('2025-05-13T10:05:00.000Z'),
          id: { lt: 4 },
        },
      ],
    });
  });

  it('streamReportCsv 只查现金流水明细，不再重复计算汇总与账款行', async () => {
    prismaService.financeCashFlowRecord.findMany.mockResolvedValueOnce([
      {
        id: 1,
        direction: 'income',
        category: 'sales',
        title: '午市营业额',
        amount: 50000,
        payment: 'wechat',
        date: new Date('2025-05-14T10:00:00.000Z'),
        createdAt: new Date('2025-05-14T10:05:00.000Z'),
      },
    ]);
    const reply = {
      setHeader: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
    };

    await service.streamReportCsv(reply as unknown as ServerResponse, user, {
      period: 'year',
      year: 2025,
      export: true,
    });

    expect(prismaService.financeCashFlowRecord.findMany).toHaveBeenCalledTimes(
      1,
    );
    // 汇总、上期对比、账款行都不在 CSV 列里，不应再触发这些查询
    expect(prismaService.financeCashFlowRecord.groupBy).not.toHaveBeenCalled();
    expect(prismaService.financeCashFlowRecord.count).not.toHaveBeenCalled();
    expect(prismaService.financeAccountRecord.findMany).not.toHaveBeenCalled();
    // BOM + 表头 + 1 行数据
    expect(reply.write).toHaveBeenCalledTimes(3);
    expect(reply.end).toHaveBeenCalledTimes(1);
  });

  it('getReport 返回报表中心财务契约并支持 year 周期', async () => {
    prismaService.financeCashFlowRecord.findMany.mockResolvedValueOnce([
      {
        id: 1,
        direction: 'income',
        category: 'sales',
        title: '午市营业额',
        amount: new Prisma.Decimal('50000.00'),
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
        amount: new Prisma.Decimal('12000.00'),
        payment: 'bank',
        note: null,
        date: new Date('2025-05-13T08:00:00.000Z'),
        createdAt: new Date('2025-05-13T08:05:00.000Z'),
      },
    ]);
    // 汇总走 SQL 聚合：第一次为本期、第二次为上期；条数与金额同一次扫描产出
    prismaService.financeCashFlowRecord.groupBy
      .mockResolvedValueOnce([
        {
          direction: 'income',
          _sum: { amount: new Prisma.Decimal('50000.00') },
          _count: { _all: 1 },
        },
        {
          direction: 'expense',
          _sum: { amount: new Prisma.Decimal('12000.00') },
          _count: { _all: 1 },
        },
      ])
      .mockResolvedValueOnce([
        {
          direction: 'income',
          _sum: { amount: new Prisma.Decimal('30000.00') },
          _count: { _all: 1 },
        },
        {
          direction: 'expense',
          _sum: { amount: new Prisma.Decimal('10000.00') },
          _count: { _all: 1 },
        },
      ]);
    prismaService.financeAccountRecord.findMany.mockResolvedValue([
      {
        id: 8,
        type: 'receivable',
        category: 'sales_credit',
        counterpart: '张三水果店',
        amount: new Prisma.Decimal('50000.00'),
        paidAmount: new Prisma.Decimal('20000.00'),
        remaining: new Prisma.Decimal('30000.00'),
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
        amount: new Prisma.Decimal('26000.00'),
        paidAmount: new Prisma.Decimal('6000.00'),
        remaining: new Prisma.Decimal('20000.00'),
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
        amount: new Prisma.Decimal('10000.00'),
        paidAmount: new Prisma.Decimal('10000.00'),
        remaining: new Prisma.Decimal('0.00'),
        status: FinanceAccountStatus.settled,
        dueDate: null,
        date: new Date('2025-05-01T10:00:00.000Z'),
        note: null,
        createdAt: new Date('2025-05-01T10:10:00.000Z'),
        updatedAt: new Date('2025-05-01T10:10:00.000Z'),
      },
    ]);
    // 未结清账款合计由 SQL 聚合产出（不再用明细行累加）
    prismaService.financeAccountRecord.groupBy.mockResolvedValue([
      {
        type: 'receivable',
        _sum: { remaining: new Prisma.Decimal('30000.00') },
      },
      {
        type: 'payable',
        _sum: { remaining: new Prisma.Decimal('20000.00') },
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
      // 现金流水明细需精确到时间，dateLabel 为「YYYY-MM-DD HH:mm」（上海时区）
      cashFlowRows: [
        {
          id: '1',
          dateLabel: '2025-05-14 18:05',
          title: '午市营业额',
          direction: 'income',
          categoryLabel: '销售收入',
          amount: 500,
          paymentLabel: '微信',
        },
        {
          id: '2',
          dateLabel: '2025-05-13 16:05',
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
          dateLabel: '2025-05-12 18:10',
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
          dateLabel: '2025-05-10 18:10',
        },
      ],
      cashFlowTruncated: false,
      accountTruncated: false,
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
    expect(prismaService.financeCashFlowRecord.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['direction'],
        where: expect.objectContaining({
          storeId: 18,
          date: {
            gte: new Date(2024, 0, 1, 0, 0, 0, 0),
            lte: new Date(2024, 11, 31, 23, 59, 59, 999),
          },
        }),
        _sum: { amount: true },
      }),
    );
    expect(prismaService.financeAccountRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          storeId: 18,
          remaining: { gt: 0 },
        },
        // 明细行上限收敛，避免整包写进 Redis；多取一行用于探测截断
        take: FINANCE_REPORT_ACCOUNT_ROW_LIMIT + 1,
      }),
    );
    // 合计口径与明细口径同源（remaining > 0），保证「已结清不计入」不被破坏
    expect(prismaService.financeAccountRecord.groupBy).toHaveBeenCalledWith({
      by: ['type'],
      where: { storeId: 18, remaining: { gt: 0 } },
      _sum: { remaining: true },
    });
    // 本期条数已并入汇总 groupBy 的 _count，不再单独发 COUNT
    expect(prismaService.financeCashFlowRecord.count).not.toHaveBeenCalled();
    // 报表账款行只取渲染所需列，避免把 note / category / updatedAt 一起写进缓存
    expect(
      prismaService.financeAccountRecord.findMany.mock.calls[0]?.[0]?.select,
    ).toEqual({
      id: true,
      type: true,
      counterpart: true,
      amount: true,
      paidAmount: true,
      remaining: true,
      status: true,
      dueDate: true,
      createdAt: true,
    });
  });

  it('getReport 把概况与明细行拆成两个缓存 key，且明细行用更短 TTL', async () => {
    prismaService.financeCashFlowRecord.findMany.mockResolvedValue([]);
    prismaService.financeCashFlowRecord.groupBy.mockResolvedValue([]);
    prismaService.financeAccountRecord.findMany.mockResolvedValue([]);
    prismaService.financeAccountRecord.groupBy.mockResolvedValue([]);

    await service.getReport(user, { period: 'month' });

    expect(refreshableCache.getOrLoadRefreshableJson).toHaveBeenCalledTimes(2);
    const [summaryOptions, rowsOptions] =
      refreshableCache.getOrLoadRefreshableJson.mock.calls.map(
        (call) => call[0],
      );

    // 概况：7 个数字，保持原有 120s / 30s 节奏
    expect(summaryOptions.cacheKey).toBe(
      'profit:finance:report:store:18:scope:owner:period:month:year:na:customDate:na:rangeStart:na:rangeEnd:na:part:summary',
    );
    expect(summaryOptions.ttlSeconds).toBe(120);
    // 明细行：940 KB 级别的值单独放，TTL 更短，新增流水更快可见
    expect(rowsOptions.cacheKey).toBe(
      'profit:finance:report:store:18:scope:owner:period:month:year:na:customDate:na:rangeStart:na:rangeEnd:na:part:rows',
    );
    expect(rowsOptions.ttlSeconds).toBe(30);
    // 两个 key 必须落在同一个失效前缀下，否则写操作会漏清一半
    expect(
      summaryOptions.cacheKey.startsWith('profit:finance:report:store:18:'),
    ).toBe(true);
    expect(
      rowsOptions.cacheKey.startsWith('profit:finance:report:store:18:'),
    ).toBe(true);
  });

  it('子账号报表直接查库，不写入任何一个缓存 part', async () => {
    // 子账号判定来自 user.currentMembership.subjectType，而不是会员档案
    const subAccountUser: AuthenticatedUser = {
      ...user,
      currentMembership: {
        ...user.currentMembership!,
        subjectType: 'sub_account',
      },
    };
    prismaService.financeCashFlowRecord.findMany.mockResolvedValue([]);
    prismaService.financeCashFlowRecord.groupBy.mockResolvedValue([]);
    prismaService.financeAccountRecord.findMany.mockResolvedValue([]);
    prismaService.financeAccountRecord.groupBy.mockResolvedValue([]);

    await expect(
      service.getReport(subAccountUser, { period: 'month' }),
    ).resolves.toEqual({
      summary: expect.objectContaining({ recordCount: 0 }),
      cashFlowRows: [],
      accountRows: [],
      cashFlowTruncated: false,
      accountTruncated: false,
    });
    expect(refreshableCache.getOrLoadRefreshableJson).not.toHaveBeenCalled();
  });
});

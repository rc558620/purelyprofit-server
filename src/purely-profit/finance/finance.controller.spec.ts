import { Test, TestingModule } from '@nestjs/testing';
import { PermissionsGuard } from '../access-control/guards/permissions.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';

const ALLOW_GUARD = { canActivate: jest.fn(() => true) };

describe('FinanceController', () => {
  let controller: FinanceController;

  const financeService = {
    getOverview: jest.fn(),
    getReport: jest.fn(),
    listCashFlowRecords: jest.fn(),
    getCashFlowStats: jest.fn(),
    createCashFlowRecord: jest.fn(),
    deleteCashFlowRecord: jest.fn(),
    listAccounts: jest.fn(),
    getAccountsStats: jest.fn(),
    createAccount: jest.fn(),
    settleAccount: jest.fn(),
    deleteAccount: jest.fn(),
    listReconciliations: jest.fn(),
    getReconciliationStats: jest.fn(),
    createReconciliation: jest.fn(),
    confirmReconciliation: jest.fn(),
    deleteReconciliation: jest.fn(),
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
    const moduleBuilder = Test.createTestingModule({
      controllers: [FinanceController],
      providers: [{ provide: FinanceService, useValue: financeService }],
    });
    moduleBuilder.overrideGuard(JwtAuthGuard).useValue(ALLOW_GUARD);
    moduleBuilder.overrideGuard(PermissionsGuard).useValue(ALLOW_GUARD);
    const module: TestingModule = await moduleBuilder.compile();

    controller = module.get<FinanceController>(FinanceController);
  });

  it('getOverview 透传当前用户与 query', async () => {
    const response = {
      heroSummary: {
        netIncome: { current: 800, previous: 400, changeRate: 100 },
        totalIncome: { current: 1200, previous: 500, changeRate: 140 },
        totalExpense: { current: 400, previous: 100, changeRate: 300 },
        profitRate: { current: 66.67, previous: 80, changeRate: -13.33 },
        incomeExpenseRatio: 3,
      },
      dailyTrend: [],
      incomeGroup: { direction: 'income' as const, total: 1200, items: [] },
      expenseGroup: { direction: 'expense' as const, total: 400, items: [] },
    };
    financeService.getOverview.mockResolvedValue(response);

    await expect(
      controller.getOverview(user, { period: 'month' }),
    ).resolves.toEqual(response);
    expect(financeService.getOverview).toHaveBeenCalledWith(user, {
      period: 'month',
    });
  });

  it('getReport 透传当前用户与 query', async () => {
    const response = {
      summary: {
        totalIncome: 3200,
        totalExpense: 1200,
        netCashFlow: 2000,
        recordCount: 2,
        receivableTotal: 800,
        payableTotal: 300,
        compareLastPeriod: 25,
      },
      cashFlowRows: [],
      accountRows: [],
    };
    const query = {
      period: 'year' as const,
      year: 2025,
    };
    financeService.getReport.mockResolvedValue(response);

    await expect(controller.getReport(user, query)).resolves.toEqual(response);
    expect(financeService.getReport).toHaveBeenCalledWith(user, query);
  });

  it('cash-flow 相关路由分别转发到 service', async () => {
    const listResponse = {
      items: [
        {
          id: '1',
          direction: 'income',
          category: 'sales',
          title: '午市营业额',
          amount: 128.5,
          payment: 'cash',
          date: 1747180800000,
          createdAt: 1747184400000,
        },
      ],
      meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    };
    const statsResponse = {
      totalIncome: 128.5,
      totalExpense: 20,
      netFlow: 108.5,
      recordCount: 1,
      compareLastPeriod: 16.5,
    };
    const createDto = {
      direction: 'income' as const,
      category: 'sales' as const,
      title: '午市营业额',
      amount: 128.5,
      payment: 'cash' as const,
      date: 1747180800000,
    };
    const recordResponse = {
      id: '1',
      ...createDto,
      createdAt: 1747184400000,
    };
    financeService.listCashFlowRecords.mockResolvedValue(listResponse);
    financeService.getCashFlowStats.mockResolvedValue(statsResponse);
    financeService.createCashFlowRecord.mockResolvedValue(recordResponse);
    financeService.deleteCashFlowRecord.mockResolvedValue(undefined);

    await expect(
      controller.listCashFlowRecords(user, {
        period: 'month',
        directionFilter: 'income',
        page: 1,
        pageSize: 20,
      }),
    ).resolves.toEqual(listResponse);
    await expect(
      controller.getCashFlowStats(user, { period: 'week' }),
    ).resolves.toEqual(statsResponse);
    await expect(
      controller.createCashFlowRecord(user, createDto),
    ).resolves.toEqual(recordResponse);
    await expect(
      controller.deleteCashFlowRecord(user, 9),
    ).resolves.toBeUndefined();

    expect(financeService.listCashFlowRecords).toHaveBeenCalledWith(user, {
      period: 'month',
      directionFilter: 'income',
      page: 1,
      pageSize: 20,
    });
    expect(financeService.getCashFlowStats).toHaveBeenCalledWith(user, {
      period: 'week',
    });
    expect(financeService.createCashFlowRecord).toHaveBeenCalledWith(
      user,
      createDto,
    );
    expect(financeService.deleteCashFlowRecord).toHaveBeenCalledWith(user, 9);
  });

  it('accounts 相关路由分别转发到 service', async () => {
    const listResponse = {
      items: [
        {
          id: '2',
          type: 'receivable',
          category: 'sales_credit',
          counterpart: '张三水果店',
          amount: 5000,
          paidAmount: 1000,
          remaining: 4000,
          status: 'partial',
          date: 1747180800000,
          createdAt: 1747184400000,
          updatedAt: 1747188000000,
        },
      ],
      meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    };
    const statsResponse = {
      totalReceivable: 4000,
      totalPayable: 1500,
      netReceivable: 2500,
      overdueCount: 1,
      newThisMonth: 2,
    };
    const createDto = {
      type: 'receivable' as const,
      category: 'sales_credit' as const,
      counterpart: '张三水果店',
      amount: 5000,
      paidAmount: 1000,
      date: 1747180800000,
      note: '月底前结清',
    };
    const settleDto = { payAmount: 500 };
    financeService.listAccounts.mockResolvedValue(listResponse);
    financeService.getAccountsStats.mockResolvedValue(statsResponse);
    financeService.createAccount.mockResolvedValue(listResponse.items[0]);
    financeService.settleAccount.mockResolvedValue({
      ...listResponse.items[0],
      paidAmount: 1500,
      remaining: 3500,
    });
    financeService.deleteAccount.mockResolvedValue(undefined);

    await expect(
      controller.listAccounts(user, {
        typeFilter: 'receivable',
        statusFilter: 'partial',
        page: 1,
        pageSize: 20,
      }),
    ).resolves.toEqual(listResponse);
    await expect(controller.getAccountsStats(user)).resolves.toEqual(
      statsResponse,
    );
    await expect(controller.createAccount(user, createDto)).resolves.toEqual(
      listResponse.items[0],
    );
    await expect(controller.settleAccount(user, 2, settleDto)).resolves.toEqual(
      {
        ...listResponse.items[0],
        paidAmount: 1500,
        remaining: 3500,
      },
    );
    await expect(controller.deleteAccount(user, 2)).resolves.toBeUndefined();

    expect(financeService.listAccounts).toHaveBeenCalledWith(user, {
      typeFilter: 'receivable',
      statusFilter: 'partial',
      page: 1,
      pageSize: 20,
    });
    expect(financeService.getAccountsStats).toHaveBeenCalledWith(user);
    expect(financeService.createAccount).toHaveBeenCalledWith(user, createDto);
    expect(financeService.settleAccount).toHaveBeenCalledWith(
      user,
      2,
      settleDto,
    );
    expect(financeService.deleteAccount).toHaveBeenCalledWith(user, 2);
  });

  it('reconciliation 相关路由分别转发到 service', async () => {
    const listResponse = {
      items: [
        {
          id: '3',
          title: '5月月度对账',
          type: 'monthly',
          status: 'discrepancy',
          periodStart: 1746057600000,
          periodEnd: 1748735999999,
          bookIncome: 12000,
          bookExpense: 8000,
          bookNet: 4000,
          actualIncome: 11800,
          actualExpense: 8100,
          actualNet: 3700,
          diffAmount: -300,
          items: [],
          date: 1747180800000,
          createdAt: 1747184400000,
          updatedAt: 1747188000000,
        },
      ],
      meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    };
    const statsResponse = {
      totalCount: 1,
      confirmedCount: 0,
      discrepancyCount: 1,
      adjustedCount: 0,
      draftCount: 0,
      totalDiffAmount: 300,
      newThisMonth: 1,
    };
    const createDto = {
      title: '5月月度对账',
      type: 'monthly' as const,
      status: 'discrepancy' as const,
      periodStart: 1746057600000,
      periodEnd: 1748735999999,
      bookIncome: 12000,
      bookExpense: 8000,
      actualIncome: 11800,
      actualExpense: 8100,
      items: [],
      date: 1747180800000,
    };
    const confirmDto = { adjustNote: '微信手续费差额' };
    financeService.listReconciliations.mockResolvedValue(listResponse);
    financeService.getReconciliationStats.mockResolvedValue(statsResponse);
    financeService.createReconciliation.mockResolvedValue(
      listResponse.items[0],
    );
    financeService.confirmReconciliation.mockResolvedValue({
      ...listResponse.items[0],
      status: 'adjusted',
      adjustNote: '微信手续费差额',
    });
    financeService.deleteReconciliation.mockResolvedValue(undefined);

    await expect(
      controller.listReconciliations(user, {
        statusFilter: 'discrepancy',
        page: 1,
        pageSize: 20,
      }),
    ).resolves.toEqual(listResponse);
    await expect(controller.getReconciliationStats(user)).resolves.toEqual(
      statsResponse,
    );
    await expect(
      controller.createReconciliation(user, createDto),
    ).resolves.toEqual(listResponse.items[0]);
    await expect(
      controller.confirmReconciliation(user, 3, confirmDto),
    ).resolves.toEqual({
      ...listResponse.items[0],
      status: 'adjusted',
      adjustNote: '微信手续费差额',
    });
    await expect(
      controller.deleteReconciliation(user, 3),
    ).resolves.toBeUndefined();

    expect(financeService.listReconciliations).toHaveBeenCalledWith(user, {
      statusFilter: 'discrepancy',
      page: 1,
      pageSize: 20,
    });
    expect(financeService.getReconciliationStats).toHaveBeenCalledWith(user);
    expect(financeService.createReconciliation).toHaveBeenCalledWith(
      user,
      createDto,
    );
    expect(financeService.confirmReconciliation).toHaveBeenCalledWith(
      user,
      3,
      confirmDto,
    );
    expect(financeService.deleteReconciliation).toHaveBeenCalledWith(user, 3);
  });
});

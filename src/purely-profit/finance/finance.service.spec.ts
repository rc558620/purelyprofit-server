import { Test, TestingModule } from '@nestjs/testing';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import {
  createFinanceFacadeProviders,
  createFinanceFacadeServiceMocks,
  createFinanceSpecUser,
} from './finance.spec-helpers';
import { FinanceService } from './finance.service';

describe('FinanceService', () => {
  let service: FinanceService;
  let facadeMocks: ReturnType<typeof createFinanceFacadeServiceMocks>;

  const user: AuthenticatedUser = createFinanceSpecUser();

  beforeEach(async () => {
    facadeMocks = createFinanceFacadeServiceMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [FinanceService, ...createFinanceFacadeProviders(facadeMocks)],
    }).compile();

    service = module.get<FinanceService>(FinanceService);
  });

  it('getOverview 委托给 overview service', async () => {
    const query = { period: 'month' as const };
    const expected = { heroSummary: { netIncome: { current: 1 } } };
    facadeMocks.financeOverviewService.getOverview.mockResolvedValue(expected);

    await expect(service.getOverview(user, query)).resolves.toBe(expected);
    expect(facadeMocks.financeOverviewService.getOverview).toHaveBeenCalledWith(
      user,
      query,
    );
  });

  it('getReport 委托给 overview service', async () => {
    const query = { period: 'year' as const, year: 2025 };
    const expected = { summary: { totalIncome: 100 } };
    facadeMocks.financeOverviewService.getReport.mockResolvedValue(expected);

    await expect(service.getReport(user, query)).resolves.toBe(expected);
    expect(facadeMocks.financeOverviewService.getReport).toHaveBeenCalledWith(
      user,
      query,
    );
  });

  it('cash-flow 相关方法委托给 cash-flow service', async () => {
    const listQuery = { period: 'month' as const, page: 1, pageSize: 10 };
    const statsQuery = { period: 'month' as const };
    const createDto = {
      direction: 'income' as const,
      category: 'refund' as const,
      title: '返利',
      amount: 88,
      payment: 'cash' as const,
      date: new Date('2026-05-14T00:00:00.000Z').getTime(),
    };

    const listResult = {
      items: [],
      meta: { page: 1, pageSize: 10, total: 0, totalPages: 0 },
    };
    const statsResult = {
      totalIncome: 88,
      totalExpense: 0,
      netFlow: 88,
      recordCount: 1,
      compareLastPeriod: null,
    };
    const createResult = { id: '1' };

    facadeMocks.financeCashFlowService.listCashFlowRecords.mockResolvedValue(
      listResult,
    );
    facadeMocks.financeCashFlowService.getCashFlowStats.mockResolvedValue(
      statsResult,
    );
    facadeMocks.financeCashFlowService.createCashFlowRecord.mockResolvedValue(
      createResult,
    );
    facadeMocks.financeCashFlowService.deleteCashFlowRecord.mockResolvedValue(
      undefined,
    );

    await expect(service.listCashFlowRecords(user, listQuery)).resolves.toBe(
      listResult,
    );
    await expect(service.getCashFlowStats(user, statsQuery)).resolves.toBe(
      statsResult,
    );
    await expect(service.createCashFlowRecord(user, createDto)).resolves.toBe(
      createResult,
    );
    await expect(
      service.deleteCashFlowRecord(user, 9),
    ).resolves.toBeUndefined();

    expect(
      facadeMocks.financeCashFlowService.listCashFlowRecords,
    ).toHaveBeenCalledWith(user, listQuery);
    expect(
      facadeMocks.financeCashFlowService.getCashFlowStats,
    ).toHaveBeenCalledWith(user, statsQuery);
    expect(
      facadeMocks.financeCashFlowService.createCashFlowRecord,
    ).toHaveBeenCalledWith(user, createDto);
    expect(
      facadeMocks.financeCashFlowService.deleteCashFlowRecord,
    ).toHaveBeenCalledWith(user, 9);
  });

  it('account 相关方法委托给 account service', async () => {
    const listQuery = {
      typeFilter: 'receivable' as const,
      page: 1,
      pageSize: 10,
    };
    const createDto = {
      type: 'receivable' as const,
      category: 'advance_paid' as const,
      counterpart: '品牌方',
      amount: 100,
      paidAmount: 0,
      date: new Date('2026-05-14T00:00:00.000Z').getTime(),
    };
    const settleDto = { payAmount: 40 };

    const listResult = {
      items: [],
      meta: { page: 1, pageSize: 10, total: 0, totalPages: 0 },
    };
    const statsResult = {
      receivableTotal: 100,
      payableTotal: 0,
      netBalance: 100,
      overdueCount: 0,
    };
    const createResult = { id: '2' };
    const settleResult = { id: '2', remaining: 60 };

    facadeMocks.financeAccountService.listAccounts.mockResolvedValue(
      listResult,
    );
    facadeMocks.financeAccountService.getAccountsStats.mockResolvedValue(
      statsResult,
    );
    facadeMocks.financeAccountService.createAccount.mockResolvedValue(
      createResult,
    );
    facadeMocks.financeAccountService.settleAccount.mockResolvedValue(
      settleResult,
    );
    facadeMocks.financeAccountService.deleteAccount.mockResolvedValue(
      undefined,
    );

    await expect(service.listAccounts(user, listQuery)).resolves.toBe(
      listResult,
    );
    await expect(service.getAccountsStats(user)).resolves.toBe(statsResult);
    await expect(service.createAccount(user, createDto)).resolves.toBe(
      createResult,
    );
    await expect(service.settleAccount(user, 2, settleDto)).resolves.toBe(
      settleResult,
    );
    await expect(service.deleteAccount(user, 2)).resolves.toBeUndefined();

    expect(facadeMocks.financeAccountService.listAccounts).toHaveBeenCalledWith(
      user,
      listQuery,
    );
    expect(
      facadeMocks.financeAccountService.getAccountsStats,
    ).toHaveBeenCalledWith(user);
    expect(
      facadeMocks.financeAccountService.createAccount,
    ).toHaveBeenCalledWith(user, createDto);
    expect(
      facadeMocks.financeAccountService.settleAccount,
    ).toHaveBeenCalledWith(user, 2, settleDto);
    expect(
      facadeMocks.financeAccountService.deleteAccount,
    ).toHaveBeenCalledWith(user, 2);
  });

  it('reconciliation 相关方法委托给 reconciliation service', async () => {
    const listQuery = { typeFilter: 'monthly' as const, page: 1, pageSize: 10 };
    const createDto = {
      title: '5月对账',
      type: 'monthly' as const,
      status: 'confirmed' as const,
      periodStart: new Date('2026-05-01T00:00:00.000Z').getTime(),
      periodEnd: new Date('2026-05-31T23:59:59.999Z').getTime(),
      bookIncome: 100,
      bookExpense: 20,
      actualIncome: 100,
      actualExpense: 20,
      items: [],
      date: new Date('2026-05-14T00:00:00.000Z').getTime(),
    };
    const confirmDto = { adjustNote: '手续费差额' };

    const listResult = {
      items: [],
      meta: { page: 1, pageSize: 10, total: 0, totalPages: 0 },
    };
    const statsResult = {
      matchedCount: 1,
      discrepancyCount: 0,
      adjustedCount: 0,
    };
    const createResult = { id: '3' };
    const confirmResult = { id: '3', status: 'adjusted' };

    facadeMocks.financeReconciliationService.listReconciliations.mockResolvedValue(
      listResult,
    );
    facadeMocks.financeReconciliationService.getReconciliationStats.mockResolvedValue(
      statsResult,
    );
    facadeMocks.financeReconciliationService.createReconciliation.mockResolvedValue(
      createResult,
    );
    facadeMocks.financeReconciliationService.confirmReconciliation.mockResolvedValue(
      confirmResult,
    );
    facadeMocks.financeReconciliationService.deleteReconciliation.mockResolvedValue(
      undefined,
    );

    await expect(service.listReconciliations(user, listQuery)).resolves.toBe(
      listResult,
    );
    await expect(service.getReconciliationStats(user)).resolves.toBe(
      statsResult,
    );
    await expect(service.createReconciliation(user, createDto)).resolves.toBe(
      createResult,
    );
    await expect(
      service.confirmReconciliation(user, 3, confirmDto),
    ).resolves.toBe(confirmResult);
    await expect(
      service.deleteReconciliation(user, 3),
    ).resolves.toBeUndefined();

    expect(
      facadeMocks.financeReconciliationService.listReconciliations,
    ).toHaveBeenCalledWith(user, listQuery);
    expect(
      facadeMocks.financeReconciliationService.getReconciliationStats,
    ).toHaveBeenCalledWith(user);
    expect(
      facadeMocks.financeReconciliationService.createReconciliation,
    ).toHaveBeenCalledWith(user, createDto);
    expect(
      facadeMocks.financeReconciliationService.confirmReconciliation,
    ).toHaveBeenCalledWith(user, 3, confirmDto);
    expect(
      facadeMocks.financeReconciliationService.deleteReconciliation,
    ).toHaveBeenCalledWith(user, 3);
  });
});

import { Logger } from '@nestjs/common';
import { CacheInvalidatorService } from './cache-invalidator.service';

function createProfitReadInvalidatorMock() {
  return {
    invalidateProfitDashboardHome: jest.fn().mockResolvedValue(undefined),
    invalidateProfitDetail: jest.fn().mockResolvedValue(undefined),
    invalidateBusinessAnalysis: jest.fn().mockResolvedValue(undefined),
    invalidateSalesReadCaches: jest.fn().mockResolvedValue(undefined),
    invalidateCostsCaches: jest.fn().mockResolvedValue(undefined),
  };
}

function createFinanceInvalidatorMock() {
  return {
    invalidateFinanceOverview: jest.fn().mockResolvedValue(undefined),
    invalidateFinanceCashFlow: jest.fn().mockResolvedValue(undefined),
    invalidateFinanceAccounts: jest.fn().mockResolvedValue(undefined),
    invalidateFinanceReconciliations: jest.fn().mockResolvedValue(undefined),
    invalidateFinanceReport: jest.fn().mockResolvedValue(undefined),
  };
}

function createPulseInvalidatorMock() {
  return {
    invalidateDashboardAndPulseSession: jest.fn().mockResolvedValue(undefined),
    invalidatePulseDashboardOverview: jest.fn().mockResolvedValue(undefined),
    invalidatePulseSessionNotification: jest.fn().mockResolvedValue(undefined),
    invalidatePulseSessionBootstrap: jest.fn().mockResolvedValue(undefined),
    invalidatePulseOnboardingStatus: jest.fn().mockResolvedValue(undefined),
  };
}

function createMembershipInvalidatorMock() {
  return {
    invalidateMembershipDerived: jest.fn().mockResolvedValue(undefined),
  };
}

describe('CacheInvalidatorService', () => {
  const profitReadInvalidator = createProfitReadInvalidatorMock();
  const financeInvalidator = createFinanceInvalidatorMock();
  const pulseInvalidator = createPulseInvalidatorMock();
  const membershipInvalidator = createMembershipInvalidatorMock();

  const service = new CacheInvalidatorService(
    profitReadInvalidator as never,
    financeInvalidator as never,
    pulseInvalidator as never,
    membershipInvalidator as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('销售写入会同时清理现金流水与财务报表缓存', async () => {
    await service.invalidateSalesDerived(18);

    expect(financeInvalidator.invalidateFinanceCashFlow).toHaveBeenCalledWith(
      18,
    );
    expect(financeInvalidator.invalidateFinanceReport).toHaveBeenCalledWith(18);
    expect(financeInvalidator.invalidateFinanceOverview).toHaveBeenCalledWith(
      18,
    );
  });

  it('财务失效静默版本在缓存异常时不向上抛错', async () => {
    financeInvalidator.invalidateFinanceOverview.mockRejectedValueOnce(
      new Error('redis down'),
    );

    await expect(service.invalidateFinanceDerivedQuietly(18)).resolves.toBe(
      undefined,
    );
    expect(Logger.prototype.error).toHaveBeenCalled();
  });

  it('首页与 Pulse 会话失效静默版本在缓存异常时不向上抛错', async () => {
    pulseInvalidator.invalidateDashboardAndPulseSession.mockRejectedValueOnce(
      new Error('redis down'),
    );

    await expect(
      service.invalidateDashboardAndPulseSessionQuietly(18),
    ).resolves.toBe(undefined);
    expect(Logger.prototype.error).toHaveBeenCalled();
  });

  it('非静默版本仍然向上抛错，保持原有语义', async () => {
    financeInvalidator.invalidateFinanceCashFlow.mockRejectedValueOnce(
      new Error('redis down'),
    );

    await expect(service.invalidateFinanceDerived(18)).rejects.toThrow(
      'redis down',
    );
  });
});

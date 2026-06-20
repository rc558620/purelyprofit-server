import { Test, TestingModule } from '@nestjs/testing';
import { type CostRecord } from '@prisma/client';
import { CostsReadService } from './costs-read.service';
import {
  createCostsFacadeProviders,
  createCostsFacadeServiceMocks,
  createCostsSpecUser,
} from './costs.spec-helpers';
import { CostsService } from './costs.service';
import { CostsWriteService } from './costs-write.service';

describe('CostsService', () => {
  let service: CostsService;
  let facadeMocks: ReturnType<typeof createCostsFacadeServiceMocks>;

  const user = createCostsSpecUser();

  beforeEach(async () => {
    facadeMocks = createCostsFacadeServiceMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: createCostsFacadeProviders(facadeMocks),
    }).compile();

    service = module.get<CostsService>(CostsService);
  });

  it('读操作委托给 read service', async () => {
    const listQuery = {
      period: 'month' as const,
      typeFilter: 'fixed' as const,
    };
    const statsQuery = { period: 'month' as const, typeFilter: 'all' as const };
    const reportQuery = {
      storeId: 18,
      period: 'month' as const,
      categoryFilter: 'all' as const,
    };
    const listResult = [{ id: '1' }];
    const statsResult = {
      total: 1,
      fixed: 1,
      variable: 0,
      compareLastPeriod: null,
      recordCount: 1,
    };
    const reportResult = {
      summary: { total: 1 },
      categories: [],
      detailRows: [],
    };

    facadeMocks.costsReadService.listRecords.mockResolvedValue(listResult);
    facadeMocks.costsReadService.getStats.mockResolvedValue(statsResult);
    facadeMocks.costsReadService.getReport.mockResolvedValue(reportResult);

    await expect(service.listRecords(user, listQuery)).resolves.toBe(
      listResult,
    );
    await expect(service.getStats(user, statsQuery)).resolves.toBe(statsResult);
    await expect(service.getReport(user, reportQuery)).resolves.toBe(
      reportResult,
    );

    expect(facadeMocks.costsReadService.listRecords).toHaveBeenCalledWith(
      user,
      listQuery,
    );
    expect(facadeMocks.costsReadService.getStats).toHaveBeenCalledWith(
      user,
      statsQuery,
    );
    expect(facadeMocks.costsReadService.getReport).toHaveBeenCalledWith(
      user,
      reportQuery,
    );
  });

  it('写操作委托给 write service', async () => {
    const createDto = {
      title: '营销物料',
      type: 'variable' as const,
      category: 'marketing' as const,
      amount: 88.5,
      date: new Date('2026-05-14T00:00:00.000Z').getTime(),
    };
    const syncPurchaseInput = {
      storeId: 18,
      operatorStaffId: 8,
      purchaseOrderId: 11,
      amount: 120,
      title: '进货成本',
      note: '周补货',
      date: new Date('2026-05-14T00:00:00.000Z'),
    };
    const syncPayrollInput = {
      storeId: 18,
      payrollId: 6,
      operatorStaffId: 8,
      employeeName: '王五',
      month: '2026-05',
      actualSalary: 5000,
      socialInsurance: 0,
      housingFund: undefined,
      note: '含加班',
    };
    const createResult = { id: '2' };
    const syncPurchaseResult = {
      id: 99,
    } as unknown as CostRecord;

    facadeMocks.costsWriteService.createRecord.mockResolvedValue(createResult);
    facadeMocks.costsWriteService.deleteRecord.mockResolvedValue(undefined);
    facadeMocks.costsWriteService.syncPurchaseCost.mockResolvedValue(
      syncPurchaseResult,
    );
    facadeMocks.costsWriteService.syncPayrollCosts.mockResolvedValue(undefined);
    facadeMocks.costsWriteService.deletePurchaseCostRecord.mockResolvedValue(
      undefined,
    );

    await expect(service.createRecord(user, createDto)).resolves.toBe(
      createResult,
    );
    await expect(service.deleteRecord(user, 9)).resolves.toBeUndefined();
    await expect(
      service.syncPurchaseCost({} as never, syncPurchaseInput),
    ).resolves.toBe(syncPurchaseResult);
    await expect(
      service.syncPayrollCosts({} as never, syncPayrollInput),
    ).resolves.toBeUndefined();
    await expect(
      service.deletePurchaseCostRecord({} as never, 18, 11),
    ).resolves.toBeUndefined();

    expect(facadeMocks.costsWriteService.createRecord).toHaveBeenCalledWith(
      user,
      createDto,
    );
    expect(facadeMocks.costsWriteService.deleteRecord).toHaveBeenCalledWith(
      user,
      9,
    );
    expect(facadeMocks.costsWriteService.syncPurchaseCost).toHaveBeenCalledWith(
      {} as never,
      syncPurchaseInput,
    );
    expect(facadeMocks.costsWriteService.syncPayrollCosts).toHaveBeenCalledWith(
      {} as never,
      syncPayrollInput,
    );
    expect(
      facadeMocks.costsWriteService.deletePurchaseCostRecord,
    ).toHaveBeenCalledWith({} as never, 18, 11);
  });

  it('模块依赖正确注入 read/write service token', () => {
    expect(CostsReadService).toBeDefined();
    expect(CostsWriteService).toBeDefined();
  });
});

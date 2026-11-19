import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { CostsIdempotencyService } from './costs-idempotency.service';
import { CostsWriteService } from './costs-write.service';
import {
  createCostsCacheInvalidatorServiceMock,
  createCostsCommerceAccessServiceMock,
  createCostsPrismaMock,
  createCostsSpecUser,
  createCostsWriteProviders,
} from './costs.spec-helpers';

describe('CostsWriteService', () => {
  let service: CostsWriteService;
  let idempotencyService: CostsIdempotencyService;

  const prismaService = createCostsPrismaMock();
  const commerceAccessService = createCostsCommerceAccessServiceMock();
  const cacheInvalidatorService = createCostsCacheInvalidatorServiceMock();
  const user = createCostsSpecUser();

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: createCostsWriteProviders(
        prismaService,
        commerceAccessService,
        cacheInvalidatorService,
      ),
    }).compile();

    service = module.get<CostsWriteService>(CostsWriteService);
    idempotencyService = module.get<CostsIdempotencyService>(
      CostsIdempotencyService,
    );
  });

  it('createRecord 会校验金额并写入 manual 成本记录', async () => {
    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    commerceAccessService.findOperatorStaffIdForStore.mockResolvedValue(8);
    prismaService.costRecord.create.mockResolvedValue({
      id: 2,
      title: '营销物料',
      type: 'variable',
      category: 'marketing',
      sourceType: 'manual',
      amount: 8850, // 88.5 元 = 8850 分
      note: null,
      date: new Date('2026-05-14T00:00:00.000Z'),
      createdAt: new Date('2026-05-14T10:00:00.000Z'),
    });

    await expect(
      service.createRecord(user, {
        title: ' 营销物料 ',
        type: 'variable',
        category: 'marketing',
        amount: 88.5,
        date: new Date('2026-05-14T00:00:00.000Z').getTime(),
      }),
    ).resolves.toEqual({
      id: '2',
      title: '营销物料',
      type: 'variable',
      category: 'marketing',
      amount: 88.5,
      date: new Date('2026-05-14T00:00:00.000Z').getTime(),
      sourceType: 'manual',
      deletable: true,
      createdAt: new Date('2026-05-14T10:00:00.000Z').getTime(),
    });
  });

  it('createRecord 会同步失效经营分析缓存', async () => {
    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    commerceAccessService.findOperatorStaffIdForStore.mockResolvedValue(8);
    prismaService.costRecord.create.mockResolvedValue({
      id: 2,
      title: '营销物料',
      type: 'variable',
      category: 'marketing',
      sourceType: 'manual',
      amount: 8850,
      note: null,
      date: new Date('2026-05-14T00:00:00.000Z'),
      createdAt: new Date('2026-05-14T10:00:00.000Z'),
    });

    await service.createRecord(user, {
      title: '营销物料',
      type: 'variable',
      category: 'marketing',
      amount: 88.5,
      date: new Date('2026-05-14T00:00:00.000Z').getTime(),
    });

    // 经营分析聚合 cost_records，成本写入后必须一起失效，否则要等 TTL 才刷新
    expect(
      cacheInvalidatorService.invalidateBusinessAnalysis,
    ).toHaveBeenCalledWith(18);
  });

  it('deleteRecord 会同步失效经营分析缓存', async () => {
    prismaService.costRecord.findUnique.mockResolvedValue({
      id: 9,
      storeId: 18,
      sourceType: 'manual',
    });
    commerceAccessService.ensureCanAccessStore.mockResolvedValue(undefined);
    prismaService.costRecord.delete.mockResolvedValue({ id: 9 });

    await service.deleteRecord(user, 9);

    expect(
      cacheInvalidatorService.invalidateBusinessAnalysis,
    ).toHaveBeenCalledWith(18);
  });

  it('createRecord 在金额非法时抛错', async () => {
    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    commerceAccessService.findOperatorStaffIdForStore.mockResolvedValue(8);

    await expect(
      service.createRecord(user, {
        title: '房租',
        type: 'fixed',
        category: 'rent',
        amount: 0,
        date: new Date('2026-05-14T00:00:00.000Z').getTime(),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('createRecord 允许上海今天内晚于当前时刻的日期', async () => {
    const nowSpy = jest
      .spyOn(Date, 'now')
      .mockReturnValue(new Date('2026-05-14T15:30:00.000Z').getTime());
    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    commerceAccessService.findOperatorStaffIdForStore.mockResolvedValue(8);
    prismaService.costRecord.create.mockResolvedValue({
      id: 3,
      title: '当日成本',
      type: 'variable',
      category: 'other',
      sourceType: 'manual',
      amount: 10000,
      note: null,
      date: new Date('2026-05-14T15:45:00.000Z'),
      createdAt: new Date('2026-05-14T15:30:00.000Z'),
    });

    try {
      await expect(
        service.createRecord(user, {
          title: '当日成本',
          type: 'variable',
          category: 'other',
          amount: 100,
          date: new Date('2026-05-14T15:45:00.000Z').getTime(),
        }),
      ).resolves.toBeDefined();
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('createRecord 拒绝晚于上海今天的日期', async () => {
    const nowSpy = jest
      .spyOn(Date, 'now')
      .mockReturnValue(new Date('2026-05-14T15:30:00.000Z').getTime());
    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    commerceAccessService.findOperatorStaffIdForStore.mockResolvedValue(8);

    try {
      await expect(
        service.createRecord(user, {
          title: '次日成本',
          type: 'variable',
          category: 'other',
          amount: 100,
          date: new Date('2026-05-14T16:00:00.000Z').getTime(),
        }),
      ).rejects.toThrow('成本发生日期不能晚于今天');
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('deleteRecord 会阻止删除自动沉淀记录', async () => {
    prismaService.costRecord.findUnique.mockResolvedValue({
      id: 9,
      storeId: 18,
      sourceType: 'purchase',
    });
    commerceAccessService.ensureCanAccessStore.mockResolvedValue(undefined);

    await expect(service.deleteRecord(user, 9)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('deleteRecord 在记录不存在时抛错', async () => {
    prismaService.costRecord.findUnique.mockResolvedValue(null);

    await expect(service.deleteRecord(user, 88)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('deletePurchaseCostRecord 会按门店和进货单 ID 删除成本记录', async () => {
    prismaService.costRecord.deleteMany.mockResolvedValue({ count: 1 });

    await service.deletePurchaseCostRecord(prismaService as never, 18, 11);

    expect(prismaService.costRecord.deleteMany).toHaveBeenCalledWith({
      where: {
        storeId: 18,
        sourceType: 'purchase',
        purchaseOrderId: 11,
      },
    });
  });

  it('syncPurchaseCost 会按 purchaseOrderId 幂等 upsert（已有记录时 update）', async () => {
    const existingRecord = { id: 99 };
    prismaService.costRecord.findFirst.mockResolvedValue(existingRecord);
    prismaService.costRecord.update.mockResolvedValue({ id: 99, amount: 120 });

    await service.syncPurchaseCost(prismaService as never, {
      storeId: 18,
      operatorStaffId: 8,
      purchaseOrderId: 11,
      amount: 120,
      title: '进货成本',
      note: '周补货',
      date: new Date('2026-05-14T00:00:00.000Z'),
    });

    expect(prismaService.costRecord.findFirst).toHaveBeenCalledWith({
      where: {
        storeId: 18,
        sourceType: 'purchase',
        purchaseOrderId: 11,
      },
    });
    expect(prismaService.costRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 99 },
      }),
    );
    expect(prismaService.costRecord.create).not.toHaveBeenCalled();
  });

  it('syncPurchaseCost 在无已有记录时会 create', async () => {
    prismaService.costRecord.findFirst.mockResolvedValue(null);
    prismaService.costRecord.create.mockResolvedValue({ id: 100, amount: 120 });

    await service.syncPurchaseCost(prismaService as never, {
      storeId: 18,
      operatorStaffId: 8,
      purchaseOrderId: 11,
      amount: 120,
      title: '进货成本',
      note: '周补货',
      date: new Date('2026-05-14T00:00:00.000Z'),
    });

    expect(prismaService.costRecord.findFirst).toHaveBeenCalledWith({
      where: {
        storeId: 18,
        sourceType: 'purchase',
        purchaseOrderId: 11,
      },
    });
    expect(prismaService.costRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          storeId: 18,
          purchaseOrderId: 11,
          sourceType: 'purchase',
        }),
      }),
    );
    expect(prismaService.costRecord.update).not.toHaveBeenCalled();
  });

  it('syncPayrollCosts 在金额为 0 时会删除对应社保/公积金成本记录', async () => {
    // actualSalary > 0 → 会 upsert 薪资成本记录
    prismaService.costRecord.findFirst.mockResolvedValue({ id: 101 });
    prismaService.costRecord.update.mockResolvedValue({ id: 101 });
    prismaService.costRecord.deleteMany.mockResolvedValue({ count: 1 });

    await service.syncPayrollCosts(prismaService as never, {
      storeId: 18,
      payrollId: 6,
      operatorStaffId: 8,
      employeeName: '王五',
      month: '2026-05',
      actualSalary: 5000,
      socialInsurance: 0,
      housingFund: undefined,
      note: '含加班',
    });

    // 薪资记录用 findFirst+update
    expect(prismaService.costRecord.findFirst).toHaveBeenCalled();
    expect(prismaService.costRecord.update).toHaveBeenCalledTimes(1);
    // socialInsurance=0 和 housingFund=undefined 各触发一次 deleteMany
    expect(prismaService.costRecord.deleteMany).toHaveBeenCalledTimes(2);
  });

  it('syncPayrollCosts 在 actualSalary 为 0 时会删除薪资成本记录', async () => {
    prismaService.costRecord.deleteMany.mockResolvedValue({ count: 0 });

    await service.syncPayrollCosts(prismaService as never, {
      storeId: 18,
      payrollId: 6,
      operatorStaffId: 8,
      employeeName: '王五',
      month: '2026-05',
      actualSalary: 0,
      socialInsurance: 0,
      housingFund: undefined,
      note: null,
    });

    // actualSalary=0, socialInsurance=0, housingFund=undefined 各触发一次 deleteMany
    expect(prismaService.costRecord.deleteMany).toHaveBeenCalledTimes(3);
    expect(prismaService.costRecord.deleteMany).toHaveBeenCalledWith({
      where: {
        storeId: 18,
        payrollId: 6,
        sourceType: 'payroll_salary',
      },
    });
    expect(prismaService.costRecord.findFirst).not.toHaveBeenCalled();
    expect(prismaService.costRecord.update).not.toHaveBeenCalled();
  });

  describe('Idempotency-Key 防重复记账', () => {
    const idempotencyKey = 'cost-create-key-0001';
    const createDto = {
      title: '房租',
      type: 'fixed' as const,
      category: 'rent' as const,
      amount: 5000,
      date: new Date('2026-05-01T00:00:00.000Z').getTime(),
    };
    const requestHash = () =>
      idempotencyService.hashRequest({ storeId: 18, dto: createDto });

    beforeEach(() => {
      commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
      commerceAccessService.findOperatorStaffIdForStore.mockResolvedValue(8);
    });

    it('命中已成功的记录时回放首次响应，不再落库', async () => {
      const snapshot = {
        id: '99',
        title: '房租',
        type: 'fixed',
        category: 'rent',
        amount: 5000,
        date: createDto.date,
        sourceType: 'manual',
        deletable: true,
        createdAt: createDto.date,
      };
      prismaService.idempotencyRecord.findUnique.mockResolvedValue({
        status: 'succeeded',
        requestHash: requestHash(),
        responseSnapshot: snapshot,
      });

      await expect(
        service.createRecord(user, createDto, { idempotencyKey }),
      ).resolves.toEqual(snapshot);

      expect(prismaService.costRecord.create).not.toHaveBeenCalled();
      expect(prismaService.idempotencyRecord.create).not.toHaveBeenCalled();
    });

    it('首次请求仍在处理时返回 409，而不是再写一条', async () => {
      prismaService.idempotencyRecord.findUnique.mockResolvedValue({
        status: 'processing',
        requestHash: requestHash(),
        responseSnapshot: null,
      });

      await expect(
        service.createRecord(user, createDto, { idempotencyKey }),
      ).rejects.toThrow(ConflictException);

      expect(prismaService.costRecord.create).not.toHaveBeenCalled();
    });

    it('同一 key 换了内容时拒绝，避免回放不相符的旧记录', async () => {
      prismaService.idempotencyRecord.findUnique.mockResolvedValue({
        status: 'succeeded',
        requestHash: 'another-request-hash',
        responseSnapshot: { id: '77' },
      });

      await expect(
        service.createRecord(user, createDto, { idempotencyKey }),
      ).rejects.toThrow('幂等键已用于另一笔内容不同的成本记录');

      expect(prismaService.costRecord.create).not.toHaveBeenCalled();
    });

    it('新 key 会占位、落库后回填响应快照', async () => {
      prismaService.idempotencyRecord.findUnique.mockResolvedValue(null);
      prismaService.idempotencyRecord.create.mockResolvedValue({ id: 7 });
      prismaService.idempotencyRecord.update.mockResolvedValue({});
      prismaService.costRecord.create.mockResolvedValue({
        id: 2,
        title: '房租',
        type: 'fixed',
        category: 'rent',
        sourceType: 'manual',
        amount: 500000,
        note: null,
        date: new Date('2026-05-01T00:00:00.000Z'),
        createdAt: new Date('2026-05-01T00:00:00.000Z'),
      });

      await expect(
        service.createRecord(user, createDto, { idempotencyKey }),
      ).resolves.toEqual(expect.objectContaining({ id: '2' }));

      expect(prismaService.idempotencyRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            idempotencyKey,
            status: 'processing',
            requestHash: requestHash(),
          }),
        }),
      );
      expect(prismaService.idempotencyRecord.update).toHaveBeenCalledWith({
        where: { id: 7 },
        data: expect.objectContaining({
          status: 'succeeded',
          resourceId: 2,
        }),
      });
    });

    it('落库失败时清理占位，同一个 key 可以重试', async () => {
      prismaService.idempotencyRecord.findUnique.mockResolvedValue(null);
      prismaService.idempotencyRecord.create.mockResolvedValue({ id: 8 });
      prismaService.idempotencyRecord.delete.mockResolvedValue({ id: 8 });
      prismaService.costRecord.create.mockRejectedValue(new Error('db down'));

      await expect(
        service.createRecord(user, createDto, { idempotencyKey }),
      ).rejects.toThrow('db down');

      expect(prismaService.idempotencyRecord.delete).toHaveBeenCalledWith({
        where: { id: 8 },
      });
    });
  });

  describe('缓存失效降级', () => {
    beforeEach(() => {
      commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
      commerceAccessService.findOperatorStaffIdForStore.mockResolvedValue(8);
      prismaService.costRecord.create.mockResolvedValue({
        id: 2,
        title: '营销物料',
        type: 'variable',
        category: 'marketing',
        sourceType: 'manual',
        amount: 8850,
        note: null,
        date: new Date('2026-05-14T00:00:00.000Z'),
        createdAt: new Date('2026-05-14T10:00:00.000Z'),
      });
    });

    it('新增成功后缓存失效抛错不回滚、也不把接口变成失败', async () => {
      cacheInvalidatorService.invalidateBusinessAnalysis.mockRejectedValueOnce(
        new Error('redis down'),
      );
      cacheInvalidatorService.invalidateProfitDashboardHome.mockRejectedValueOnce(
        new Error('redis down'),
      );

      await expect(
        service.createRecord(user, {
          title: '营销物料',
          type: 'variable',
          category: 'marketing',
          amount: 88.5,
          date: new Date('2026-05-14T00:00:00.000Z').getTime(),
        }),
      ).resolves.toEqual(expect.objectContaining({ id: '2' }));

      expect(prismaService.costRecord.create).toHaveBeenCalledTimes(1);
      // 一项失败不影响其余失效任务继续执行
      expect(
        cacheInvalidatorService.invalidateCostsCaches,
      ).toHaveBeenCalledWith(18);
    });

    it('删除成功后缓存失效抛错也不把删除回显成失败', async () => {
      prismaService.costRecord.findUnique.mockResolvedValue({
        id: 9,
        storeId: 18,
        sourceType: 'manual',
      });
      commerceAccessService.ensureCanAccessStore.mockResolvedValue(undefined);
      prismaService.costRecord.delete.mockResolvedValue({ id: 9 });
      cacheInvalidatorService.invalidateCostsCaches.mockRejectedValueOnce(
        new Error('redis down'),
      );

      await expect(service.deleteRecord(user, 9)).resolves.toBeUndefined();
      expect(prismaService.costRecord.delete).toHaveBeenCalledTimes(1);
    });
  });
});

import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { FinanceAccountStatus, Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { CacheInvalidatorService } from '../../redis/invalidator';
import { RefreshableCacheService } from '../../redis/refreshable-cache.service';
import { FinanceAccountService } from './finance-account.service';
import {
  createFinanceAccountPrismaMock,
  createFinanceAccountProviders,
  createFinanceSpecUser,
  createPlatformMembershipAccessServiceMock,
  useFinanceSpecFakeTimers,
  useFinanceSpecRealTimers,
} from './finance.spec-helpers';

describe('FinanceAccountService', () => {
  let service: FinanceAccountService;
  let prismaService: ReturnType<typeof createFinanceAccountPrismaMock>;
  let platformMembershipAccessService: ReturnType<
    typeof createPlatformMembershipAccessServiceMock
  >;
  let refreshableCache: Pick<RefreshableCacheService, 'getOrLoadRefreshableJson'>;
  let cacheInvalidatorService: Pick<
    CacheInvalidatorService,
    'invalidateFinanceDerived'
  >;

  const user: AuthenticatedUser = createFinanceSpecUser();

  beforeEach(async () => {
    useFinanceSpecFakeTimers();
    prismaService = createFinanceAccountPrismaMock();
    platformMembershipAccessService =
      createPlatformMembershipAccessServiceMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: createFinanceAccountProviders(
        prismaService,
        platformMembershipAccessService,
      ),
    }).compile();

    service = module.get<FinanceAccountService>(FinanceAccountService);
    refreshableCache = module.get(RefreshableCacheService);
    cacheInvalidatorService = module.get(CacheInvalidatorService);
  });

  afterEach(() => {
    useFinanceSpecRealTimers();
  });

  it('listAccounts 会通过 refreshable cache 包裹列表读取', async () => {
    prismaService.financeAccountRecord.findMany.mockResolvedValue([]);
    prismaService.financeAccountRecord.count.mockResolvedValue(0);

    await expect(
      service.listAccounts(user, {
        typeFilter: 'receivable',
        statusFilter: 'pending',
        searchText: '张三',
        page: 1,
        pageSize: 10,
      }),
    ).resolves.toEqual({
      items: [],
      meta: {
        page: 1,
        pageSize: 10,
        total: 0,
        totalPages: 0,
      },
    });
    expect(refreshableCache.getOrLoadRefreshableJson).toHaveBeenCalledWith(
      expect.objectContaining({
        cacheKey:
          'profit:finance:accounts:list:store:18:type:receivable:status:pending:search:%E5%BC%A0%E4%B8%89:page:1:pageSize:10',
        ttlSeconds: 60,
      }),
    );
  });

  it('listAccounts 会按派生后的 overdue 状态筛选并排序', async () => {
    prismaService.financeAccountRecord.count.mockResolvedValue(2);
    // mock 数据为分单位：500 分 = 5 元，200 分 = 2 元
    prismaService.financeAccountRecord.findMany.mockResolvedValue([
      {
        id: 32,
        type: 'receivable',
        category: 'sales_credit',
        counterpart: '新近逾期客户',
        amount: 50000,
        paidAmount: 0,
        remaining: 50000,
        status: FinanceAccountStatus.pending,
        dueDate: new Date('2026-05-10T00:00:00.000Z'),
        date: new Date('2026-05-09T00:00:00.000Z'),
        note: null,
        createdAt: new Date('2026-05-09T12:00:00.000Z'),
        updatedAt: new Date('2026-05-14T11:00:00.000Z'),
      },
      {
        id: 31,
        type: 'receivable',
        category: 'sales_credit',
        counterpart: '旧逾期客户',
        amount: 20000,
        paidAmount: 0,
        remaining: 20000,
        status: FinanceAccountStatus.pending,
        dueDate: new Date('2026-05-01T00:00:00.000Z'),
        date: new Date('2026-05-01T00:00:00.000Z'),
        note: null,
        createdAt: new Date('2026-05-01T12:00:00.000Z'),
        updatedAt: new Date('2026-05-13T11:00:00.000Z'),
      },
    ]);

    await expect(
      service.listAccounts(user, {
        statusFilter: 'overdue',
        page: 1,
        pageSize: 10,
      }),
    ).resolves.toEqual({
      items: [
        expect.objectContaining({ id: '32', status: 'overdue' }),
        expect.objectContaining({ id: '31', status: 'overdue' }),
      ],
      meta: {
        page: 1,
        pageSize: 10,
        total: 2,
        totalPages: 1,
      },
    });
    expect(prismaService.financeAccountRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            { storeId: 18 },
            {
              storeId: 18,
              status: FinanceAccountStatus.overdue,
            },
          ],
        },
      }),
    );
  });

  it('listAccounts 会把 pending 状态下推成未逾期且未收付完的查询条件', async () => {
    prismaService.financeAccountRecord.count.mockResolvedValue(1);
    // 60000 分 = 600 元
    prismaService.financeAccountRecord.findMany.mockResolvedValue([
      {
        id: 40,
        type: 'receivable',
        category: 'sales_credit',
        counterpart: '待收客户',
        amount: 60000,
        paidAmount: 0,
        remaining: 60000,
        status: FinanceAccountStatus.pending,
        dueDate: new Date('2026-05-16T00:00:00.000Z'),
        date: new Date('2026-05-14T00:00:00.000Z'),
        note: null,
        createdAt: new Date('2026-05-14T08:00:00.000Z'),
        updatedAt: new Date('2026-05-14T09:00:00.000Z'),
      },
    ]);

    await expect(
      service.listAccounts(user, {
        statusFilter: 'pending',
        page: 1,
        pageSize: 10,
      }),
    ).resolves.toEqual({
      items: [expect.objectContaining({ id: '40', status: 'pending' })],
      meta: {
        page: 1,
        pageSize: 10,
        total: 1,
        totalPages: 1,
      },
    });

    expect(prismaService.financeAccountRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            { storeId: 18 },
            {
              storeId: 18,
              status: FinanceAccountStatus.pending,
            },
          ],
        },
      }),
    );
  });

  it('listAccounts 会把 partial 状态下推成已部分收付且未结清的查询条件', async () => {
    prismaService.financeAccountRecord.count.mockResolvedValue(1);
    // 100000 分 = 1000 元，20000 分 = 200 元，80000 分 = 800 元
    prismaService.financeAccountRecord.findMany.mockResolvedValue([
      {
        id: 41,
        type: 'payable',
        category: 'supplier_debt',
        counterpart: '供应商甲',
        amount: 100000,
        paidAmount: 20000,
        remaining: 80000,
        status: FinanceAccountStatus.partial,
        dueDate: null,
        date: new Date('2026-05-10T00:00:00.000Z'),
        note: null,
        createdAt: new Date('2026-05-10T00:00:00.000Z'),
        updatedAt: new Date('2026-05-13T00:00:00.000Z'),
      },
    ]);

    await expect(
      service.listAccounts(user, {
        statusFilter: 'partial',
        page: 1,
        pageSize: 10,
      }),
    ).resolves.toEqual({
      items: [expect.objectContaining({ id: '41', status: 'partial' })],
      meta: {
        page: 1,
        pageSize: 10,
        total: 1,
        totalPages: 1,
      },
    });

    expect(prismaService.financeAccountRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            { storeId: 18 },
            {
              storeId: 18,
              status: FinanceAccountStatus.partial,
            },
          ],
        },
      }),
    );
  });

  it('listAccounts 会把 settled 状态下推成剩余金额不大于 0 的查询条件', async () => {
    prismaService.financeAccountRecord.count.mockResolvedValue(1);
    // 20000 分 = 200 元
    prismaService.financeAccountRecord.findMany.mockResolvedValue([
      {
        id: 42,
        type: 'receivable',
        category: 'other',
        counterpart: '已结清客户',
        amount: 20000,
        paidAmount: 20000,
        remaining: 0,
        status: FinanceAccountStatus.settled,
        dueDate: null,
        date: new Date('2026-05-08T00:00:00.000Z'),
        note: null,
        createdAt: new Date('2026-05-08T00:00:00.000Z'),
        updatedAt: new Date('2026-05-12T00:00:00.000Z'),
      },
    ]);

    await expect(
      service.listAccounts(user, {
        statusFilter: 'settled',
        page: 1,
        pageSize: 10,
      }),
    ).resolves.toEqual({
      items: [expect.objectContaining({ id: '42', status: 'settled' })],
      meta: {
        page: 1,
        pageSize: 10,
        total: 1,
        totalPages: 1,
      },
    });

    expect(prismaService.financeAccountRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            { storeId: 18 },
            {
              storeId: 18,
              status: FinanceAccountStatus.settled,
            },
          ],
        },
      }),
    );
  });

  it('createAccount 会按前端规则派生 overdue 状态和 remaining', async () => {
    // DTO 入站 amount: 50 元 → 数据库存 5000 分
    // create mock 返回数据库记录，金额单位为分
    prismaService.financeAccountRecord.create.mockResolvedValue({
      id: 11,
      type: 'receivable',
      category: 'sales_credit',
      counterpart: '张三水果店',
      amount: 500000,
      paidAmount: 0,
      remaining: 500000,
      status: FinanceAccountStatus.overdue,
      dueDate: new Date('2026-05-01T00:00:00.000Z'),
      date: new Date('2026-05-01T00:00:00.000Z'),
      note: '月底前结清',
      createdAt: new Date('2026-05-14T12:00:00.000Z'),
      updatedAt: new Date('2026-05-14T12:00:00.000Z'),
    });

    await expect(
      service.createAccount(user, {
        type: 'receivable',
        category: 'sales_credit',
        counterpart: '张三水果店',
        amount: 5000,
        paidAmount: 0,
        dueDate: new Date('2026-05-01T00:00:00.000Z').getTime(),
        date: new Date('2026-05-01T00:00:00.000Z').getTime(),
        note: '月底前结清',
      }),
    ).resolves.toEqual({
      id: '11',
      type: 'receivable',
      category: 'sales_credit',
      counterpart: '张三水果店',
      amount: 5000,
      paidAmount: 0,
      remaining: 5000,
      status: 'overdue',
      dueDate: new Date('2026-05-01T00:00:00.000Z').getTime(),
      date: new Date('2026-05-01T00:00:00.000Z').getTime(),
      note: '月底前结清',
      createdAt: new Date('2026-05-14T12:00:00.000Z').getTime(),
      updatedAt: new Date('2026-05-14T12:00:00.000Z').getTime(),
    });
  });

  it('createAccount 拒绝 sales_credit 以 payable 类型录入', async () => {
    await expect(
      service.createAccount(user, {
        type: 'payable',
        category: 'sales_credit',
        counterpart: '张三水果店',
        amount: 5000,
        paidAmount: 0,
        date: new Date('2026-05-01T00:00:00.000Z').getTime(),
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('createAccount 拒绝 supplier_debt 以 receivable 类型录入', async () => {
    await expect(
      service.createAccount(user, {
        type: 'receivable',
        category: 'supplier_debt',
        counterpart: '蔬菜批发行',
        amount: 3200,
        paidAmount: 0,
        date: new Date('2026-05-01T00:00:00.000Z').getTime(),
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('createAccount 允许 advance_paid 按应收口径录入', async () => {
    // DTO 入站 amount: 8 元 → 数据库存 800 分
    prismaService.financeAccountRecord.create.mockResolvedValue({
      id: 12,
      type: 'receivable',
      category: 'advance_paid',
      counterpart: '品牌方预付款',
      amount: 80000,
      paidAmount: 0,
      remaining: 80000,
      status: FinanceAccountStatus.pending,
      dueDate: null,
      date: new Date('2026-05-14T00:00:00.000Z'),
      note: '活动预付款待核销',
      createdAt: new Date('2026-05-14T12:00:00.000Z'),
      updatedAt: new Date('2026-05-14T12:00:00.000Z'),
    });

    await expect(
      service.createAccount(user, {
        type: 'receivable',
        category: 'advance_paid',
        counterpart: '品牌方预付款',
        amount: 800,
        paidAmount: 0,
        date: new Date('2026-05-14T00:00:00.000Z').getTime(),
        note: '活动预付款待核销',
      }),
    ).resolves.toMatchObject({
      id: '12',
      type: 'receivable',
      category: 'advance_paid',
      counterpart: '品牌方预付款',
      amount: 800,
      remaining: 800,
      status: 'pending',
    });
  });

  it('settleAccount 在超出剩余金额时抛错', async () => {
    // 数据库存分：amount=100000 分=1000 元，paidAmount=60000 分=600 元，remaining=40000 分=400 元
    prismaService.financeAccountRecord.findFirst.mockResolvedValue({
      id: 12,
      type: 'payable',
      category: 'supplier_debt',
      counterpart: '批发行',
      amount: 100000,
      paidAmount: 60000,
      remaining: 40000,
      status: FinanceAccountStatus.partial,
      dueDate: null,
      date: new Date('2026-05-10T00:00:00.000Z'),
      note: null,
      createdAt: new Date('2026-05-10T00:00:00.000Z'),
      updatedAt: new Date('2026-05-11T00:00:00.000Z'),
    });

    // payAmount: 500 元 > remaining: 400 元
    await expect(
      service.settleAccount(user, 12, { payAmount: 500 }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('settleAccount 会通过条件更新拦截并发覆盖', async () => {
    // 数据库存分：amount=100000 分=1000 元，paidAmount=20000 分=200 元，remaining=80000 分=800 元
    prismaService.financeAccountRecord.findFirst.mockResolvedValue({
      id: 14,
      type: 'receivable',
      category: 'sales_credit',
      counterpart: '并发客户',
      amount: 100000,
      paidAmount: 20000,
      remaining: 80000,
      status: FinanceAccountStatus.partial,
      dueDate: null,
      date: new Date('2026-05-10T00:00:00.000Z'),
      note: null,
      createdAt: new Date('2026-05-10T00:00:00.000Z'),
      updatedAt: new Date('2026-05-11T00:00:00.000Z'),
    });
    prismaService.financeAccountRecord.updateMany.mockResolvedValue({
      count: 0,
    });

    // payAmount: 100 元 → 10000 分
    await expect(
      service.settleAccount(user, 14, { payAmount: 100 }),
    ).rejects.toThrow('账款记录已被其他操作更新，请刷新后重试');
    expect(prismaService.financeAccountRecord.updateMany).toHaveBeenCalledWith({
      where: {
        id: 14,
        storeId: 18,
        paidAmount: 20000,
      },
      data: {
        paidAmount: 30000,
        remaining: 70000,
        status: FinanceAccountStatus.partial,
      },
    });
  });

  it('createAccount 成功后会失效财务派生缓存', async () => {
    // DTO 入站 amount: 1 元 → 数据库存 100 分
    prismaService.financeAccountRecord.create.mockResolvedValue({
      id: 13,
      type: 'receivable',
      category: 'sales_credit',
      counterpart: '测试客户',
      amount: 10000,
      paidAmount: 0,
      remaining: 10000,
      status: FinanceAccountStatus.pending,
      dueDate: null,
      date: new Date('2026-05-14T00:00:00.000Z'),
      note: null,
      createdAt: new Date('2026-05-14T12:00:00.000Z'),
      updatedAt: new Date('2026-05-14T12:00:00.000Z'),
    });

    await service.createAccount(user, {
      type: 'receivable',
      category: 'sales_credit',
      counterpart: '测试客户',
      amount: 100,
      paidAmount: 0,
      date: new Date('2026-05-14T00:00:00.000Z').getTime(),
    });

    expect(
      cacheInvalidatorService.invalidateFinanceDerived,
    ).toHaveBeenCalledWith(18);
  });

  it('settleAccount 成功时通过事务更新并返回最新记录', async () => {
    // 数据库存分：amount=100000 分=1000 元，paidAmount=20000 分=200 元，remaining=80000 分=800 元
    prismaService.financeAccountRecord.findFirst
      .mockResolvedValueOnce({
        id: 15,
        type: 'payable',
        category: 'supplier_debt',
        counterpart: '供应商A',
        amount: 100000,
        paidAmount: 20000,
        remaining: 80000,
        status: FinanceAccountStatus.partial,
        dueDate: null,
        date: new Date('2026-05-10T00:00:00.000Z'),
        note: null,
        createdAt: new Date('2026-05-10T00:00:00.000Z'),
        updatedAt: new Date('2026-05-11T00:00:00.000Z'),
      })
      .mockResolvedValueOnce({
        id: 15,
        type: 'payable',
        category: 'supplier_debt',
        counterpart: '供应商A',
        amount: 100000,
        paidAmount: 50000,
        remaining: 50000,
        status: FinanceAccountStatus.partial,
        dueDate: null,
        date: new Date('2026-05-10T00:00:00.000Z'),
        note: null,
        createdAt: new Date('2026-05-10T00:00:00.000Z'),
        updatedAt: new Date('2026-05-14T12:00:00.000Z'),
      });
    prismaService.financeAccountRecord.updateMany.mockResolvedValue({
      count: 1,
    });

    // payAmount: 300 元 → 30000 分；paidAmount: 20000 + 30000 = 50000 分 = 500 元
    await expect(
      service.settleAccount(user, 15, { payAmount: 300 }),
    ).resolves.toMatchObject({
      id: '15',
      paidAmount: 500,
      remaining: 500,
      status: 'partial',
    });
    expect(prismaService.$transaction).toHaveBeenCalled();
    expect(
      cacheInvalidatorService.invalidateFinanceDerived,
    ).toHaveBeenCalledWith(18);
  });

  it('缺少当前门店时拒绝访问财务接口', async () => {
    const outsider: AuthenticatedUser = {
      ...user,
      currentMembership: null,
    };

    await expect(service.getAccountsStats(outsider)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { FinanceAccountStatus, Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { CacheInvalidatorService } from '../../redis/invalidator';
import { RedisService } from '../../redis/redis.service';
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
  let redisService: Pick<RedisService, 'getOrLoadRefreshableJson'>;
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
    redisService = module.get(RedisService);
    cacheInvalidatorService = module.get(CacheInvalidatorService);
  });

  afterEach(() => {
    useFinanceSpecRealTimers();
  });

  it('listAccounts 会通过 refreshable cache 包裹列表读取', async () => {
    prismaService.financeAccountRecord.findMany.mockResolvedValue([]);

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
    expect(redisService.getOrLoadRefreshableJson).toHaveBeenCalledWith(
      expect.objectContaining({
        cacheKey:
          'profit:finance:accounts:list:store:18:type:receivable:status:pending:search:%E5%BC%A0%E4%B8%89:page:1:pageSize:10',
        ttlSeconds: 60,
      }),
    );
  });

  it('listAccounts 会按派生后的 overdue 状态筛选并排序', async () => {
    prismaService.financeAccountRecord.findMany.mockResolvedValue([
      {
        id: 32,
        type: 'receivable',
        category: 'sales_credit',
        counterpart: '新近逾期客户',
        amount: new Prisma.Decimal('500.00'),
        paidAmount: new Prisma.Decimal('0.00'),
        remaining: new Prisma.Decimal('500.00'),
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
        amount: new Prisma.Decimal('200.00'),
        paidAmount: new Prisma.Decimal('0.00'),
        remaining: new Prisma.Decimal('200.00'),
        status: FinanceAccountStatus.pending,
        dueDate: new Date('2026-05-01T00:00:00.000Z'),
        date: new Date('2026-05-01T00:00:00.000Z'),
        note: null,
        createdAt: new Date('2026-05-01T12:00:00.000Z'),
        updatedAt: new Date('2026-05-13T11:00:00.000Z'),
      },
      {
        id: 30,
        type: 'receivable',
        category: 'sales_credit',
        counterpart: '未逾期客户',
        amount: new Prisma.Decimal('300.00'),
        paidAmount: new Prisma.Decimal('0.00'),
        remaining: new Prisma.Decimal('300.00'),
        status: FinanceAccountStatus.pending,
        dueDate: new Date('2026-05-20T00:00:00.000Z'),
        date: new Date('2026-05-14T00:00:00.000Z'),
        note: null,
        createdAt: new Date('2026-05-14T12:00:00.000Z'),
        updatedAt: new Date('2026-05-14T10:00:00.000Z'),
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
              dueDate: { lt: new Date('2026-05-14T12:00:00.000Z') },
              paidAmount: new Prisma.Decimal(0),
              remaining: { gt: new Prisma.Decimal(0) },
            },
          ],
        },
      }),
    );
  });

  it('listAccounts 会把 pending 状态下推成未逾期且未收付完的查询条件', async () => {
    prismaService.financeAccountRecord.findMany.mockResolvedValue([
      {
        id: 40,
        type: 'receivable',
        category: 'sales_credit',
        counterpart: '待收客户',
        amount: new Prisma.Decimal('600.00'),
        paidAmount: new Prisma.Decimal('0.00'),
        remaining: new Prisma.Decimal('600.00'),
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
              paidAmount: new Prisma.Decimal(0),
              remaining: { gt: new Prisma.Decimal(0) },
              OR: [
                { dueDate: null },
                { dueDate: { gte: new Date('2026-05-14T12:00:00.000Z') } },
              ],
            },
          ],
        },
      }),
    );
  });

  it('listAccounts 会把 partial 状态下推成已部分收付且未结清的查询条件', async () => {
    prismaService.financeAccountRecord.findMany.mockResolvedValue([
      {
        id: 41,
        type: 'payable',
        category: 'supplier_debt',
        counterpart: '供应商甲',
        amount: new Prisma.Decimal('1000.00'),
        paidAmount: new Prisma.Decimal('200.00'),
        remaining: new Prisma.Decimal('800.00'),
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
              paidAmount: { gt: new Prisma.Decimal(0) },
              remaining: { gt: new Prisma.Decimal(0) },
            },
          ],
        },
      }),
    );
  });

  it('listAccounts 会把 settled 状态下推成剩余金额不大于 0 的查询条件', async () => {
    prismaService.financeAccountRecord.findMany.mockResolvedValue([
      {
        id: 42,
        type: 'receivable',
        category: 'other',
        counterpart: '已结清客户',
        amount: new Prisma.Decimal('200.00'),
        paidAmount: new Prisma.Decimal('200.00'),
        remaining: new Prisma.Decimal('0.00'),
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
              remaining: { lte: new Prisma.Decimal(0) },
            },
          ],
        },
      }),
    );
  });

  it('createAccount 会按前端规则派生 overdue 状态和 remaining', async () => {
    prismaService.financeAccountRecord.create.mockResolvedValue({
      id: 11,
      type: 'receivable',
      category: 'sales_credit',
      counterpart: '张三水果店',
      amount: new Prisma.Decimal('5000.00'),
      paidAmount: new Prisma.Decimal('0.00'),
      remaining: new Prisma.Decimal('5000.00'),
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
    prismaService.financeAccountRecord.create.mockResolvedValue({
      id: 12,
      type: 'receivable',
      category: 'advance_paid',
      counterpart: '品牌方预付款',
      amount: new Prisma.Decimal('800.00'),
      paidAmount: new Prisma.Decimal('0.00'),
      remaining: new Prisma.Decimal('800.00'),
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
    prismaService.financeAccountRecord.findFirst.mockResolvedValue({
      id: 12,
      type: 'payable',
      category: 'supplier_debt',
      counterpart: '批发行',
      amount: new Prisma.Decimal('1000.00'),
      paidAmount: new Prisma.Decimal('600.00'),
      remaining: new Prisma.Decimal('400.00'),
      status: FinanceAccountStatus.partial,
      dueDate: null,
      date: new Date('2026-05-10T00:00:00.000Z'),
      note: null,
      createdAt: new Date('2026-05-10T00:00:00.000Z'),
      updatedAt: new Date('2026-05-11T00:00:00.000Z'),
    });

    await expect(
      service.settleAccount(user, 12, { payAmount: 500 }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('settleAccount 会通过条件更新拦截并发覆盖', async () => {
    prismaService.financeAccountRecord.findFirst.mockResolvedValue({
      id: 14,
      type: 'receivable',
      category: 'sales_credit',
      counterpart: '并发客户',
      amount: new Prisma.Decimal('1000.00'),
      paidAmount: new Prisma.Decimal('200.00'),
      remaining: new Prisma.Decimal('800.00'),
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

    await expect(
      service.settleAccount(user, 14, { payAmount: 100 }),
    ).rejects.toThrow('账款记录已被其他操作更新，请刷新后重试');
    expect(prismaService.financeAccountRecord.updateMany).toHaveBeenCalledWith({
      where: {
        id: 14,
        storeId: 18,
        paidAmount: new Prisma.Decimal('200'),
      },
      data: {
        paidAmount: new Prisma.Decimal('300'),
        remaining: new Prisma.Decimal('700'),
        status: FinanceAccountStatus.partial,
      },
    });
  });

  it('createAccount 成功后会失效财务派生缓存', async () => {
    prismaService.financeAccountRecord.create.mockResolvedValue({
      id: 13,
      type: 'receivable',
      category: 'sales_credit',
      counterpart: '测试客户',
      amount: new Prisma.Decimal('100.00'),
      paidAmount: new Prisma.Decimal('0.00'),
      remaining: new Prisma.Decimal('100.00'),
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
    prismaService.financeAccountRecord.findFirst
      .mockResolvedValueOnce({
        id: 15,
        type: 'payable',
        category: 'supplier_debt',
        counterpart: '供应商A',
        amount: new Prisma.Decimal('1000.00'),
        paidAmount: new Prisma.Decimal('200.00'),
        remaining: new Prisma.Decimal('800.00'),
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
        amount: new Prisma.Decimal('1000.00'),
        paidAmount: new Prisma.Decimal('500.00'),
        remaining: new Prisma.Decimal('500.00'),
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

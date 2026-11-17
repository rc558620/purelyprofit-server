import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { FinanceAccountStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { CacheInvalidatorService } from '../../redis/invalidator';
import { RefreshableCacheService } from '../../redis/refreshable-cache.service';
import { FinanceAccountService } from './finance-account.service';
import { encodeFinanceAccountCursor } from './finance-account.cursor';
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
  let refreshableCache: Pick<
    RefreshableCacheService,
    'getOrLoadRefreshableJson'
  >;
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
      hasMore: false,
      nextCursor: null,
    });
    expect(refreshableCache.getOrLoadRefreshableJson).toHaveBeenCalledWith(
      expect.objectContaining({
        // datePeriod/cDay/cRange/to 都会影响 getDateRangeFromQuery 的结果，
        // 必须进入 cache key，否则不同日期筛选会命中同一份缓存
        cacheKey:
          'profit:finance:accounts:list:store:18:type:receivable:status:pending:search:%E5%BC%A0%E4%B8%89:datePeriod:all:cDay:na-na-na:cRange:na-na-na:to:na-na-na:page:1:pageSize:10',
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
      hasMore: false,
      nextCursor: null,
    });
    expect(prismaService.financeAccountRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            { storeId: 18 },
            {
              storeId: 18,
              remaining: { gt: 0 },
              // 次日零点起才算逾期，故上界为 now - 1 天
              dueDate: { lte: new Date(Date.now() - 86_400_000), not: null },
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
      hasMore: false,
      nextCursor: null,
    });

    expect(prismaService.financeAccountRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            { storeId: 18 },
            {
              storeId: 18,
              remaining: { gt: 0 },
              paidAmount: { lte: 0 },
              OR: [
                { dueDate: null },
                { dueDate: { gt: new Date(Date.now() - 86_400_000) } },
              ],
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
      hasMore: false,
      nextCursor: null,
    });

    expect(prismaService.financeAccountRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            { storeId: 18 },
            {
              storeId: 18,
              remaining: { gt: 0 },
              paidAmount: { gt: 0 },
              OR: [
                { dueDate: null },
                { dueDate: { gt: new Date(Date.now() - 86_400_000) } },
              ],
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
      hasMore: false,
      nextCursor: null,
    });

    expect(prismaService.financeAccountRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            { storeId: 18 },
            {
              storeId: 18,
              remaining: { lte: 0 },
            },
          ],
        },
      }),
    );
  });

  it('listAccounts 的自定义日期按上海时区解析，不随进程时区偏移', async () => {
    prismaService.financeAccountRecord.count.mockResolvedValue(0);
    prismaService.financeAccountRecord.findMany.mockResolvedValue([]);

    await service.listAccounts(user, {
      datePeriod: 'custom_day',
      customDayYear: 2026,
      customDayMonth: 5,
      customDayDay: 14,
      page: 1,
      pageSize: 10,
    });

    // 断言值写死为 UTC 瞬间：上海 05-14 00:00:00 ↔ 05-14 23:59:59.999
    expect(prismaService.financeAccountRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            { storeId: 18 },
            {
              date: {
                gte: new Date('2026-05-13T16:00:00.000Z'),
                lte: new Date('2026-05-14T15:59:59.999Z'),
              },
            },
          ],
        },
      }),
    );
  });

  it('到期日当天的账款不判为逾期，次日零点起才算逾期', async () => {
    // 上海 2026-05-14 零点 = UTC 2026-05-13T16:00Z；当前为 UTC 05-14 12:00
    const todayShanghaiStart = new Date('2026-05-13T16:00:00.000Z');

    prismaService.financeAccountRecord.create.mockResolvedValue({
      id: 70,
      type: 'receivable',
      category: 'sales_credit',
      counterpart: '今天到期客户',
      amount: 10_000,
      paidAmount: 0,
      remaining: 10_000,
      status: FinanceAccountStatus.pending,
      dueDate: todayShanghaiStart,
      date: new Date('2026-05-14T00:00:00.000Z'),
      note: null,
      createdAt: new Date('2026-05-14T00:00:00.000Z'),
      updatedAt: new Date('2026-05-14T00:00:00.000Z'),
    });

    // 旧口径 dueDate < now 会误判为 overdue
    await expect(
      service.createAccount(user, {
        type: 'receivable',
        category: 'sales_credit',
        counterpart: '今天到期客户',
        amount: 100,
        paidAmount: 0,
        dueDate: todayShanghaiStart.getTime(),
        date: new Date('2026-05-14T00:00:00.000Z').getTime(),
      }),
    ).resolves.toMatchObject({ status: 'pending' });
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

  it('getAccountsStats 走单条聚合 SQL，不再全表拉取账款到内存', async () => {
    // 40000 分 = 400 元，15000 分 = 150 元
    prismaService.$queryRaw.mockResolvedValue([
      {
        receivable_remaining: 40000,
        payable_remaining: 15000,
        overdue_count: 2,
        new_this_month_count: 5,
      },
    ]);

    await expect(service.getAccountsStats(user)).resolves.toEqual({
      totalReceivable: 400,
      totalPayable: 150,
      netReceivable: 250,
      overdueCount: 2,
      newThisMonth: 5,
    });

    // 四个指标一条 SQL 算完：不再有 groupBy / count 往返
    expect(prismaService.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prismaService.financeAccountRecord.findMany).not.toHaveBeenCalled();
    expect(prismaService.financeAccountRecord.groupBy).not.toHaveBeenCalled();
    expect(prismaService.financeAccountRecord.count).not.toHaveBeenCalled();
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

  it('createAccount 部分收付且已过期时派生为 overdue 而非 partial', async () => {
    prismaService.financeAccountRecord.create.mockResolvedValue({
      id: 50,
      type: 'receivable',
      category: 'sales_credit',
      counterpart: '逾期客户',
      amount: 100000,
      paidAmount: 30000,
      remaining: 70000,
      status: FinanceAccountStatus.overdue,
      dueDate: new Date('2026-05-01T00:00:00.000Z'),
      date: new Date('2026-04-25T00:00:00.000Z'),
      note: null,
      createdAt: new Date('2026-05-14T12:00:00.000Z'),
      updatedAt: new Date('2026-05-14T12:00:00.000Z'),
    });

    await expect(
      service.createAccount(user, {
        type: 'receivable',
        category: 'sales_credit',
        counterpart: '逾期客户',
        amount: 1000,
        paidAmount: 300,
        dueDate: new Date('2026-05-01T00:00:00.000Z').getTime(),
        date: new Date('2026-04-25T00:00:00.000Z').getTime(),
      }),
    ).resolves.toMatchObject({
      status: 'overdue',
      remaining: 700,
    });
  });

  it('deleteAccount 允许删除已部分收付的账款', async () => {
    prismaService.financeAccountRecord.deleteMany.mockResolvedValue({
      count: 1,
    });

    await expect(service.deleteAccount(user, 60)).resolves.toBeUndefined();
    // 「未结清才可删」直接下推为删除条件，单条 SQL 完成校验 + 删除
    expect(prismaService.financeAccountRecord.deleteMany).toHaveBeenCalledWith({
      where: { id: 60, storeId: 18, remaining: { gt: 0 } },
    });
    // 命中即成功，不再为校验多查一次
    expect(prismaService.financeAccountRecord.findFirst).not.toHaveBeenCalled();
  });

  it('deleteAccount 禁止删除已结清的账款', async () => {
    prismaService.financeAccountRecord.deleteMany.mockResolvedValue({
      count: 0,
    });
    prismaService.financeAccountRecord.findFirst.mockResolvedValue({
      id: 61,
      type: 'receivable',
      category: 'sales_credit',
      counterpart: '已结清客户',
      amount: 50000,
      paidAmount: 50000,
      remaining: 0,
      status: FinanceAccountStatus.settled,
      dueDate: null,
      date: new Date('2026-05-08T00:00:00.000Z'),
      note: null,
      createdAt: new Date('2026-05-08T00:00:00.000Z'),
      updatedAt: new Date('2026-05-12T00:00:00.000Z'),
    });

    await expect(service.deleteAccount(user, 61)).rejects.toThrow(
      '已结清的账款不能删除',
    );
  });

  it('deleteAccount 在并发收付把余额清零时拒绝删除', async () => {
    // 条件删除没命中：记录在读取与删除之间被并发登记收付并结清
    prismaService.financeAccountRecord.deleteMany.mockResolvedValue({
      count: 0,
    });
    prismaService.financeAccountRecord.findFirst.mockResolvedValue({
      id: 62,
      type: 'receivable',
      category: 'sales_credit',
      counterpart: '刚结清客户',
      amount: 50000,
      paidAmount: 50000,
      remaining: 0,
      status: FinanceAccountStatus.settled,
      dueDate: null,
      date: new Date('2026-05-08T00:00:00.000Z'),
      note: null,
      createdAt: new Date('2026-05-08T00:00:00.000Z'),
      updatedAt: new Date('2026-05-13T00:00:00.000Z'),
    });

    await expect(service.deleteAccount(user, 62)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(
      cacheInvalidatorService.invalidateFinanceDerived,
    ).not.toHaveBeenCalled();
  });

  it('deleteAccount 在记录不存在时抛 NotFound', async () => {
    prismaService.financeAccountRecord.deleteMany.mockResolvedValue({
      count: 0,
    });
    prismaService.financeAccountRecord.findFirst.mockResolvedValue(null);

    await expect(service.deleteAccount(user, 999)).rejects.toThrow(
      '账款记录不存在',
    );
  });

  describe('listAccounts 游标分页', () => {
    const buildRow = (id: number, dueDate: Date | null) => ({
      id,
      type: 'receivable',
      category: 'sales_credit',
      counterpart: `客户-${id}`,
      amount: 100000,
      paidAmount: 0,
      remaining: 100000,
      status: FinanceAccountStatus.pending,
      dueDate,
      date: new Date('2026-05-09T00:00:00.000Z'),
      note: null,
      createdAt: new Date('2026-05-09T12:00:00.000Z'),
      updatedAt: new Date('2026-05-14T11:00:00.000Z'),
    });

    it('游标页不进缓存，只切回 limit 条并给出 nextCursor', async () => {
      // 第 3 行是多取的探测行
      prismaService.financeAccountRecord.findMany.mockResolvedValue([
        buildRow(3, new Date('2026-05-01T00:00:00.000Z')),
        buildRow(2, new Date('2026-05-02T00:00:00.000Z')),
        buildRow(1, new Date('2026-05-03T00:00:00.000Z')),
      ]);
      prismaService.financeAccountRecord.count.mockResolvedValue(10);
      const cursor = encodeFinanceAccountCursor({
        dueDate: new Date('2026-04-30T00:00:00.000Z'),
        updatedAt: new Date('2026-05-14T11:00:00.000Z'),
        id: 4,
      });

      const result = await service.listAccounts(user, {
        cursor,
        pageSize: 2,
      });

      expect(refreshableCache.getOrLoadRefreshableJson).not.toHaveBeenCalled();
      expect(result.items.map((item) => item.id)).toEqual(['3', '2']);
      expect(result.hasMore).toBe(true);
      expect(result.nextCursor).not.toBeNull();
      // 每页多取一行的探测约定：take = limit + 1，且游标路径不能再带 skip
      expect(prismaService.financeAccountRecord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 3 }),
      );
      expect(
        prismaService.financeAccountRecord.findMany.mock.calls[0]?.[0],
      ).not.toHaveProperty('skip');
      // total 仍是「不含游标」的全量口径
      expect(result.meta.total).toBe(10);
    });

    it('有到期日段未取满时补查 NULL 尾段，且两段顺序不被打破', async () => {
      prismaService.financeAccountRecord.findMany
        .mockResolvedValueOnce([
          buildRow(9, new Date('2026-06-01T00:00:00.000Z')),
        ])
        .mockResolvedValueOnce([buildRow(1, null), buildRow(2, null)]);
      prismaService.financeAccountRecord.count.mockResolvedValue(3);

      const result = await service.listAccounts(user, {
        cursor: encodeFinanceAccountCursor({
          dueDate: new Date('2026-05-31T00:00:00.000Z'),
          updatedAt: new Date('2026-05-14T11:00:00.000Z'),
          id: 10,
        }),
        pageSize: 3,
      });

      expect(prismaService.financeAccountRecord.findMany).toHaveBeenCalledTimes(
        2,
      );
      expect(
        prismaService.financeAccountRecord.findMany.mock.calls[1]?.[0]?.where,
      ).toEqual(
        expect.objectContaining({
          AND: [{ storeId: 18 }, expect.objectContaining({ dueDate: null })],
        }),
      );
      expect(result.items.map((item) => item.id)).toEqual(['9', '1', '2']);
      expect(result.hasMore).toBe(false);
      expect(result.nextCursor).toBeNull();
    });
  });
});

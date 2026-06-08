import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { FinanceReconciliationStatus, Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { CacheInvalidatorService } from '../../redis/invalidator';
import { RedisService } from '../../redis/redis.service';
import { FinanceReconciliationService } from './finance-reconciliation.service';
import {
  createFinanceReconciliationPrismaMock,
  createFinanceReconciliationProviders,
  createFinanceSpecUser,
  createPlatformMembershipAccessServiceMock,
  useFinanceSpecFakeTimers,
  useFinanceSpecRealTimers,
} from './finance.spec-helpers';

describe('FinanceReconciliationService', () => {
  let service: FinanceReconciliationService;
  let prismaService: ReturnType<typeof createFinanceReconciliationPrismaMock>;
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
    prismaService = createFinanceReconciliationPrismaMock();
    platformMembershipAccessService =
      createPlatformMembershipAccessServiceMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: createFinanceReconciliationProviders(
        prismaService,
        platformMembershipAccessService,
      ),
    }).compile();

    service = module.get<FinanceReconciliationService>(
      FinanceReconciliationService,
    );
    redisService = module.get(RedisService);
    cacheInvalidatorService = module.get(CacheInvalidatorService);
  });

  afterEach(() => {
    useFinanceSpecRealTimers();
  });

  it('listReconciliations 会把筛选和分页下推到数据库', async () => {
    prismaService.financeReconciliationRecord.findMany.mockResolvedValue([
      {
        id: 21,
        storeId: 18,
        operatorStaffId: 8,
        title: '供应商月度对账',
        type: 'supplier',
        status: FinanceReconciliationStatus.discrepancy,
        channel: null,
        counterpart: '华南供应商',
        periodStart: new Date('2026-05-01T00:00:00.000Z'),
        periodEnd: new Date('2026-05-31T23:59:59.999Z'),
        bookIncome: new Prisma.Decimal('12000.00'),
        bookExpense: new Prisma.Decimal('8000.00'),
        bookNet: new Prisma.Decimal('4000.00'),
        actualIncome: new Prisma.Decimal('11800.00'),
        actualExpense: new Prisma.Decimal('8100.00'),
        actualNet: new Prisma.Decimal('3700.00'),
        diffAmount: new Prisma.Decimal('-300.00'),
        adjustNote: null,
        operator: '财务张姐',
        note: '供应商核对备注',
        date: new Date('2026-05-14T00:00:00.000Z'),
        createdAt: new Date('2026-05-14T12:00:00.000Z'),
        updatedAt: new Date('2026-05-14T12:00:00.000Z'),
        items: [],
      },
    ]);
    prismaService.financeReconciliationRecord.count.mockResolvedValue(21);

    await expect(
      service.listReconciliations(user, {
        statusFilter: 'discrepancy',
        typeFilter: 'supplier',
        searchText: '供应商',
        page: 2,
        pageSize: 10,
      }),
    ).resolves.toMatchObject({
      items: [
        expect.objectContaining({
          id: '21',
          type: 'supplier',
          status: 'discrepancy',
          counterpart: '华南供应商',
        }),
      ],
      meta: {
        page: 2,
        pageSize: 10,
        total: 21,
        totalPages: 3,
      },
    });

    expect(
      prismaService.financeReconciliationRecord.findMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          storeId: 18,
          status: 'discrepancy',
          type: 'supplier',
          OR: [
            {
              title: {
                contains: '供应商',
                mode: 'insensitive',
              },
            },
            {
              counterpart: {
                contains: '供应商',
                mode: 'insensitive',
              },
            },
            {
              note: {
                contains: '供应商',
                mode: 'insensitive',
              },
            },
          ],
        },
        skip: 10,
        take: 10,
      }),
    );
    expect(
      prismaService.financeReconciliationRecord.count,
    ).toHaveBeenCalledWith({
      where: {
        storeId: 18,
        status: 'discrepancy',
        type: 'supplier',
        OR: [
          {
            title: {
              contains: '供应商',
              mode: 'insensitive',
            },
          },
          {
            counterpart: {
              contains: '供应商',
              mode: 'insensitive',
            },
          },
          {
            note: {
              contains: '供应商',
              mode: 'insensitive',
            },
          },
        ],
      },
    });
    expect(redisService.getOrLoadRefreshableJson).toHaveBeenCalledWith(
      expect.objectContaining({
        cacheKey:
          'profit:finance:reconciliations:list:store:18:status:discrepancy:type:supplier:search:%E4%BE%9B%E5%BA%94%E5%95%86:page:2:pageSize:10',
        ttlSeconds: 60,
      }),
    );
  });

  it('getReconciliationStats 会通过 refreshable cache 包裹统计读取', async () => {
    prismaService.financeReconciliationRecord.findMany.mockResolvedValue([]);

    await expect(service.getReconciliationStats(user)).resolves.toEqual({
      totalCount: 0,
      confirmedCount: 0,
      discrepancyCount: 0,
      adjustedCount: 0,
      draftCount: 0,
      totalDiffAmount: 0,
      newThisMonth: 0,
    });
    expect(redisService.getOrLoadRefreshableJson).toHaveBeenCalledWith(
      expect.objectContaining({
        cacheKey: 'profit:finance:reconciliations:stats:store:18',
        ttlSeconds: 60,
      }),
    );
  });

  it('createReconciliation 会按前端逻辑计算净额、差异和状态', async () => {
    prismaService.financeReconciliationRecord.create.mockResolvedValue({
      id: 21,
      storeId: 18,
      operatorStaffId: 8,
      title: '5月月度对账',
      type: 'monthly',
      status: FinanceReconciliationStatus.discrepancy,
      channel: null,
      counterpart: null,
      periodStart: new Date('2026-05-01T00:00:00.000Z'),
      periodEnd: new Date('2026-05-31T23:59:59.999Z'),
      bookIncome: new Prisma.Decimal('12000.00'),
      bookExpense: new Prisma.Decimal('8000.00'),
      bookNet: new Prisma.Decimal('4000.00'),
      actualIncome: new Prisma.Decimal('11800.00'),
      actualExpense: new Prisma.Decimal('8100.00'),
      actualNet: new Prisma.Decimal('3700.00'),
      diffAmount: new Prisma.Decimal('-300.00'),
      adjustNote: null,
      operator: '财务张姐',
      note: '节假日汇总',
      date: new Date('2026-05-14T00:00:00.000Z'),
      createdAt: new Date('2026-05-14T12:00:00.000Z'),
      updatedAt: new Date('2026-05-14T12:00:00.000Z'),
      items: [],
    });

    await expect(
      service.createReconciliation(user, {
        title: '5月月度对账',
        type: 'monthly',
        status: 'discrepancy',
        periodStart: new Date('2026-05-01T00:00:00.000Z').getTime(),
        periodEnd: new Date('2026-05-31T23:59:59.999Z').getTime(),
        bookIncome: 12000,
        bookExpense: 8000,
        actualIncome: 11800,
        actualExpense: 8100,
        items: [],
        operator: '财务张姐',
        note: '节假日汇总',
        date: new Date('2026-05-14T00:00:00.000Z').getTime(),
      }),
    ).resolves.toMatchObject({
      id: '21',
      status: 'discrepancy',
      bookNet: 4000,
      actualNet: 3700,
      diffAmount: -300,
      operator: '财务张姐',
      note: '节假日汇总',
    });
    expect(
      cacheInvalidatorService.invalidateFinanceDerived,
    ).toHaveBeenCalledWith(18);
  });

  it('confirmReconciliation 带调整说明时标记为 adjusted', async () => {
    prismaService.financeReconciliationRecord.findFirst.mockResolvedValue({
      id: 21,
      storeId: 18,
      operatorStaffId: 8,
      title: '5月月度对账',
      type: 'monthly',
      status: FinanceReconciliationStatus.discrepancy,
      channel: null,
      counterpart: null,
      periodStart: new Date('2026-05-01T00:00:00.000Z'),
      periodEnd: new Date('2026-05-31T23:59:59.999Z'),
      bookIncome: new Prisma.Decimal('12000.00'),
      bookExpense: new Prisma.Decimal('8000.00'),
      bookNet: new Prisma.Decimal('4000.00'),
      actualIncome: new Prisma.Decimal('11800.00'),
      actualExpense: new Prisma.Decimal('8100.00'),
      actualNet: new Prisma.Decimal('3700.00'),
      diffAmount: new Prisma.Decimal('-300.00'),
      adjustNote: null,
      operator: '财务张姐',
      note: '节假日汇总',
      date: new Date('2026-05-14T00:00:00.000Z'),
      createdAt: new Date('2026-05-14T12:00:00.000Z'),
      updatedAt: new Date('2026-05-14T12:00:00.000Z'),
      items: [],
    });
    prismaService.financeReconciliationRecord.update.mockResolvedValue({
      id: 21,
      storeId: 18,
      operatorStaffId: 8,
      title: '5月月度对账',
      type: 'monthly',
      status: FinanceReconciliationStatus.adjusted,
      channel: null,
      counterpart: null,
      periodStart: new Date('2026-05-01T00:00:00.000Z'),
      periodEnd: new Date('2026-05-31T23:59:59.999Z'),
      bookIncome: new Prisma.Decimal('12000.00'),
      bookExpense: new Prisma.Decimal('8000.00'),
      bookNet: new Prisma.Decimal('4000.00'),
      actualIncome: new Prisma.Decimal('11800.00'),
      actualExpense: new Prisma.Decimal('8100.00'),
      actualNet: new Prisma.Decimal('3700.00'),
      diffAmount: new Prisma.Decimal('-300.00'),
      adjustNote: '微信手续费差额',
      operator: '财务张姐',
      note: '节假日汇总',
      date: new Date('2026-05-14T00:00:00.000Z'),
      createdAt: new Date('2026-05-14T12:00:00.000Z'),
      updatedAt: new Date('2026-05-14T12:05:00.000Z'),
      items: [],
    });

    await expect(
      service.confirmReconciliation(user, 21, {
        adjustNote: ' 微信手续费差额 ',
      }),
    ).resolves.toMatchObject({
      id: '21',
      status: 'adjusted',
      adjustNote: '微信手续费差额',
    });
    expect(
      cacheInvalidatorService.invalidateFinanceDerived,
    ).toHaveBeenCalledWith(18);
  });

  it('删除不存在的对账单时抛 NotFound', async () => {
    prismaService.financeReconciliationRecord.findFirst.mockResolvedValue(null);

    await expect(
      service.deleteReconciliation(user, 999),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { FinanceCashFlowService } from './finance-cash-flow.service';
import {
  createFinanceCashFlowPrismaMock,
  createFinanceCashFlowProviders,
  createFinanceSpecUser,
  createPlatformMembershipAccessServiceMock,
  useFinanceSpecFakeTimers,
  useFinanceSpecRealTimers,
} from './finance.spec-helpers';

describe('FinanceCashFlowService', () => {
  let service: FinanceCashFlowService;
  let prismaService: ReturnType<typeof createFinanceCashFlowPrismaMock>;
  let platformMembershipAccessService: ReturnType<
    typeof createPlatformMembershipAccessServiceMock
  >;

  const user: AuthenticatedUser = createFinanceSpecUser();

  beforeEach(async () => {
    useFinanceSpecFakeTimers();
    prismaService = createFinanceCashFlowPrismaMock();
    platformMembershipAccessService =
      createPlatformMembershipAccessServiceMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: createFinanceCashFlowProviders(
        prismaService,
        platformMembershipAccessService,
      ),
    }).compile();

    service = module.get<FinanceCashFlowService>(FinanceCashFlowService);
  });

  afterEach(() => {
    useFinanceSpecRealTimers();
  });

  it('listCashFlowRecords 在历史窗口被裁剪为空时返回空分页', async () => {
    platformMembershipAccessService.clampHistoryRange.mockResolvedValueOnce({
      start: new Date('2026-05-01T00:00:00.000Z').getTime(),
      end: new Date('2026-05-14T23:59:59.999Z').getTime(),
      empty: true,
    });

    await expect(
      service.listCashFlowRecords(user, {
        period: 'month',
        page: 2,
        pageSize: 5,
      }),
    ).resolves.toEqual({
      items: [],
      meta: {
        page: 2,
        pageSize: 5,
        total: 0,
        totalPages: 0,
      },
    });
    expect(prismaService.financeCashFlowRecord.count).not.toHaveBeenCalled();
    expect(prismaService.financeCashFlowRecord.findMany).not.toHaveBeenCalled();
  });

  it('getCashFlowStats 沿用前端 compareLastPeriod 计算逻辑', async () => {
    prismaService.financeCashFlowRecord.findMany
      .mockResolvedValueOnce([
        {
          id: 1,
          direction: 'expense',
          category: 'purchase',
          title: '进货',
          amount: new Prisma.Decimal('100.00'),
          payment: 'cash',
          note: null,
          date: new Date('2026-05-14T10:00:00.000Z'),
          createdAt: new Date('2026-05-14T10:00:00.000Z'),
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 2,
          direction: 'income',
          category: 'sales',
          title: '昨日营业额',
          amount: new Prisma.Decimal('50.00'),
          payment: 'cash',
          note: null,
          date: new Date('2026-04-10T10:00:00.000Z'),
          createdAt: new Date('2026-04-10T10:00:00.000Z'),
        },
        {
          id: 3,
          direction: 'expense',
          category: 'rent',
          title: '房租',
          amount: new Prisma.Decimal('20.00'),
          payment: 'bank',
          note: null,
          date: new Date('2026-04-12T10:00:00.000Z'),
          createdAt: new Date('2026-04-12T10:00:00.000Z'),
        },
      ]);

    await expect(
      service.getCashFlowStats(user, {
        period: 'month',
        directionFilter: 'expense',
      }),
    ).resolves.toEqual({
      totalIncome: 0,
      totalExpense: 100,
      netFlow: -100,
      recordCount: 1,
      compareLastPeriod: -433.33,
    });
  });

  it('getCashFlowStats 在上一周期被裁剪为空时不计算环比', async () => {
    prismaService.financeCashFlowRecord.findMany.mockResolvedValueOnce([
      {
        direction: 'income',
        amount: new Prisma.Decimal('100.00'),
      },
    ]);
    platformMembershipAccessService.clampHistoryRange
      .mockImplementationOnce(
        async (_storeId: number, range: { start: number; end: number }) => ({
          ...range,
          empty: false,
        }),
      )
      .mockResolvedValueOnce({
        start: new Date('2026-04-01T00:00:00.000Z').getTime(),
        end: new Date('2026-04-30T23:59:59.999Z').getTime(),
        empty: true,
      });

    await expect(
      service.getCashFlowStats(user, { period: 'month' }),
    ).resolves.toEqual({
      totalIncome: 100,
      totalExpense: 0,
      netFlow: 100,
      recordCount: 1,
      compareLastPeriod: null,
    });
    expect(prismaService.financeCashFlowRecord.findMany).toHaveBeenCalledTimes(
      1,
    );
  });

  it('createCashFlowRecord 禁止手动创建 sales 分类流水', async () => {
    await expect(
      service.createCashFlowRecord(user, {
        direction: 'income',
        category: 'sales',
        title: '手动补销售',
        amount: 88,
        payment: 'cash',
        date: new Date('2026-05-14T10:00:00.000Z').getTime(),
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('createCashFlowRecord 允许手动创建 refund 分类流水', async () => {
    prismaService.financeCashFlowRecord.create.mockResolvedValue({
      id: 9,
      direction: 'income',
      category: 'refund',
      title: '供应商返利',
      amount: new Prisma.Decimal('88.00'),
      payment: 'bank',
      note: '年度返利',
      date: new Date('2026-05-14T10:00:00.000Z'),
      createdAt: new Date('2026-05-14T10:05:00.000Z'),
    });

    await expect(
      service.createCashFlowRecord(user, {
        direction: 'income',
        category: 'refund',
        title: '供应商返利',
        amount: 88,
        payment: 'bank',
        note: '年度返利',
        date: new Date('2026-05-14T10:00:00.000Z').getTime(),
      }),
    ).resolves.toEqual({
      id: '9',
      direction: 'income',
      category: 'refund',
      title: '供应商返利',
      amount: 88,
      payment: 'bank',
      note: '年度返利',
      date: new Date('2026-05-14T10:00:00.000Z').getTime(),
      createdAt: new Date('2026-05-14T10:05:00.000Z').getTime(),
    });

    expect(prismaService.financeCashFlowRecord.create).toHaveBeenCalledWith({
      data: {
        storeId: 18,
        operatorStaffId: 8,
        direction: 'income',
        category: 'refund',
        title: '供应商返利',
        amount: new Prisma.Decimal('88'),
        payment: 'bank',
        note: '年度返利',
        date: new Date('2026-05-14T10:00:00.000Z'),
      },
    });
  });

  it('createCashFlowRecord 在方向与分类口径不一致时抛出 ConflictException', async () => {
    await expect(
      service.createCashFlowRecord(user, {
        direction: 'income',
        category: 'purchase',
        title: '错误的进货收入',
        amount: 88,
        payment: 'cash',
        date: new Date('2026-05-14T10:00:00.000Z').getTime(),
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('deleteCashFlowRecord 禁止直接删除关联销售单的流水', async () => {
    prismaService.financeCashFlowRecord.findFirst.mockResolvedValue({
      id: 7,
      saleOrderId: 11,
    });

    await expect(service.deleteCashFlowRecord(user, 7)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('deleteCashFlowRecord 允许删除手动流水', async () => {
    prismaService.financeCashFlowRecord.findFirst.mockResolvedValue({
      id: 8,
      saleOrderId: null,
    });

    await expect(
      service.deleteCashFlowRecord(user, 8),
    ).resolves.toBeUndefined();
    expect(prismaService.financeCashFlowRecord.delete).toHaveBeenCalledWith({
      where: { id: 8 },
    });
  });
});

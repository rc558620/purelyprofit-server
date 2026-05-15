import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  FinanceAccountStatus,
  FinanceReconciliationStatus,
  Prisma,
} from '@prisma/client';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PrismaService } from '../prisma/prisma.service';
import { FinanceService } from './finance.service';

describe('FinanceService', () => {
  let service: FinanceService;

  const prismaService = {
    financeCashFlowRecord: {
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
      delete: jest.fn(),
    },
    financeAccountRecord: {
      findMany: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    financeReconciliationRecord: {
      findMany: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
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
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-05-14T12:00:00.000Z'));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FinanceService,
        { provide: PrismaService, useValue: prismaService },
      ],
    }).compile();

    service = module.get<FinanceService>(FinanceService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('getOverview 将 refund/transfer_in/other_income 统一归到附加收入', async () => {
    prismaService.financeCashFlowRecord.findMany.mockResolvedValue([
      {
        category: 'sales',
        amount: new Prisma.Decimal('1000.00'),
        date: new Date('2026-05-12T10:00:00.000Z'),
      },
      {
        category: 'refund',
        amount: new Prisma.Decimal('80.00'),
        date: new Date('2026-05-12T11:00:00.000Z'),
      },
      {
        category: 'transfer_in',
        amount: new Prisma.Decimal('20.00'),
        date: new Date('2026-05-13T09:00:00.000Z'),
      },
      {
        category: 'other_income',
        amount: new Prisma.Decimal('200.00'),
        date: new Date('2026-05-13T10:00:00.000Z'),
      },
      {
        category: 'purchase',
        amount: new Prisma.Decimal('300.00'),
        date: new Date('2026-05-11T10:00:00.000Z'),
      },
      {
        category: 'rent',
        amount: new Prisma.Decimal('100.00'),
        date: new Date('2026-05-10T10:00:00.000Z'),
      },
      {
        category: 'sales',
        amount: new Prisma.Decimal('500.00'),
        date: new Date('2026-04-20T10:00:00.000Z'),
      },
      {
        category: 'refund',
        amount: new Prisma.Decimal('50.00'),
        date: new Date('2026-04-21T10:00:00.000Z'),
      },
      {
        category: 'purchase',
        amount: new Prisma.Decimal('100.00'),
        date: new Date('2026-04-25T10:00:00.000Z'),
      },
    ]);

    await expect(
      service.getOverview(user, { period: 'month' }),
    ).resolves.toMatchObject({
      heroSummary: {
        netIncome: { current: 900, previous: 450, changeRate: 100 },
        totalIncome: { current: 1300, previous: 550, changeRate: 136.36 },
        totalExpense: { current: 400, previous: 100, changeRate: 300 },
        profitRate: { current: 69.23, previous: 81.82, changeRate: -12.59 },
        incomeExpenseRatio: 3.25,
      },
      incomeGroup: {
        total: 1300,
        items: [
          { type: 'sales', amount: 1000, percent: 77 },
          { type: 'additional', amount: 300, percent: 23 },
        ],
      },
      expenseGroup: {
        total: 400,
        items: [
          { type: 'cost', amount: 100, percent: 25 },
          { type: 'purchase', amount: 300, percent: 75 },
        ],
      },
    });
  });

  it('getOverview 将 salary/transfer_out/other_expense 统一归到成本支出', async () => {
    prismaService.financeCashFlowRecord.findMany.mockResolvedValue([
      {
        category: 'salary',
        amount: new Prisma.Decimal('50.00'),
        date: new Date('2026-05-12T10:00:00.000Z'),
      },
      {
        category: 'transfer_out',
        amount: new Prisma.Decimal('30.00'),
        date: new Date('2026-05-13T11:00:00.000Z'),
      },
      {
        category: 'other_expense',
        amount: new Prisma.Decimal('20.00'),
        date: new Date('2026-05-13T12:00:00.000Z'),
      },
      {
        category: 'purchase',
        amount: new Prisma.Decimal('40.00'),
        date: new Date('2026-05-13T13:00:00.000Z'),
      },
    ]);

    await expect(
      service.getOverview(user, { period: 'month' }),
    ).resolves.toMatchObject({
      incomeGroup: {
        total: 0,
        items: [
          { type: 'sales', amount: 0, percent: 0 },
          { type: 'additional', amount: 0, percent: 0 },
        ],
      },
      expenseGroup: {
        total: 140,
        items: [
          { type: 'cost', amount: 100, percent: 71 },
          { type: 'purchase', amount: 40, percent: 29 },
        ],
      },
    });
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

  it('getReport 返回报表中心财务契约并支持 year 周期', async () => {
    prismaService.financeCashFlowRecord.findMany
      .mockResolvedValueOnce([
        {
          id: 1,
          direction: 'income',
          category: 'sales',
          title: '午市营业额',
          amount: new Prisma.Decimal('500.00'),
          payment: 'wechat',
          note: null,
          date: new Date('2025-05-14T10:00:00.000Z'),
          createdAt: new Date('2025-05-14T10:05:00.000Z'),
        },
        {
          id: 2,
          direction: 'expense',
          category: 'purchase',
          title: '采购牛奶',
          amount: new Prisma.Decimal('120.00'),
          payment: 'bank',
          note: null,
          date: new Date('2025-05-13T08:00:00.000Z'),
          createdAt: new Date('2025-05-13T08:05:00.000Z'),
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 3,
          direction: 'income',
          category: 'sales',
          title: '去年营业额',
          amount: new Prisma.Decimal('300.00'),
          payment: 'cash',
          note: null,
          date: new Date('2024-05-14T10:00:00.000Z'),
          createdAt: new Date('2024-05-14T10:05:00.000Z'),
        },
        {
          id: 4,
          direction: 'expense',
          category: 'rent',
          title: '去年房租',
          amount: new Prisma.Decimal('100.00'),
          payment: 'bank',
          note: null,
          date: new Date('2024-05-02T10:00:00.000Z'),
          createdAt: new Date('2024-05-02T10:05:00.000Z'),
        },
      ]);
    prismaService.financeAccountRecord.findMany.mockResolvedValue([
      {
        id: 8,
        type: 'receivable',
        category: 'sales_credit',
        counterpart: '张三水果店',
        amount: new Prisma.Decimal('500.00'),
        paidAmount: new Prisma.Decimal('200.00'),
        remaining: new Prisma.Decimal('300.00'),
        status: FinanceAccountStatus.partial,
        dueDate: null,
        date: new Date('2025-05-12T10:00:00.000Z'),
        note: null,
        createdAt: new Date('2025-05-12T10:10:00.000Z'),
        updatedAt: new Date('2025-05-12T10:10:00.000Z'),
      },
      {
        id: 9,
        type: 'payable',
        category: 'supplier_debt',
        counterpart: '供应商A',
        amount: new Prisma.Decimal('260.00'),
        paidAmount: new Prisma.Decimal('60.00'),
        remaining: new Prisma.Decimal('200.00'),
        status: FinanceAccountStatus.partial,
        dueDate: null,
        date: new Date('2025-05-10T10:00:00.000Z'),
        note: null,
        createdAt: new Date('2025-05-10T10:10:00.000Z'),
        updatedAt: new Date('2025-05-10T10:10:00.000Z'),
      },
      {
        id: 10,
        type: 'payable',
        category: 'loan',
        counterpart: '银行',
        amount: new Prisma.Decimal('100.00'),
        paidAmount: new Prisma.Decimal('100.00'),
        remaining: new Prisma.Decimal('0.00'),
        status: FinanceAccountStatus.settled,
        dueDate: null,
        date: new Date('2025-05-01T10:00:00.000Z'),
        note: null,
        createdAt: new Date('2025-05-01T10:10:00.000Z'),
        updatedAt: new Date('2025-05-01T10:10:00.000Z'),
      },
    ]);

    await expect(
      service.getReport(user, {
        period: 'year',
        year: 2025,
      }),
    ).resolves.toEqual({
      summary: {
        totalIncome: 500,
        totalExpense: 120,
        netCashFlow: 380,
        recordCount: 2,
        receivableTotal: 300,
        payableTotal: 200,
        compareLastPeriod: 90,
      },
      cashFlowRows: [
        {
          id: '1',
          dateLabel: '2025-5-14',
          title: '午市营业额',
          direction: 'income',
          categoryLabel: '销售收入',
          amount: 500,
          paymentLabel: '微信',
        },
        {
          id: '2',
          dateLabel: '2025-5-13',
          title: '采购牛奶',
          direction: 'expense',
          categoryLabel: '采购进货',
          amount: 120,
          paymentLabel: '银行转账',
        },
      ],
      accountRows: [
        {
          id: '8',
          type: 'receivable',
          typeLabel: '应收',
          counterpart: '张三水果店',
          amount: 500,
          remaining: 300,
          statusLabel: '部分收付',
          statusKey: 'partial',
          dateLabel: '2025-5-12',
        },
        {
          id: '9',
          type: 'payable',
          typeLabel: '应付',
          counterpart: '供应商A',
          amount: 260,
          remaining: 200,
          statusLabel: '部分收付',
          statusKey: 'partial',
          dateLabel: '2025-5-10',
        },
      ],
    });

    expect(prismaService.financeCashFlowRecord.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          storeId: 18,
          date: {
            gte: new Date(2025, 0, 1, 0, 0, 0, 0),
            lte: new Date(2025, 11, 31, 23, 59, 59, 999),
          },
        }),
      }),
    );
    expect(prismaService.financeCashFlowRecord.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          storeId: 18,
          date: {
            gte: new Date(2024, 0, 1, 0, 0, 0, 0),
            lte: new Date(2024, 11, 31, 23, 59, 59, 999),
          },
        }),
      }),
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

    await expect(service.deleteCashFlowRecord(user, 8)).resolves.toBeUndefined();
    expect(prismaService.financeCashFlowRecord.delete).toHaveBeenCalledWith({
      where: { id: 8 },
    });
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

  it('删除不存在的对账单时抛 NotFound', async () => {
    prismaService.financeReconciliationRecord.findFirst.mockResolvedValue(null);

    await expect(
      service.deleteReconciliation(user, 999),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

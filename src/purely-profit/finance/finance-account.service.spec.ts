import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { FinanceAccountStatus, Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
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
  });

  afterEach(() => {
    useFinanceSpecRealTimers();
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

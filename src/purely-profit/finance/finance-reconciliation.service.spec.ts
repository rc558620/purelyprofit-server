import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { FinanceReconciliationStatus, Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
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

  const user: AuthenticatedUser = createFinanceSpecUser();

  beforeEach(async () => {
    useFinanceSpecFakeTimers();
    prismaService = createFinanceReconciliationPrismaMock();
    platformMembershipAccessService = createPlatformMembershipAccessServiceMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: createFinanceReconciliationProviders(
        prismaService,
        platformMembershipAccessService,
      ),
    }).compile();

    service = module.get<FinanceReconciliationService>(FinanceReconciliationService);
  });

  afterEach(() => {
    useFinanceSpecRealTimers();
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

  it('删除不存在的对账单时抛 NotFound', async () => {
    prismaService.financeReconciliationRecord.findFirst.mockResolvedValue(null);

    await expect(
      service.deleteReconciliation(user, 999),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

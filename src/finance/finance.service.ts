import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  FinanceAccountStatus,
  FinanceReconciliationStatus,
  Prisma,
} from '@prisma/client';
import Decimal from 'decimal.js';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PrismaService } from '../prisma/prisma.service';
import {
  ConfirmFinanceReconciliationDto,
  CreateFinanceAccountDto,
  CreateFinanceCashFlowRecordDto,
  CreateFinanceReconciliationDto,
    ListFinanceAccountsQueryDto,
    ListFinanceCashFlowRecordsQueryDto,
    ListFinanceReconciliationsQueryDto,
    type FinanceOverviewQueryDto,
    type FinanceReportQueryDto,

  type FinanceReconciliationItemInputDto,
  type SettleFinanceAccountDto,
} from './dto/finance-query.dto';
import {
    type FinanceAccountRecordResponseDto,
    type FinanceAccountsStatsDto,
    type FinanceCashFlowRecordResponseDto,
    type FinanceCashFlowStatsDto,
    type FinanceCompareDto,
    FinanceOverviewResponseDto,
    type FinanceReportAccountRowDto,
    type FinanceReportCashFlowRowDto,
    type FinanceReportResponseDto,
    FinanceReconciliationRecordResponseDto,

  FinanceReconciliationStatsDto,
  type FinanceSourceGroupDto,
  PaginatedFinanceAccountsResponseDto,
  PaginatedFinanceCashFlowRecordsResponseDto,
  PaginatedFinanceReconciliationsResponseDto,
} from './dto/finance-response.dto';
import {
  FINANCE_DEFAULT_PAGE,
  FINANCE_DEFAULT_PAGE_SIZE,
  FINANCE_OVERVIEW_DISPLAY_DAYS,
  type FinanceOverviewPeriodValue,
} from './finance.types';

const DAY_MS = 86_400_000;
const ACCOUNT_STATUS_ORDER: Record<FinanceAccountStatus, number> = {
  overdue: 0,
  pending: 1,
  partial: 2,
  settled: 3,
};
const OVERVIEW_SOURCE_CONFIG = {
  sales: {
    label: '销售收入',
    direction: 'income' as const,
    color: '#84cc16',
    icon: '🛒',
  },
  additional: {
    label: '附加收入',
    direction: 'income' as const,
    color: '#10b981',
    icon: '✨',
  },
  cost: {
    label: '成本支出',
    direction: 'expense' as const,
    color: '#f43f5e',
    icon: '📋',
  },
  purchase: {
    label: '进货支出',
    direction: 'expense' as const,
    color: '#f97316',
    icon: '🚚',
  },
} as const;

type PrismaDecimalLike = Prisma.Decimal | Decimal | number | string;

type FinanceCashFlowOverviewBucket = keyof typeof OVERVIEW_SOURCE_CONFIG;

type FinanceCashFlowCategoryRule = {
  label: string;
  direction: 'income' | 'expense';
  allowManualCreate: boolean;
  overviewBucket: FinanceCashFlowOverviewBucket;
  manualCreateError?: string;
};

type FinanceAccountCategoryRule = {
  label: string;
  allowManualCreate: boolean;
  allowedTypes: Array<'receivable' | 'payable'>;
  manualCreateError?: string;
};

const CASH_FLOW_CATEGORY_RULES = {
  sales: {
    label: '销售收入',
    direction: 'income',
    allowManualCreate: false,
    overviewBucket: 'sales',
    manualCreateError: '销售收入流水需通过销售记录自动生成',
  },
  refund: {
    label: '退款回收',
    direction: 'income',
    allowManualCreate: true,
    overviewBucket: 'additional',
  },
  transfer_in: {
    label: '转账收入',
    direction: 'income',
    allowManualCreate: true,
    overviewBucket: 'additional',
  },
  other_income: {
    label: '其他收入',
    direction: 'income',
    allowManualCreate: true,
    overviewBucket: 'additional',
  },
  purchase: {
    label: '采购进货',
    direction: 'expense',
    allowManualCreate: true,
    overviewBucket: 'purchase',
  },
  rent: {
    label: '店面租金',
    direction: 'expense',
    allowManualCreate: true,
    overviewBucket: 'cost',
  },
  utilities: {
    label: '水电煤气',
    direction: 'expense',
    allowManualCreate: true,
    overviewBucket: 'cost',
  },
  salary: {
    label: '员工工资',
    direction: 'expense',
    allowManualCreate: true,
    overviewBucket: 'cost',
  },
  marketing: {
    label: '营销推广',
    direction: 'expense',
    allowManualCreate: true,
    overviewBucket: 'cost',
  },
  tax: {
    label: '税务缴纳',
    direction: 'expense',
    allowManualCreate: true,
    overviewBucket: 'cost',
  },
  transfer_out: {
    label: '转账支出',
    direction: 'expense',
    allowManualCreate: true,
    overviewBucket: 'cost',
  },
  other_expense: {
    label: '其他支出',
    direction: 'expense',
    allowManualCreate: true,
    overviewBucket: 'cost',
  },
} as const satisfies Record<string, FinanceCashFlowCategoryRule>;

const ACCOUNT_CATEGORY_RULES = {
  sales_credit: {
    label: '客户赊账',
    allowManualCreate: true,
    allowedTypes: ['receivable'],
  },
  advance_paid: {
    label: '预付货款',
    allowManualCreate: true,
    allowedTypes: ['receivable', 'payable'],
  },
  supplier_debt: {
    label: '供应商欠款',
    allowManualCreate: true,
    allowedTypes: ['payable'],
  },
  loan: {
    label: '借贷往来',
    allowManualCreate: true,
    allowedTypes: ['receivable', 'payable'],
  },
  deposit: {
    label: '押金/保证金',
    allowManualCreate: true,
    allowedTypes: ['receivable', 'payable'],
  },
  other: {
    label: '其他',
    allowManualCreate: true,
    allowedTypes: ['receivable', 'payable'],
  },
} as const satisfies Record<string, FinanceAccountCategoryRule>;

const FINANCE_REPORT_PAYMENT_LABELS: Record<string, string> = {
  cash: '现金',
  wechat: '微信',
  alipay: '支付宝',
  card: '刷卡',
  bank: '银行转账',
  other: '其他',
};

const FINANCE_REPORT_ACCOUNT_STATUS_LABELS: Record<string, string> = {
  pending: '待收付',
  partial: '部分收付',
  settled: '已结清',
  overdue: '已逾期',
};

const FINANCE_REPORT_ACCOUNT_TYPE_LABELS: Record<string, string> = {
  receivable: '应收',
  payable: '应付',
};

type FinancePeriodTotals = Record<FinanceCashFlowOverviewBucket, number>;

type FinanceCashFlowFilterRange = {
  start: number;
  end: number;
  period: NonNullable<ListFinanceCashFlowRecordsQueryDto['period']>;
};

type FinanceReportRange = {
  start: number;
  end: number;
  period: NonNullable<FinanceReportQueryDto['period']>;
};

type FinanceCashFlowRecordWithAmount = {
  id: number;
  direction: string;
  category: string;
  title: string;
  amount: Prisma.Decimal;
  payment: string;
  note: string | null;
  date: Date;
  createdAt: Date;
};

/** 仅用于统计计算的最小流水行类型（getCashFlowStats 专用） */
type FinanceCashFlowStatsRow = {
  direction: string;
  amount: Prisma.Decimal;
};

type FinanceAccountRecordWithAmount = {
  id: number;
  type: string;
  category: string;
  counterpart: string;
  amount: Prisma.Decimal;
  paidAmount: Prisma.Decimal;
  remaining: Prisma.Decimal;
  status: FinanceAccountStatus;
  dueDate: Date | null;
  date: Date;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type FinanceReconciliationRecordWithItems =
  Prisma.FinanceReconciliationRecordGetPayload<{
    include: { items: true };
  }>;

type PaginationState = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

@Injectable()
export class FinanceService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview(
    user: AuthenticatedUser,
    query: FinanceOverviewQueryDto,
  ): Promise<FinanceOverviewResponseDto> {
    const storeId = this.getCurrentStoreIdOrThrow(user);
    const period = query.period ?? 'month';
    const { start, end } = this.getOverviewCurrentRange(period);
    const { prevStart, prevEnd } = this.getOverviewPreviousRange(start, end);
    const queryStart = Math.max(0, Math.min(start, prevStart));
    const records = await this.prisma.financeCashFlowRecord.findMany({
      where: {
        storeId,
        date: {
          gte: new Date(queryStart),
          lte: new Date(end),
        },
      },
      select: {
        category: true,
        amount: true,
        date: true,
      },
      orderBy: [{ date: 'asc' }, { id: 'asc' }],
    });

    const currentTotals = this.makeOverviewTotals();
    const previousTotals = this.makeOverviewTotals();
    const incomeMap = new Map<number, number>();
    const expenseMap = new Map<number, number>();

    for (const record of records) {
      const amount = this.toMoneyNumber(record.amount);
      const timestamp = record.date.getTime();
      const bucket = this.mapCashFlowCategoryToOverviewBucket(record.category);
      if (bucket === null) {
        continue;
      }

      if (timestamp >= start && timestamp <= end) {
        currentTotals[bucket] = this.addMoney(currentTotals[bucket], amount);
        const dayStart = this.getDayStart(timestamp);
        const targetMap =
          OVERVIEW_SOURCE_CONFIG[bucket].direction === 'income'
            ? incomeMap
            : expenseMap;
        targetMap.set(
          dayStart,
          this.addMoney(targetMap.get(dayStart) ?? 0, amount),
        );
      } else if (timestamp >= prevStart && timestamp <= prevEnd) {
        previousTotals[bucket] = this.addMoney(previousTotals[bucket], amount);
      }
    }

    const heroSummary = this.buildOverviewHeroSummary(
      currentTotals,
      previousTotals,
    );
    const dailyTrend = this.buildOverviewDailyTrend(
      period,
      end,
      incomeMap,
      expenseMap,
    );
    const { incomeGroup, expenseGroup } =
      this.buildOverviewSourceGroups(currentTotals);

    return {
      heroSummary,
      dailyTrend,
      incomeGroup,
      expenseGroup,
    };
  }

  async getReport(
    user: AuthenticatedUser,
    query: FinanceReportQueryDto,
  ): Promise<FinanceReportResponseDto> {
    const storeId = this.getCurrentStoreIdOrThrow(user);
    const range = this.getFinanceReportRange(query);
    const previousRange = this.getPreviousFinanceReportRange(query, range);

    const [currentCashFlowRecords, previousCashFlowRecords, accountRecords] =
      await Promise.all([
        this.prisma.financeCashFlowRecord.findMany({
          where: {
            storeId,
            date: {
              gte: new Date(range.start),
              lte: new Date(range.end),
            },
          },
          orderBy: [{ date: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
        }),
        previousRange
          ? this.prisma.financeCashFlowRecord.findMany({
              where: {
                storeId,
                date: {
                  gte: new Date(previousRange.start),
                  lte: new Date(previousRange.end),
                },
              },
            })
          : Promise.resolve<FinanceCashFlowRecordWithAmount[]>([]),
        this.prisma.financeAccountRecord.findMany({
          where: { storeId },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        }),
      ]);

    return {
      summary: this.buildFinanceReportSummary(
        currentCashFlowRecords,
        previousCashFlowRecords,
        accountRecords,
      ),
      cashFlowRows: this.buildFinanceReportCashFlowRows(currentCashFlowRecords),
      accountRows: this.buildFinanceReportAccountRows(accountRecords),
    };
  }

  async listCashFlowRecords(
    user: AuthenticatedUser,
    query: ListFinanceCashFlowRecordsQueryDto,
  ): Promise<PaginatedFinanceCashFlowRecordsResponseDto> {
    const storeId = this.getCurrentStoreIdOrThrow(user);
    const range = this.getCashFlowFilterRange(query);
    const directionFilter = query.directionFilter ?? 'all';
    const pageState = this.resolvePagination(query.page, query.pageSize);
    const where: Prisma.FinanceCashFlowRecordWhereInput = {
      storeId,
      date: {
        gte: new Date(range.start),
        lte: new Date(range.end),
      },
      ...(directionFilter !== 'all' ? { direction: directionFilter } : {}),
    };

    const [total, records] = await Promise.all([
      this.prisma.financeCashFlowRecord.count({ where }),
      this.prisma.financeCashFlowRecord.findMany({
        where,
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
        skip: (pageState.page - 1) * pageState.pageSize,
        take: pageState.pageSize,
      }),
    ]);

    return {
      items: records.map((record) => this.mapCashFlowRecord(record)),
      meta: this.buildPaginationMeta(pageState.page, pageState.pageSize, total),
    };
  }

  async getCashFlowStats(
    user: AuthenticatedUser,
    query: ListFinanceCashFlowRecordsQueryDto,
  ): Promise<FinanceCashFlowStatsDto> {
    const storeId = this.getCurrentStoreIdOrThrow(user);
    const range = this.getCashFlowFilterRange(query);
    const directionFilter = query.directionFilter ?? 'all';
    const currentRecords = await this.prisma.financeCashFlowRecord.findMany({
      where: {
        storeId,
        date: {
          gte: new Date(range.start),
          lte: new Date(range.end),
        },
        ...(directionFilter !== 'all' ? { direction: directionFilter } : {}),
      },
      select: {
        direction: true,
        amount: true,
      },
    });
    const baseStats = this.buildCashFlowBaseStats(currentRecords);
    const previousRange = this.getPreviousCashFlowRange(range.period);
    if (previousRange === null) {
      return {
        ...baseStats,
        compareLastPeriod: null,
      };
    }

    const previousRecords = await this.prisma.financeCashFlowRecord.findMany({
      where: {
        storeId,
        date: {
          gte: new Date(previousRange.start),
          lte: new Date(previousRange.end),
        },
      },
      select: {
        direction: true,
        amount: true,
      },
    });
    const previousStats = this.buildCashFlowBaseStats(previousRecords);

    return {
      ...baseStats,
      compareLastPeriod: this.isZero(previousStats.netFlow)
        ? null
        : this.roundMoney(
            new Decimal(baseStats.netFlow)
              .minus(previousStats.netFlow)
              .div(new Decimal(previousStats.netFlow).abs())
              .mul(100),
          ),
    };
  }

  async createCashFlowRecord(
    user: AuthenticatedUser,
    dto: CreateFinanceCashFlowRecordDto,
  ): Promise<FinanceCashFlowRecordResponseDto> {
    const storeId = this.getCurrentStoreIdOrThrow(user);
    const operatorStaffId = user.currentMembership?.staffId ?? null;

    this.assertCashFlowCategoryCanCreateManually(dto.category);
    this.assertCashFlowDirectionMatchesCategory(dto.direction, dto.category);

    const createdRecord = await this.prisma.financeCashFlowRecord.create({
      data: {
        storeId,
        operatorStaffId,
        direction: dto.direction,
        category: dto.category,
        title: dto.title.trim(),
        amount: this.toPrismaDecimal(dto.amount),
        payment: dto.payment,
        note: this.trimOptionalString(dto.note),
        date: new Date(dto.date),
      },
    });

    return this.mapCashFlowRecord(createdRecord);
  }

  async deleteCashFlowRecord(
    user: AuthenticatedUser,
    recordId: number,
  ): Promise<void> {
    const storeId = this.getCurrentStoreIdOrThrow(user);
    const record = await this.ensureCashFlowRecordExists(storeId, recordId);

    if (record.saleOrderId !== null) {
      throw new ConflictException('销售收入流水需通过删除销售记录回滚');
    }

    await this.prisma.financeCashFlowRecord.delete({
      where: { id: recordId },
    });
  }

  async listAccounts(
    user: AuthenticatedUser,
    query: ListFinanceAccountsQueryDto,
  ): Promise<PaginatedFinanceAccountsResponseDto> {
    const storeId = this.getCurrentStoreIdOrThrow(user);
    const records = await this.prisma.financeAccountRecord.findMany({
      where: { storeId },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    });
    const filteredRecords = this.filterAndSortAccounts(records, query);
    const pageState = this.resolvePagination(query.page, query.pageSize);
    const pagination = this.buildPaginationMeta(
      pageState.page,
      pageState.pageSize,
      filteredRecords.length,
    );
    const items = this.paginateArray(filteredRecords, pagination).map(
      (record) => this.mapAccountRecord(record),
    );

    return {
      items,
      meta: pagination,
    };
  }

  async getAccountsStats(
    user: AuthenticatedUser,
  ): Promise<FinanceAccountsStatsDto> {
    const storeId = this.getCurrentStoreIdOrThrow(user);
    const records = await this.prisma.financeAccountRecord.findMany({
      where: { storeId },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    });
    return this.buildAccountsStats(records);
  }

  async createAccount(
    user: AuthenticatedUser,
    dto: CreateFinanceAccountDto,
  ): Promise<FinanceAccountRecordResponseDto> {
    const storeId = this.getCurrentStoreIdOrThrow(user);
    const operatorStaffId = user.currentMembership?.staffId ?? null;
    const amount = this.roundMoney(dto.amount);
    const paidAmount = this.roundMoney(dto.paidAmount);

    this.assertAccountCategoryCanCreateManually(dto.category);
    this.assertAccountTypeMatchesCategory(dto.type, dto.category);

    if (paidAmount > amount) {
      throw new ConflictException('已收付金额不能大于总金额');
    }
    const dueDate = dto.dueDate ? new Date(dto.dueDate) : null;
    const derived = this.deriveAccountFields(amount, paidAmount, dto.dueDate);
    const createdRecord = await this.prisma.financeAccountRecord.create({
      data: {
        storeId,
        operatorStaffId,
        type: dto.type,
        category: dto.category,
        counterpart: dto.counterpart.trim(),
        amount: this.toPrismaDecimal(amount),
        paidAmount: this.toPrismaDecimal(paidAmount),
        remaining: this.toPrismaDecimal(derived.remaining),
        status: derived.status,
        dueDate,
        date: new Date(dto.date),
        note: this.trimOptionalString(dto.note),
      },
    });

    return this.mapAccountRecord(createdRecord);
  }

  async settleAccount(
    user: AuthenticatedUser,
    recordId: number,
    dto: SettleFinanceAccountDto,
  ): Promise<FinanceAccountRecordResponseDto> {
    const storeId = this.getCurrentStoreIdOrThrow(user);
    const record = await this.prisma.financeAccountRecord.findFirst({
      where: {
        id: recordId,
        storeId,
      },
    });
    if (!record) {
      throw new NotFoundException('账款记录不存在');
    }

    const currentPaidAmount = this.toMoneyNumber(record.paidAmount);
    const amount = this.toMoneyNumber(record.amount);
    const payAmount = this.roundMoney(dto.payAmount);
    const nextPaidAmount = this.roundMoney(
      new Decimal(currentPaidAmount).plus(payAmount),
    );
    if (nextPaidAmount > amount) {
      throw new ConflictException('本次收付金额超过剩余金额');
    }
    const derived = this.deriveAccountFields(
      amount,
      nextPaidAmount,
      record.dueDate?.getTime() ?? undefined,
    );
    const updatedRecord = await this.prisma.financeAccountRecord.update({
      where: { id: recordId },
      data: {
        paidAmount: this.toPrismaDecimal(nextPaidAmount),
        remaining: this.toPrismaDecimal(derived.remaining),
        status: derived.status,
      },
    });

    return this.mapAccountRecord(updatedRecord);
  }

  async deleteAccount(
    user: AuthenticatedUser,
    recordId: number,
  ): Promise<void> {
    const storeId = this.getCurrentStoreIdOrThrow(user);
    const record = await this.prisma.financeAccountRecord.findFirst({
      where: {
        id: recordId,
        storeId,
      },
      select: { id: true },
    });
    if (!record) {
      throw new NotFoundException('账款记录不存在');
    }
    await this.prisma.financeAccountRecord.delete({
      where: { id: recordId },
    });
  }

  async listReconciliations(
    user: AuthenticatedUser,
    query: ListFinanceReconciliationsQueryDto,
  ): Promise<PaginatedFinanceReconciliationsResponseDto> {
    const storeId = this.getCurrentStoreIdOrThrow(user);
    const records = await this.prisma.financeReconciliationRecord.findMany({
      where: { storeId },
      include: {
        items: {
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        },
      },
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
    });
    const filteredRecords = this.filterReconciliations(records, query);
    const pageState = this.resolvePagination(query.page, query.pageSize);
    const pagination = this.buildPaginationMeta(
      pageState.page,
      pageState.pageSize,
      filteredRecords.length,
    );
    return {
      items: this.paginateArray(filteredRecords, pagination).map((record) =>
        this.mapReconciliationRecord(record),
      ),
      meta: pagination,
    };
  }

  async getReconciliationStats(
    user: AuthenticatedUser,
  ): Promise<FinanceReconciliationStatsDto> {
    const storeId = this.getCurrentStoreIdOrThrow(user);
    const records = await this.prisma.financeReconciliationRecord.findMany({
      where: { storeId },
      include: {
        items: {
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        },
      },
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
    });
    return this.buildReconciliationStats(records);
  }

  async createReconciliation(
    user: AuthenticatedUser,
    dto: CreateFinanceReconciliationDto,
  ): Promise<FinanceReconciliationRecordResponseDto> {
    const storeId = this.getCurrentStoreIdOrThrow(user);
    const operatorStaffId = user.currentMembership?.staffId ?? null;
    const bookIncome = this.roundMoney(dto.bookIncome);
    const bookExpense = this.roundMoney(dto.bookExpense);
    const actualIncome = this.roundMoney(dto.actualIncome);
    const actualExpense = this.roundMoney(dto.actualExpense);
    const bookNet = this.roundMoney(new Decimal(bookIncome).minus(bookExpense));
    const actualNet = this.roundMoney(
      new Decimal(actualIncome).minus(actualExpense),
    );
    const diffAmount = this.roundMoney(new Decimal(actualNet).minus(bookNet));
    const status = this.normalizeCreateReconciliationStatus(
      dto.status,
      actualIncome,
      actualExpense,
      diffAmount,
    );
    const items = (dto.items ?? []).map((item) =>
      this.buildReconciliationItemCreateInput(item),
    );

    const createdRecord = await this.prisma.financeReconciliationRecord.create({
      data: {
        storeId,
        operatorStaffId,
        title: dto.title.trim(),
        type: dto.type,
        status,
        channel: dto.type === 'payment' ? (dto.channel ?? 'all') : null,
        counterpart: this.trimOptionalString(dto.counterpart),
        periodStart: new Date(dto.periodStart),
        periodEnd: new Date(dto.periodEnd),
        bookIncome: this.toPrismaDecimal(bookIncome),
        bookExpense: this.toPrismaDecimal(bookExpense),
        bookNet: this.toPrismaDecimal(bookNet),
        actualIncome: this.toPrismaDecimal(actualIncome),
        actualExpense: this.toPrismaDecimal(actualExpense),
        actualNet: this.toPrismaDecimal(actualNet),
        diffAmount: this.toPrismaDecimal(diffAmount),
        operator: this.trimOptionalString(dto.operator),
        note: this.trimOptionalString(dto.note),
        date: new Date(dto.date),
        items: {
          create: items,
        },
      },
      include: {
        items: {
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        },
      },
    });

    return this.mapReconciliationRecord(createdRecord);
  }

  async confirmReconciliation(
    user: AuthenticatedUser,
    recordId: number,
    dto: ConfirmFinanceReconciliationDto,
  ): Promise<FinanceReconciliationRecordResponseDto> {
    const storeId = this.getCurrentStoreIdOrThrow(user);
    const record = await this.prisma.financeReconciliationRecord.findFirst({
      where: {
        id: recordId,
        storeId,
      },
      include: {
        items: {
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        },
      },
    });
    if (!record) {
      throw new NotFoundException('对账单不存在');
    }

    const adjustNote = this.trimOptionalString(dto.adjustNote);
    const updatedRecord = await this.prisma.financeReconciliationRecord.update({
      where: { id: recordId },
      data: {
        status: adjustNote
          ? FinanceReconciliationStatus.adjusted
          : FinanceReconciliationStatus.confirmed,
        adjustNote,
      },
      include: {
        items: {
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        },
      },
    });

    return this.mapReconciliationRecord(updatedRecord);
  }

  async deleteReconciliation(
    user: AuthenticatedUser,
    recordId: number,
  ): Promise<void> {
    const storeId = this.getCurrentStoreIdOrThrow(user);
    const record = await this.prisma.financeReconciliationRecord.findFirst({
      where: {
        id: recordId,
        storeId,
      },
      select: { id: true },
    });
    if (!record) {
      throw new NotFoundException('对账单不存在');
    }
    await this.prisma.financeReconciliationRecord.delete({
      where: { id: recordId },
    });
  }

  private getCurrentStoreIdOrThrow(user: AuthenticatedUser): number {
    const storeId = user.currentMembership?.storeId;
    if (!storeId) {
      throw new ForbiddenException('当前账号暂无门店权限');
    }
    return storeId;
  }

  private resolvePagination(page?: number, pageSize?: number): PaginationState {
    return {
      page: page ?? FINANCE_DEFAULT_PAGE,
      pageSize: pageSize ?? FINANCE_DEFAULT_PAGE_SIZE,
      total: 0,
      totalPages: 0,
    };
  }

  private buildPaginationMeta(
    page: number,
    pageSize: number,
    total: number,
  ): PaginationState {
    return {
      page,
      pageSize,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
    };
  }

  private paginateArray<T>(items: T[], meta: PaginationState): T[] {
    const start = (meta.page - 1) * meta.pageSize;
    return items.slice(start, start + meta.pageSize);
  }

  private toPrismaDecimal(value: number): Prisma.Decimal {
    return new Prisma.Decimal(value.toFixed(2));
  }

  private toMoneyNumber(value: PrismaDecimalLike): number {
    return this.roundMoney(new Decimal(value.toString()));
  }

  private roundMoney(value: PrismaDecimalLike): number {
    return new Decimal(value.toString())
      .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
      .toNumber();
  }

  private addMoney(left: number, right: number): number {
    return this.roundMoney(new Decimal(left).plus(right));
  }

  private subtractMoney(left: number, right: number): number {
    return this.roundMoney(new Decimal(left).minus(right));
  }

  private calcPercent(amount: number, total: number): number {
    if (this.isZero(total)) {
      return 0;
    }
    return new Decimal(amount)
      .div(total)
      .mul(100)
      .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
      .toNumber();
  }

  private isZero(value: number): boolean {
    return new Decimal(value).isZero();
  }

  private trimOptionalString(value?: string | null): string | null {
    if (!value) {
      return null;
    }
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }

  private getDayStart(timestamp: number): number {
    const current = new Date(timestamp);
    current.setHours(0, 0, 0, 0);
    return current.getTime();
  }

  private getDayEnd(timestamp: number): number {
    const current = new Date(timestamp);
    current.setHours(23, 59, 59, 999);
    return current.getTime();
  }

  private formatReportDateLabel(timestamp: number): string {
    const current = new Date(timestamp);
    return `${current.getFullYear()}-${current.getMonth() + 1}-${current.getDate()}`;
  }

  private getOverviewCurrentRange(period: FinanceOverviewPeriodValue): {
    start: number;
    end: number;
  } {
    const now = Date.now();
    const todayStart = this.getDayStart(now);
    const end = todayStart + DAY_MS - 1;
    if (period === 'week') {
      const current = new Date(todayStart);
      const weekDay = current.getDay() === 0 ? 6 : current.getDay() - 1;
      return { start: todayStart - weekDay * DAY_MS, end };
    }
    if (period === 'month') {
      const current = new Date(todayStart);
      return {
        start: new Date(current.getFullYear(), current.getMonth(), 1).getTime(),
        end,
      };
    }
    if (period === 'quarter') {
      const current = new Date(todayStart);
      const quarter = Math.floor(current.getMonth() / 3);
      return {
        start: new Date(current.getFullYear(), quarter * 3, 1).getTime(),
        end,
      };
    }
    return { start: 0, end };
  }

  private getOverviewPreviousRange(
    start: number,
    end: number,
  ): {
    prevStart: number;
    prevEnd: number;
  } {
    const duration = end - start;
    return {
      prevStart: start - duration - 1,
      prevEnd: start - 1,
    };
  }

  private makeOverviewTotals(): FinancePeriodTotals {
    return {
      sales: 0,
      additional: 0,
      cost: 0,
      purchase: 0,
    };
  }

  private mapCashFlowCategoryToOverviewBucket(
    category: string,
  ): FinanceCashFlowOverviewBucket | null {
    return this.getCashFlowCategoryRule(category)?.overviewBucket ?? null;
  }

  private buildOverviewHeroSummary(
    currentTotals: FinancePeriodTotals,
    previousTotals: FinancePeriodTotals,
  ): FinanceOverviewResponseDto['heroSummary'] {
    const currentIncome = this.addMoney(
      currentTotals.sales,
      currentTotals.additional,
    );
    const currentExpense = this.addMoney(
      currentTotals.cost,
      currentTotals.purchase,
    );
    const currentNet = this.subtractMoney(currentIncome, currentExpense);
    const previousIncome = this.addMoney(
      previousTotals.sales,
      previousTotals.additional,
    );
    const previousExpense = this.addMoney(
      previousTotals.cost,
      previousTotals.purchase,
    );
    const previousNet = this.subtractMoney(previousIncome, previousExpense);
    const currentProfitRate = this.calcProfitRate(currentNet, currentIncome);
    const previousProfitRate = this.calcProfitRate(previousNet, previousIncome);

    return {
      netIncome: this.buildCompare(currentNet, previousNet),
      totalIncome: this.buildCompare(currentIncome, previousIncome),
      totalExpense: this.buildCompare(currentExpense, previousExpense),
      profitRate: {
        current: currentProfitRate,
        previous: previousProfitRate,
        changeRate: this.roundMoney(
          new Decimal(currentProfitRate).minus(previousProfitRate),
        ),
      },
      incomeExpenseRatio: this.calcIncomeExpenseRatio(
        currentIncome,
        currentExpense,
      ),
    };
  }

  private buildCompare(current: number, previous: number): FinanceCompareDto {
    return {
      current,
      previous,
      changeRate: this.isZero(previous)
        ? null
        : this.roundMoney(
            new Decimal(current).minus(previous).div(previous).mul(100),
          ),
    };
  }

  private calcProfitRate(net: number, income: number): number {
    if (this.isZero(income)) {
      return 0;
    }
    return this.roundMoney(new Decimal(net).div(income).mul(100));
  }

  private calcIncomeExpenseRatio(
    income: number,
    expense: number,
  ): number | null {
    if (this.isZero(expense)) {
      return null;
    }
    return this.roundMoney(new Decimal(income).div(expense));
  }

  private buildOverviewDailyTrend(
    period: FinanceOverviewPeriodValue,
    end: number,
    incomeMap: Map<number, number>,
    expenseMap: Map<number, number>,
  ): FinanceOverviewResponseDto['dailyTrend'] {
    const days = FINANCE_OVERVIEW_DISPLAY_DAYS[period];
    const items: FinanceOverviewResponseDto['dailyTrend'] = [];
    for (let index = days - 1; index >= 0; index -= 1) {
      const dayStart = this.getDayStart(end - index * DAY_MS);
      const income = incomeMap.get(dayStart) ?? 0;
      const expense = expenseMap.get(dayStart) ?? 0;
      items.push({
        dateLabel: this.formatMonthDay(dayStart),
        income,
        expense,
        net: this.subtractMoney(income, expense),
      });
    }
    return items;
  }

  private formatMonthDay(timestamp: number): string {
    const current = new Date(timestamp);
    const month = String(current.getMonth() + 1).padStart(2, '0');
    const day = String(current.getDate()).padStart(2, '0');
    return `${month}/${day}`;
  }

  private buildOverviewSourceGroups(
    totals: FinancePeriodTotals,
  ): Pick<FinanceOverviewResponseDto, 'incomeGroup' | 'expenseGroup'> {
    const items = (
      Object.keys(OVERVIEW_SOURCE_CONFIG) as FinanceCashFlowOverviewBucket[]
    ).map((key) => ({
      type: key,
      label: OVERVIEW_SOURCE_CONFIG[key].label,
      amount: totals[key],
      direction: OVERVIEW_SOURCE_CONFIG[key].direction,
      color: OVERVIEW_SOURCE_CONFIG[key].color,
      icon: OVERVIEW_SOURCE_CONFIG[key].icon,
    }));
    const incomeItems = items.filter((item) => item.direction === 'income');
    const expenseItems = items.filter((item) => item.direction === 'expense');
    const incomeTotal = incomeItems.reduce(
      (sum, item) => this.addMoney(sum, item.amount),
      0,
    );
    const expenseTotal = expenseItems.reduce(
      (sum, item) => this.addMoney(sum, item.amount),
      0,
    );

    const buildGroup = (
      direction: 'income' | 'expense',
      total: number,
      sourceItems: Array<{
        type: FinanceCashFlowOverviewBucket;
        label: string;
        amount: number;
        direction: 'income' | 'expense';
        color: string;
        icon: string;
      }>,
    ): FinanceSourceGroupDto => ({
      direction,
      total,
      items: sourceItems.map((item) => ({
        ...item,
        percent: this.calcPercent(item.amount, total),
      })),
    });

    return {
      incomeGroup: buildGroup('income', incomeTotal, incomeItems),
      expenseGroup: buildGroup('expense', expenseTotal, expenseItems),
    };
  }

  private getFinanceReportRange(query: FinanceReportQueryDto): FinanceReportRange {
    const period = query.period ?? 'month';
    const now = new Date();
    const nowMs = now.getTime();

    switch (period) {
      case 'today':
        return { start: this.getDayStart(nowMs), end: nowMs, period };
      case 'week':
        return { start: this.getWeekStart(now), end: nowMs, period };
      case 'month':
        return {
          start: new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0).getTime(),
          end: nowMs,
          period,
        };
      case 'quarter':
        return {
          start: new Date(
            now.getFullYear(),
            Math.floor(now.getMonth() / 3) * 3,
            1,
            0,
            0,
            0,
            0,
          ).getTime(),
          end: nowMs,
          period,
        };
      case 'year': {
        const year = query.year ?? now.getFullYear();
        return {
          start: new Date(year, 0, 1, 0, 0, 0, 0).getTime(),
          end: new Date(year, 11, 31, 23, 59, 59, 999).getTime(),
          period,
        };
      }
      case 'custom_month': {
        if (query.customDate === undefined) {
          throw new BadRequestException('自定义单日模式需要传 customDate');
        }
        return {
          start: this.getDayStart(query.customDate),
          end: this.getDayEnd(query.customDate),
          period,
        };
      }
      case 'custom_range': {
        if (
          query.rangeStartDate === undefined ||
          query.rangeEndDate === undefined
        ) {
          throw new BadRequestException(
            '自定义区间模式需要传 rangeStartDate 和 rangeEndDate',
          );
        }
        const start = Math.min(query.rangeStartDate, query.rangeEndDate);
        const end = Math.max(query.rangeStartDate, query.rangeEndDate);
        return {
          start: this.getDayStart(start),
          end: this.getDayEnd(end),
          period,
        };
      }
    }
  }

  private getPreviousFinanceReportRange(
    query: FinanceReportQueryDto,
    currentRange: FinanceReportRange,
  ): { start: number; end: number } | null {
    const period = query.period ?? 'month';

    switch (period) {
      case 'today':
      case 'custom_month':
        return {
          start: this.getDayStart(currentRange.start - DAY_MS),
          end: currentRange.start - 1,
        };
      case 'week':
        return {
          start: currentRange.start - 7 * DAY_MS,
          end: currentRange.start - 1,
        };
      case 'month': {
        const currentStart = new Date(currentRange.start);
        return {
          start: new Date(
            currentStart.getFullYear(),
            currentStart.getMonth() - 1,
            1,
            0,
            0,
            0,
            0,
          ).getTime(),
          end: currentRange.start - 1,
        };
      }
      case 'quarter': {
        const currentStart = new Date(currentRange.start);
        return {
          start: new Date(
            currentStart.getFullYear(),
            currentStart.getMonth() - 3,
            1,
            0,
            0,
            0,
            0,
          ).getTime(),
          end: currentRange.start - 1,
        };
      }
      case 'year': {
        const year = (query.year ?? new Date().getFullYear()) - 1;
        return {
          start: new Date(year, 0, 1, 0, 0, 0, 0).getTime(),
          end: new Date(year, 11, 31, 23, 59, 59, 999).getTime(),
        };
      }
      case 'custom_range': {
        const duration = currentRange.end - currentRange.start;
        return {
          start: currentRange.start - duration - 1,
          end: currentRange.start - 1,
        };
      }
    }
  }

  private buildFinanceReportSummary(
    currentCashFlowRecords: FinanceCashFlowRecordWithAmount[],
    previousCashFlowRecords: FinanceCashFlowRecordWithAmount[],
    accountRecords: FinanceAccountRecordWithAmount[],
  ): FinanceReportResponseDto['summary'] {
    let totalIncome = 0;
    let totalExpense = 0;
    let previousIncome = 0;
    let previousExpense = 0;
    let receivableTotal = 0;
    let payableTotal = 0;

    for (const record of currentCashFlowRecords) {
      const amount = this.toMoneyNumber(record.amount);
      if (record.direction === 'income') {
        totalIncome = this.addMoney(totalIncome, amount);
      } else {
        totalExpense = this.addMoney(totalExpense, amount);
      }
    }

    for (const record of previousCashFlowRecords) {
      const amount = this.toMoneyNumber(record.amount);
      if (record.direction === 'income') {
        previousIncome = this.addMoney(previousIncome, amount);
      } else {
        previousExpense = this.addMoney(previousExpense, amount);
      }
    }

    for (const record of accountRecords.map((item) =>
      this.withDerivedAccountFields(item),
    )) {
      if (record.status === FinanceAccountStatus.settled) {
        continue;
      }
      const remaining = this.toMoneyNumber(record.remaining);
      if (record.type === 'receivable') {
        receivableTotal = this.addMoney(receivableTotal, remaining);
      } else {
        payableTotal = this.addMoney(payableTotal, remaining);
      }
    }

    const netCashFlow = this.subtractMoney(totalIncome, totalExpense);
    const previousNetCashFlow = this.subtractMoney(previousIncome, previousExpense);

    return {
      totalIncome,
      totalExpense,
      netCashFlow,
      recordCount: currentCashFlowRecords.length,
      receivableTotal,
      payableTotal,
      compareLastPeriod: this.isZero(previousNetCashFlow)
        ? null
        : this.roundMoney(
            new Decimal(netCashFlow)
              .minus(previousNetCashFlow)
              .div(new Decimal(previousNetCashFlow).abs())
              .mul(100),
          ),
    };
  }

  private buildFinanceReportCashFlowRows(
    records: FinanceCashFlowRecordWithAmount[],
  ): FinanceReportCashFlowRowDto[] {
    return records.map((record) => ({
      id: String(record.id),
      dateLabel: this.formatReportDateLabel(record.date.getTime()),
      title: record.title,
      direction: record.direction,
      categoryLabel:
        CASH_FLOW_CATEGORY_RULES[record.category as keyof typeof CASH_FLOW_CATEGORY_RULES]
          ?.label ?? record.category,
      amount: this.toMoneyNumber(record.amount),
      paymentLabel:
        FINANCE_REPORT_PAYMENT_LABELS[record.payment] ?? record.payment,
    }));
  }

  private buildFinanceReportAccountRows(
    records: FinanceAccountRecordWithAmount[],
  ): FinanceReportAccountRowDto[] {
    return records
      .map((record) => this.withDerivedAccountFields(record))
      .filter((record) => record.status !== FinanceAccountStatus.settled)
      .sort(
        (left, right) =>
          right.createdAt.getTime() - left.createdAt.getTime() || right.id - left.id,
      )
      .map((record) => ({
        id: String(record.id),
        type: record.type,
        typeLabel:
          FINANCE_REPORT_ACCOUNT_TYPE_LABELS[record.type] ?? record.type,
        counterpart: record.counterpart,
        amount: this.toMoneyNumber(record.amount),
        remaining: this.toMoneyNumber(record.remaining),
        statusLabel:
          FINANCE_REPORT_ACCOUNT_STATUS_LABELS[record.status] ?? record.status,
        statusKey: record.status,
        dateLabel: this.formatReportDateLabel(record.date.getTime()),
      }));
  }

  private getCashFlowFilterRange(
    query: ListFinanceCashFlowRecordsQueryDto,
  ): FinanceCashFlowFilterRange {
    const period = query.period ?? 'month';
    const now = new Date();
    const nowMs = now.getTime();
    if (period === 'custom_range') {
      const start = new Date(
        query.customRangeStartYear ?? now.getFullYear(),
        (query.customRangeStartMonth ?? now.getMonth() + 1) - 1,
        query.customRangeStartDay ?? 1,
        0,
        0,
        0,
        0,
      ).getTime();
      const end = new Date(
        query.customRangeEndYear ?? now.getFullYear(),
        (query.customRangeEndMonth ?? now.getMonth() + 1) - 1,
        query.customRangeEndDay ?? now.getDate(),
        23,
        59,
        59,
        999,
      ).getTime();
      return {
        start,
        end: Math.max(start, end),
        period,
      };
    }
    if (period === 'custom_day') {
      const year = query.customDayYear ?? now.getFullYear();
      const month = query.customDayMonth ?? now.getMonth() + 1;
      const day = query.customDayDay ?? now.getDate();
      return {
        start: new Date(year, month - 1, day, 0, 0, 0, 0).getTime(),
        end: new Date(year, month - 1, day, 23, 59, 59, 999).getTime(),
        period,
      };
    }
    if (period === 'today') {
      return { start: this.getDayStart(nowMs), end: nowMs, period };
    }
    if (period === 'week') {
      return { start: this.getWeekStart(now), end: nowMs, period };
    }
    if (period === 'month') {
      return {
        start: new Date(now.getFullYear(), now.getMonth(), 1).getTime(),
        end: nowMs,
        period,
      };
    }
    return {
      start: new Date(
        now.getFullYear(),
        Math.floor(now.getMonth() / 3) * 3,
        1,
      ).getTime(),
      end: nowMs,
      period,
    };
  }

  private getWeekStart(current: Date): number {
    const day = current.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    const monday = new Date(current);
    monday.setDate(current.getDate() + diff);
    monday.setHours(0, 0, 0, 0);
    return monday.getTime();
  }

  private getPreviousCashFlowRange(
    period: FinanceCashFlowFilterRange['period'],
  ): { start: number; end: number } | null {
    const now = new Date();
    if (period === 'custom_day' || period === 'custom_range') {
      return null;
    }
    if (period === 'today') {
      const yesterday = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() - 1,
      );
      return {
        start: this.getDayStart(yesterday.getTime()),
        end: new Date(
          yesterday.getFullYear(),
          yesterday.getMonth(),
          yesterday.getDate(),
          23,
          59,
          59,
          999,
        ).getTime(),
      };
    }
    if (period === 'week') {
      const weekStart = this.getWeekStart(now);
      return {
        start: weekStart - 7 * DAY_MS,
        end: weekStart - 1,
      };
    }
    if (period === 'month') {
      return {
        start: new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime(),
        end: new Date(
          now.getFullYear(),
          now.getMonth(),
          0,
          23,
          59,
          59,
          999,
        ).getTime(),
      };
    }
    const currentQuarterStart = new Date(
      now.getFullYear(),
      Math.floor(now.getMonth() / 3) * 3,
      1,
    ).getTime();
    return {
      start: new Date(
        now.getFullYear(),
        (Math.floor(now.getMonth() / 3) - 1) * 3,
        1,
      ).getTime(),
      end: currentQuarterStart - 1,
    };
  }

  private buildCashFlowBaseStats(
    records: FinanceCashFlowStatsRow[],
  ): FinanceCashFlowStatsDto {
    let totalIncome = 0;
    let totalExpense = 0;
    for (const record of records) {
      const amount = this.toMoneyNumber(record.amount);
      if (record.direction === 'income') {
        totalIncome = this.addMoney(totalIncome, amount);
      } else {
        totalExpense = this.addMoney(totalExpense, amount);
      }
    }
    return {
      totalIncome,
      totalExpense,
      netFlow: this.subtractMoney(totalIncome, totalExpense),
      recordCount: records.length,
      compareLastPeriod: null,
    };
  }

  private assertCashFlowCategoryCanCreateManually(category: string): void {
    const rule = this.getCashFlowCategoryRule(category);
    if (rule && !rule.allowManualCreate) {
      throw new ConflictException(
        rule.manualCreateError ?? `${rule.label}流水不允许手工录入`,
      );
    }
  }

  private assertCashFlowDirectionMatchesCategory(
    direction: string,
    category: string,
  ): void {
    const rule = this.getCashFlowCategoryRule(category);
    if (rule && direction !== rule.direction) {
      throw new ConflictException('流水方向与分类口径不一致');
    }
  }

  private getCashFlowCategoryRule(
    category: string,
  ): FinanceCashFlowCategoryRule | null {
    if (!(category in CASH_FLOW_CATEGORY_RULES)) {
      return null;
    }

    return CASH_FLOW_CATEGORY_RULES[
      category as keyof typeof CASH_FLOW_CATEGORY_RULES
    ];
  }

  private assertAccountCategoryCanCreateManually(category: string): void {
    const rule = this.getAccountCategoryRule(category);
    if (rule && !rule.allowManualCreate) {
      throw new ConflictException(
        rule.manualCreateError ?? `${rule.label}账款不允许手工录入`,
      );
    }
  }

  private assertAccountTypeMatchesCategory(
    type: string,
    category: string,
  ): void {
    const rule = this.getAccountCategoryRule(category);
    if (rule && !rule.allowedTypes.includes(type as 'receivable' | 'payable')) {
      throw new ConflictException('账款类型与分类口径不一致');
    }
  }

  private getAccountCategoryRule(
    category: string,
  ): FinanceAccountCategoryRule | null {
    if (!(category in ACCOUNT_CATEGORY_RULES)) {
      return null;
    }

    return ACCOUNT_CATEGORY_RULES[
      category as keyof typeof ACCOUNT_CATEGORY_RULES
    ];
  }

  private mapCashFlowRecord(
    record: FinanceCashFlowRecordWithAmount,
  ): FinanceCashFlowRecordResponseDto {
    return {
      id: String(record.id),
      direction:
        record.direction as FinanceCashFlowRecordResponseDto['direction'],
      category: record.category as FinanceCashFlowRecordResponseDto['category'],
      title: record.title,
      amount: this.toMoneyNumber(record.amount),
      payment: record.payment as FinanceCashFlowRecordResponseDto['payment'],
      ...(record.note ? { note: record.note } : {}),
      date: record.date.getTime(),
      createdAt: record.createdAt.getTime(),
    };
  }

  private async ensureCashFlowRecordExists(
    storeId: number,
    recordId: number,
  ): Promise<{ id: number; saleOrderId: number | null }> {
    const record = await this.prisma.financeCashFlowRecord.findFirst({
      where: {
        id: recordId,
        storeId,
      },
      select: {
        id: true,
        saleOrderId: true,
      },
    });
    if (!record) {
      throw new NotFoundException('现金流水记录不存在');
    }
    return record;
  }

  private filterAndSortAccounts(
    records: FinanceAccountRecordWithAmount[],
    query: ListFinanceAccountsQueryDto,
  ): FinanceAccountRecordWithAmount[] {
    const typeFilter = query.typeFilter ?? 'all';
    const statusFilter = query.statusFilter ?? 'all';
    const searchText = (query.searchText ?? '').trim().toLowerCase();

    return records
      .map((record) => this.withDerivedAccountFields(record))
      .filter((record) => {
        if (typeFilter !== 'all' && record.type !== typeFilter) {
          return false;
        }
        if (statusFilter !== 'all' && record.status !== statusFilter) {
          return false;
        }
        if (searchText === '') {
          return true;
        }
        const searchKey = `${record.counterpart} ${record.note ?? ''}`
          .toLowerCase()
          .trim();
        return searchKey.includes(searchText);
      })
      .sort((left, right) => {
        const statusDiff =
          ACCOUNT_STATUS_ORDER[left.status] -
          ACCOUNT_STATUS_ORDER[right.status];
        if (statusDiff !== 0) {
          return statusDiff;
        }
        return right.updatedAt.getTime() - left.updatedAt.getTime();
      });
  }

  private withDerivedAccountFields(
    record: FinanceAccountRecordWithAmount,
  ): FinanceAccountRecordWithAmount {
    const amount = this.toMoneyNumber(record.amount);
    const paidAmount = this.toMoneyNumber(record.paidAmount);
    const derived = this.deriveAccountFields(
      amount,
      paidAmount,
      record.dueDate?.getTime() ?? undefined,
    );
    return {
      ...record,
      remaining: this.toPrismaDecimal(derived.remaining),
      status: derived.status,
    };
  }

  private deriveAccountFields(
    amount: number,
    paidAmount: number,
    dueDate?: number,
  ): { remaining: number; status: FinanceAccountStatus } {
    const remaining = this.roundMoney(new Decimal(amount).minus(paidAmount));
    if (remaining <= 0) {
      return { remaining, status: FinanceAccountStatus.settled };
    }
    if (paidAmount > 0) {
      return { remaining, status: FinanceAccountStatus.partial };
    }
    if (dueDate && dueDate < Date.now()) {
      return { remaining, status: FinanceAccountStatus.overdue };
    }
    return { remaining, status: FinanceAccountStatus.pending };
  }

  private mapAccountRecord(
    record: FinanceAccountRecordWithAmount,
  ): FinanceAccountRecordResponseDto {
    const amount = this.toMoneyNumber(record.amount);
    const paidAmount = this.toMoneyNumber(record.paidAmount);
    const derived = this.deriveAccountFields(
      amount,
      paidAmount,
      record.dueDate?.getTime() ?? undefined,
    );

    return {
      id: String(record.id),
      type: record.type as FinanceAccountRecordResponseDto['type'],
      category: record.category as FinanceAccountRecordResponseDto['category'],
      counterpart: record.counterpart,
      amount,
      paidAmount,
      remaining: derived.remaining,
      status: derived.status,
      ...(record.dueDate ? { dueDate: record.dueDate.getTime() } : {}),
      date: record.date.getTime(),
      ...(record.note ? { note: record.note } : {}),
      createdAt: record.createdAt.getTime(),
      updatedAt: record.updatedAt.getTime(),
    };
  }

  private buildAccountsStats(
    records: FinanceAccountRecordWithAmount[],
  ): FinanceAccountsStatsDto {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    let totalReceivable = 0;
    let totalPayable = 0;
    let overdueCount = 0;

    for (const record of records.map((item) =>
      this.withDerivedAccountFields(item),
    )) {
      if (record.status !== FinanceAccountStatus.settled) {
        const remaining = this.toMoneyNumber(record.remaining);
        if (record.type === 'receivable') {
          totalReceivable = this.addMoney(totalReceivable, remaining);
        } else {
          totalPayable = this.addMoney(totalPayable, remaining);
        }
        if (record.status === FinanceAccountStatus.overdue) {
          overdueCount += 1;
        }
      }
    }

    return {
      totalReceivable,
      totalPayable,
      netReceivable: this.subtractMoney(totalReceivable, totalPayable),
      overdueCount,
      newThisMonth: records.filter(
        (record) => record.createdAt.getTime() >= monthStart.getTime(),
      ).length,
    };
  }

  private filterReconciliations(
    records: FinanceReconciliationRecordWithItems[],
    query: ListFinanceReconciliationsQueryDto,
  ): FinanceReconciliationRecordWithItems[] {
    const statusFilter = query.statusFilter ?? 'all';
    const typeFilter = query.typeFilter ?? 'all';
    const searchText = (query.searchText ?? '').trim().toLowerCase();
    return records.filter((record) => {
      if (statusFilter !== 'all' && record.status !== statusFilter) {
        return false;
      }
      if (typeFilter !== 'all' && record.type !== typeFilter) {
        return false;
      }
      if (searchText === '') {
        return true;
      }
      const searchIndex =
        `${record.title} ${record.counterpart ?? ''} ${record.note ?? ''}`
          .toLowerCase()
          .trim();
      return searchIndex.includes(searchText);
    });
  }

  private buildReconciliationStats(
    records: FinanceReconciliationRecordWithItems[],
  ): FinanceReconciliationStatsDto {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    let confirmedCount = 0;
    let discrepancyCount = 0;
    let adjustedCount = 0;
    let draftCount = 0;
    let totalDiffAmount = 0;

    for (const record of records) {
      switch (record.status) {
        case 'confirmed':
          confirmedCount += 1;
          break;
        case 'discrepancy':
          discrepancyCount += 1;
          break;
        case 'adjusted':
          adjustedCount += 1;
          break;
        case 'draft':
          draftCount += 1;
          break;
      }
      totalDiffAmount = this.addMoney(
        totalDiffAmount,
        new Decimal(this.toMoneyNumber(record.diffAmount)).abs().toNumber(),
      );
    }

    return {
      totalCount: records.length,
      confirmedCount,
      discrepancyCount,
      adjustedCount,
      draftCount,
      totalDiffAmount,
      newThisMonth: records.filter(
        (record) => record.createdAt.getTime() >= monthStart.getTime(),
      ).length,
    };
  }

  private normalizeCreateReconciliationStatus(
    requestedStatus: CreateFinanceReconciliationDto['status'],
    actualIncome: number,
    actualExpense: number,
    diffAmount: number,
  ): FinanceReconciliationStatus {
    if (
      requestedStatus === 'draft' &&
      actualIncome === 0 &&
      actualExpense === 0
    ) {
      return FinanceReconciliationStatus.draft;
    }
    return this.isZero(diffAmount)
      ? FinanceReconciliationStatus.confirmed
      : FinanceReconciliationStatus.discrepancy;
  }

  private buildReconciliationItemCreateInput(
    item: FinanceReconciliationItemInputDto,
  ): Prisma.FinanceReconciliationItemCreateWithoutReconciliationInput {
    const bookAmount = this.roundMoney(item.bookAmount);
    const actualAmount = this.roundMoney(item.actualAmount);
    return {
      description: item.description.trim(),
      bookAmount: this.toPrismaDecimal(bookAmount),
      actualAmount: this.toPrismaDecimal(actualAmount),
      difference: this.toPrismaDecimal(
        this.roundMoney(new Decimal(actualAmount).minus(bookAmount)),
      ),
      note: this.trimOptionalString(item.note),
    };
  }

  private mapReconciliationRecord(
    record: FinanceReconciliationRecordWithItems,
  ): FinanceReconciliationRecordResponseDto {
    return {
      id: String(record.id),
      title: record.title,
      type: record.type,
      status: record.status,
      ...(record.channel
        ? {
            channel: record.channel,
          }
        : {}),
      ...(record.counterpart ? { counterpart: record.counterpart } : {}),
      periodStart: record.periodStart.getTime(),
      periodEnd: record.periodEnd.getTime(),
      bookIncome: this.toMoneyNumber(record.bookIncome),
      bookExpense: this.toMoneyNumber(record.bookExpense),
      bookNet: this.toMoneyNumber(record.bookNet),
      actualIncome: this.toMoneyNumber(record.actualIncome),
      actualExpense: this.toMoneyNumber(record.actualExpense),
      actualNet: this.toMoneyNumber(record.actualNet),
      diffAmount: this.toMoneyNumber(record.diffAmount),
      items: record.items.map((item) => ({
        id: String(item.id),
        description: item.description,
        bookAmount: this.toMoneyNumber(item.bookAmount),
        actualAmount: this.toMoneyNumber(item.actualAmount),
        difference: this.toMoneyNumber(item.difference),
        ...(item.note ? { note: item.note } : {}),
      })),
      ...(record.adjustNote ? { adjustNote: record.adjustNote } : {}),
      ...(record.operator ? { operator: record.operator } : {}),
      ...(record.note ? { note: record.note } : {}),
      date: record.date.getTime(),
      createdAt: record.createdAt.getTime(),
      updatedAt: record.updatedAt.getTime(),
    };
  }
}

import {
  ForbiddenException,
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { PermissionsGuard } from '../src/purely-profit/access-control/guards/permissions.guard';
import { JwtAuthGuard } from '../src/purely-profit/auth/guards/jwt-auth.guard';
import { FinanceController } from '../src/purely-profit/finance/finance.controller';
import { FinanceService } from '../src/purely-profit/finance/finance.service';

describe('FinanceController (e2e)', () => {
  let app: INestApplication<App>;

  type GuardRequest = {
    headers?: Record<string, string | string[] | undefined>;
    user?: unknown;
  };

  const authHeaders = {
    Authorization: 'Bearer valid-token',
    'x-permissions': 'finance:view',
  };

  const financeService = {
    getOverview: jest.fn(),
    listCashFlowRecords: jest.fn(),
    getCashFlowStats: jest.fn(),
    createCashFlowRecord: jest.fn(),
    deleteCashFlowRecord: jest.fn(),
    listAccounts: jest.fn(),
    getAccountsStats: jest.fn(),
    createAccount: jest.fn(),
    settleAccount: jest.fn(),
    deleteAccount: jest.fn(),
    listReconciliations: jest.fn(),
    getReconciliationStats: jest.fn(),
    createReconciliation: jest.fn(),
    confirmReconciliation: jest.fn(),
    deleteReconciliation: jest.fn(),
  };

  const authGuard = {
    canActivate: (context: {
      switchToHttp: () => { getRequest: () => GuardRequest };
    }): boolean => {
      const request = context.switchToHttp().getRequest();
      const authorization = request.headers?.authorization;
      if (authorization !== 'Bearer valid-token') {
        throw new UnauthorizedException('未登录');
      }
      request.user = {
        id: 1,
        email: 'boss@example.com',
        phone: '13800138000',
        name: '老板',
        createdAt: new Date('2026-05-12T00:00:00.000Z'),
        updatedAt: new Date('2026-05-13T00:00:00.000Z'),
        lastActiveAt: null,
        currentMembership: {
          staffId: 8,
          storeId: 18,
          role: 'OWNER',
          permissions: ['finance:view'],
          isActive: true,
          subjectType: 'owner',
          linkedEmployeeId: null,
          subAccountId: null,
          subAccountRole: null,
          subAccountStatus: null,
          subAccountAssigned: false,
          canAccessHome: true,
          canUseHandover: true,
        },
      };
      return true;
    },
  };

  const permissionsGuard = {
    canActivate: (context: {
      switchToHttp: () => { getRequest: () => GuardRequest };
    }): boolean => {
      const request = context.switchToHttp().getRequest();
      const rawPermissions = request.headers?.['x-permissions'];
      const permissionText = Array.isArray(rawPermissions)
        ? rawPermissions.join(',')
        : typeof rawPermissions === 'string'
          ? rawPermissions
          : '';
      const permissions = permissionText
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
      if (!permissions.includes('finance:view') && !permissions.includes('*')) {
        throw new ForbiddenException('当前账号缺少接口访问权限');
      }
      return true;
    },
  };

  beforeAll(async () => {
    const moduleBuilder = Test.createTestingModule({
      controllers: [FinanceController],
      providers: [{ provide: FinanceService, useValue: financeService }],
    });
    moduleBuilder.overrideGuard(JwtAuthGuard).useValue(authGuard);
    moduleBuilder.overrideGuard(PermissionsGuard).useValue(permissionsGuard);
    const moduleFixture: TestingModule = await moduleBuilder.compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /finance/overview 未登录时返回 401', async () => {
    await request(app.getHttpServer()).get('/finance/overview').expect(401);
  });

  it('GET /finance/overview 缺少 finance:view 权限时返回 403', async () => {
    await request(app.getHttpServer())
      .get('/finance/overview')
      .set('Authorization', 'Bearer valid-token')
      .set('x-permissions', 'members:view')
      .expect(403);
  });

  it('GET /finance/overview period 非法时返回 400', async () => {
    await request(app.getHttpServer())
      .get('/finance/overview?period=yearly')
      .set(authHeaders)
      .expect(400);
  });

  it('GET /finance/overview 返回财务总览结构并透传 query', async () => {
    financeService.getOverview.mockResolvedValue({
      heroSummary: {
        netIncome: { current: 800, previous: 400, changeRate: 100 },
        totalIncome: { current: 1200, previous: 500, changeRate: 140 },
        totalExpense: { current: 400, previous: 100, changeRate: 300 },
        profitRate: { current: 66.67, previous: 80, changeRate: -13.33 },
        incomeExpenseRatio: 3,
      },
      dailyTrend: [{ dateLabel: '05/14', income: 320, expense: 100, net: 220 }],
      incomeGroup: { direction: 'income', total: 1200, items: [] },
      expenseGroup: { direction: 'expense', total: 400, items: [] },
    });

    await request(app.getHttpServer())
      .get('/finance/overview?period=quarter')
      .set(authHeaders)
      .expect(200)
      .expect(({ body }) => {
        expect(body.heroSummary.netIncome.current).toBe(800);
        expect(body.dailyTrend[0]).toEqual({
          dateLabel: '05/14',
          income: 320,
          expense: 100,
          net: 220,
        });
      });

    expect(financeService.getOverview).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      { period: 'quarter' },
    );
  });

  it('GET /finance/cash-flow/records 会转换自定义区间与分页查询参数', async () => {
    financeService.listCashFlowRecords.mockResolvedValue({
      items: [
        {
          id: '1',
          direction: 'income',
          category: 'sales',
          title: '午市营业额',
          amount: 128.5,
          payment: 'cash',
          date: 1747180800000,
          createdAt: 1747184400000,
        },
      ],
      meta: { page: 2, pageSize: 5, total: 8, totalPages: 2 },
    });

    await request(app.getHttpServer())
      .get(
        '/finance/cash-flow/records?period=custom_range&directionFilter=income&page=2&pageSize=5&customRangeStartYear=2026&customRangeStartMonth=5&customRangeStartDay=1&customRangeEndYear=2026&customRangeEndMonth=5&customRangeEndDay=14',
      )
      .set(authHeaders)
      .expect(200)
      .expect(({ body }) => {
        expect(body.meta).toEqual({
          page: 2,
          pageSize: 5,
          total: 8,
          totalPages: 2,
        });
        expect(body.items[0].title).toBe('午市营业额');
      });

    expect(financeService.listCashFlowRecords).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      {
        period: 'custom_range',
        directionFilter: 'income',
        page: 2,
        pageSize: 5,
        customRangeStartYear: 2026,
        customRangeStartMonth: 5,
        customRangeStartDay: 1,
        customRangeEndYear: 2026,
        customRangeEndMonth: 5,
        customRangeEndDay: 14,
      },
    );
  });

  it('GET /finance/cash-flow/stats 返回统计并透传 custom_day 查询', async () => {
    financeService.getCashFlowStats.mockResolvedValue({
      totalIncome: 500,
      totalExpense: 120,
      netFlow: 380,
      recordCount: 6,
      compareLastPeriod: 15.8,
    });

    await request(app.getHttpServer())
      .get(
        '/finance/cash-flow/stats?period=custom_day&customDayYear=2026&customDayMonth=5&customDayDay=14&directionFilter=all',
      )
      .set(authHeaders)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual({
          totalIncome: 500,
          totalExpense: 120,
          netFlow: 380,
          recordCount: 6,
          compareLastPeriod: 15.8,
        });
      });

    expect(financeService.getCashFlowStats).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      {
        period: 'custom_day',
        customDayYear: 2026,
        customDayMonth: 5,
        customDayDay: 14,
        directionFilter: 'all',
      },
    );
  });

  it('POST /finance/cash-flow/records 在参数非法时返回 400', async () => {
    await request(app.getHttpServer())
      .post('/finance/cash-flow/records')
      .set(authHeaders)
      .send({
        direction: 'income',
        category: 'sales',
        title: '非法金额',
        amount: 0,
        payment: 'cash',
        date: 1747180800000,
      })
      .expect(400);
  });

  it('POST /finance/cash-flow/records 返回创建后的流水记录', async () => {
    financeService.createCashFlowRecord.mockResolvedValue({
      id: '1',
      direction: 'income',
      category: 'sales',
      title: '午市营业额',
      amount: 128.5,
      payment: 'cash',
      note: '手动补录',
      date: 1747180800000,
      createdAt: 1747184400000,
    });

    await request(app.getHttpServer())
      .post('/finance/cash-flow/records')
      .set(authHeaders)
      .send({
        direction: 'income',
        category: 'sales',
        title: '午市营业额',
        amount: 128.5,
        payment: 'cash',
        note: '手动补录',
        date: 1747180800000,
      })
      .expect(201)
      .expect(({ body }) => {
        expect(body).toEqual({
          id: '1',
          direction: 'income',
          category: 'sales',
          title: '午市营业额',
          amount: 128.5,
          payment: 'cash',
          note: '手动补录',
          date: 1747180800000,
          createdAt: 1747184400000,
        });
      });

    expect(financeService.createCashFlowRecord).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      expect.objectContaining({ amount: 128.5, title: '午市营业额' }),
    );
  });

  it('DELETE /finance/cash-flow/records/:id 删除成功返回 204', async () => {
    financeService.deleteCashFlowRecord.mockResolvedValue(undefined);

    await request(app.getHttpServer())
      .delete('/finance/cash-flow/records/7')
      .set(authHeaders)
      .expect(204);

    expect(financeService.deleteCashFlowRecord).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      7,
    );
  });

  it('GET /finance/accounts 会转换筛选与分页参数', async () => {
    financeService.listAccounts.mockResolvedValue({
      items: [
        {
          id: '2',
          type: 'receivable',
          category: 'sales_credit',
          counterpart: '张三水果店',
          amount: 5000,
          paidAmount: 1500,
          remaining: 3500,
          status: 'partial',
          date: 1747180800000,
          createdAt: 1747184400000,
          updatedAt: 1747188000000,
        },
      ],
      meta: { page: 3, pageSize: 15, total: 21, totalPages: 2 },
    });

    await request(app.getHttpServer())
      .get(
        '/finance/accounts?typeFilter=receivable&statusFilter=partial&searchText=%E6%B0%B4%E6%9E%9C&page=3&pageSize=15',
      )
      .set(authHeaders)
      .expect(200)
      .expect(({ body }) => {
        expect(body.meta.page).toBe(3);
        expect(body.items[0].counterpart).toBe('张三水果店');
      });

    expect(financeService.listAccounts).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      {
        typeFilter: 'receivable',
        statusFilter: 'partial',
        searchText: '水果',
        page: 3,
        pageSize: 15,
      },
    );
  });

  it('GET /finance/accounts/stats 返回账款统计结构', async () => {
    financeService.getAccountsStats.mockResolvedValue({
      totalReceivable: 4000,
      totalPayable: 1500,
      netReceivable: 2500,
      overdueCount: 1,
      newThisMonth: 3,
    });

    await request(app.getHttpServer())
      .get('/finance/accounts/stats')
      .set(authHeaders)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual({
          totalReceivable: 4000,
          totalPayable: 1500,
          netReceivable: 2500,
          overdueCount: 1,
          newThisMonth: 3,
        });
      });

    expect(financeService.getAccountsStats).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
    );
  });

  it('POST /finance/accounts 过滤非法字段并返回新建账款', async () => {
    financeService.createAccount.mockResolvedValue({
      id: '2',
      type: 'receivable',
      category: 'sales_credit',
      counterpart: '张三水果店',
      amount: 5000,
      paidAmount: 1000,
      remaining: 4000,
      status: 'partial',
      dueDate: 1747267200000,
      note: '月底前结清',
      date: 1747180800000,
      createdAt: 1747184400000,
      updatedAt: 1747188000000,
    });

    await request(app.getHttpServer())
      .post('/finance/accounts')
      .set(authHeaders)
      .send({
        type: 'receivable',
        category: 'sales_credit',
        counterpart: '张三水果店',
        amount: 5000,
        paidAmount: 1000,
        dueDate: 1747267200000,
        date: 1747180800000,
        note: '月底前结清',
      })
      .expect(201)
      .expect(({ body }) => {
        expect(body.remaining).toBe(4000);
        expect(body.status).toBe('partial');
      });

    expect(financeService.createAccount).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      {
        type: 'receivable',
        category: 'sales_credit',
        counterpart: '张三水果店',
        amount: 5000,
        paidAmount: 1000,
        dueDate: 1747267200000,
        date: 1747180800000,
        note: '月底前结清',
      },
    );
  });

  it('PATCH /finance/accounts/:id/settle 返回结算后的账款记录', async () => {
    financeService.settleAccount.mockResolvedValue({
      id: '2',
      type: 'receivable',
      category: 'sales_credit',
      counterpart: '张三水果店',
      amount: 5000,
      paidAmount: 1500,
      remaining: 3500,
      status: 'partial',
      date: 1747180800000,
      createdAt: 1747184400000,
      updatedAt: 1747188000000,
    });

    await request(app.getHttpServer())
      .patch('/finance/accounts/2/settle')
      .set(authHeaders)
      .send({ payAmount: 500 })
      .expect(200)
      .expect(({ body }) => {
        expect(body.remaining).toBe(3500);
        expect(body.status).toBe('partial');
      });

    expect(financeService.settleAccount).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      2,
      { payAmount: 500 },
    );
  });

  it('DELETE /finance/accounts/:id 删除成功返回 204', async () => {
    financeService.deleteAccount.mockResolvedValue(undefined);

    await request(app.getHttpServer())
      .delete('/finance/accounts/6')
      .set(authHeaders)
      .expect(204);

    expect(financeService.deleteAccount).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      6,
    );
  });

  it('GET /finance/reconciliation 会按 DTO 规则转换分页与筛选参数', async () => {
    financeService.listReconciliations.mockResolvedValue({
      items: [
        {
          id: '3',
          title: '5月月度对账',
          type: 'monthly',
          status: 'draft',
          periodStart: 1746057600000,
          periodEnd: 1748735999999,
          bookIncome: 12000,
          bookExpense: 8000,
          bookNet: 4000,
          actualIncome: 0,
          actualExpense: 0,
          actualNet: 0,
          diffAmount: -4000,
          items: [],
          date: 1747180800000,
          createdAt: 1747184400000,
          updatedAt: 1747188000000,
        },
      ],
      meta: { page: 2, pageSize: 10, total: 11, totalPages: 2 },
    });

    await request(app.getHttpServer())
      .get(
        '/finance/reconciliation?statusFilter=draft&typeFilter=monthly&searchText=%E5%AF%B9%E8%B4%A6&page=2&pageSize=10',
      )
      .set(authHeaders)
      .expect(200)
      .expect(({ body }) => {
        expect(body.meta).toEqual({
          page: 2,
          pageSize: 10,
          total: 11,
          totalPages: 2,
        });
        expect(body.items[0].status).toBe('draft');
      });

    expect(financeService.listReconciliations).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      {
        statusFilter: 'draft',
        typeFilter: 'monthly',
        searchText: '对账',
        page: 2,
        pageSize: 10,
      },
    );
  });

  it('GET /finance/reconciliation/stats 返回对账统计结构', async () => {
    financeService.getReconciliationStats.mockResolvedValue({
      totalCount: 12,
      confirmedCount: 8,
      discrepancyCount: 2,
      adjustedCount: 1,
      draftCount: 1,
      totalDiffAmount: 300,
      newThisMonth: 4,
    });

    await request(app.getHttpServer())
      .get('/finance/reconciliation/stats')
      .set(authHeaders)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual({
          totalCount: 12,
          confirmedCount: 8,
          discrepancyCount: 2,
          adjustedCount: 1,
          draftCount: 1,
          totalDiffAmount: 300,
          newThisMonth: 4,
        });
      });

    expect(financeService.getReconciliationStats).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
    );
  });

  it('POST /finance/reconciliation 差异明细字段非法时返回 400', async () => {
    await request(app.getHttpServer())
      .post('/finance/reconciliation')
      .set(authHeaders)
      .send({
        title: '5月月度对账',
        type: 'monthly',
        status: 'discrepancy',
        periodStart: 1746057600000,
        periodEnd: 1748735999999,
        bookIncome: 12000,
        bookExpense: 8000,
        actualIncome: 11800,
        actualExpense: 8100,
        items: [{ description: 123, bookAmount: 100, actualAmount: 98 }],
        date: 1747180800000,
      })
      .expect(400);
  });

  it('POST /finance/reconciliation 返回新建对账单', async () => {
    financeService.createReconciliation.mockResolvedValue({
      id: '3',
      title: '5月月度对账',
      type: 'monthly',
      status: 'discrepancy',
      channel: 'wechat',
      counterpart: '微信商户号',
      periodStart: 1746057600000,
      periodEnd: 1748735999999,
      bookIncome: 12000,
      bookExpense: 8000,
      bookNet: 4000,
      actualIncome: 11800,
      actualExpense: 8100,
      actualNet: 3700,
      diffAmount: -300,
      items: [
        {
          description: '微信手续费差异',
          bookAmount: 100,
          actualAmount: 98,
          diffAmount: -2,
          note: '平台扣费',
        },
      ],
      operator: '财务张姐',
      note: '节假日汇总',
      date: 1747180800000,
      createdAt: 1747184400000,
      updatedAt: 1747188000000,
    });

    await request(app.getHttpServer())
      .post('/finance/reconciliation')
      .set(authHeaders)
      .send({
        title: '5月月度对账',
        type: 'monthly',
        status: 'discrepancy',
        channel: 'wechat',
        counterpart: '微信商户号',
        periodStart: 1746057600000,
        periodEnd: 1748735999999,
        bookIncome: 12000,
        bookExpense: 8000,
        actualIncome: 11800,
        actualExpense: 8100,
        items: [
          {
            description: '微信手续费差异',
            bookAmount: 100,
            actualAmount: 98,
            note: '平台扣费',
          },
        ],
        operator: '财务张姐',
        note: '节假日汇总',
        date: 1747180800000,
      })
      .expect(201)
      .expect(({ body }) => {
        expect(body.status).toBe('discrepancy');
        expect(body.items[0].diffAmount).toBe(-2);
      });

    expect(financeService.createReconciliation).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      {
        title: '5月月度对账',
        type: 'monthly',
        status: 'discrepancy',
        channel: 'wechat',
        counterpart: '微信商户号',
        periodStart: 1746057600000,
        periodEnd: 1748735999999,
        bookIncome: 12000,
        bookExpense: 8000,
        actualIncome: 11800,
        actualExpense: 8100,
        items: [
          {
            description: '微信手续费差异',
            bookAmount: 100,
            actualAmount: 98,
            note: '平台扣费',
          },
        ],
        operator: '财务张姐',
        note: '节假日汇总',
        date: 1747180800000,
      },
    );
  });

  it('PATCH /finance/reconciliation/:id/confirm 返回确认后的对账单', async () => {
    financeService.confirmReconciliation.mockResolvedValue({
      id: '3',
      title: '5月月度对账',
      type: 'monthly',
      status: 'adjusted',
      periodStart: 1746057600000,
      periodEnd: 1748735999999,
      bookIncome: 12000,
      bookExpense: 8000,
      bookNet: 4000,
      actualIncome: 11800,
      actualExpense: 8100,
      actualNet: 3700,
      diffAmount: -300,
      items: [],
      adjustNote: '微信手续费差额',
      date: 1747180800000,
      createdAt: 1747184400000,
      updatedAt: 1747188000000,
    });

    await request(app.getHttpServer())
      .patch('/finance/reconciliation/3/confirm')
      .set(authHeaders)
      .send({ adjustNote: '微信手续费差额' })
      .expect(200)
      .expect(({ body }) => {
        expect(body.status).toBe('adjusted');
        expect(body.adjustNote).toBe('微信手续费差额');
      });

    expect(financeService.confirmReconciliation).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      3,
      { adjustNote: '微信手续费差额' },
    );
  });

  it('DELETE /finance/reconciliation/:id 删除成功返回 204', async () => {
    financeService.deleteReconciliation.mockResolvedValue(undefined);

    await request(app.getHttpServer())
      .delete('/finance/reconciliation/9')
      .set(authHeaders)
      .expect(204);

    expect(financeService.deleteReconciliation).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      9,
    );
  });
});

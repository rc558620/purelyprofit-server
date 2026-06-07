import { Test, TestingModule } from '@nestjs/testing';
import { PermissionsGuard } from '../../access-control/guards/permissions.guard';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { DashboardHomeController } from './dashboard-home.controller';
import { DashboardHomeService } from './dashboard-home.service';

const ALLOW_GUARD = { canActivate: jest.fn(() => true) };

describe('DashboardHomeController', () => {
  let controller: DashboardHomeController;

  const dashboardHomeService = {
    getOverview: jest.fn(),
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
      subjectType: 'owner',
      linkedEmployeeId: null,
      subAccountId: null,
      subAccountRole: null,
      subAccountStatus: null,
      subAccountAssigned: false,
      canAccessHome: true,
      canUseHandover: false,
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleBuilder = Test.createTestingModule({
      controllers: [DashboardHomeController],
      providers: [
        { provide: DashboardHomeService, useValue: dashboardHomeService },
      ],
    });
    moduleBuilder.overrideGuard(JwtAuthGuard).useValue(ALLOW_GUARD);
    moduleBuilder.overrideGuard(PermissionsGuard).useValue(ALLOW_GUARD);
    const module: TestingModule = await moduleBuilder.compile();

    controller = module.get<DashboardHomeController>(DashboardHomeController);
  });

  it('getOverview 透传当前用户与 query', async () => {
    const response = {
      stats: {
        profitLabel: '今日净利润 (元)',
        profit: 1248.5,
        profitChange: 12.5,
        profitCompareLabel: '较昨日',
        orderLabel: '今日订单数',
        orderCount: 86,
        orderChange: 5.2,
        orderCompareLabel: '较昨日',
      },
      salesTrend: {
        title: '销售趋势图',
        categories: ['08:00', '10:00'],
        actual: [800, 1200],
        forecast: [null, 900],
        isYearMode: false,
        seriesNameActual: '实收',
        seriesNameForecast: '预测',
      },
      activities: [],
      meta: {
        period: 'today' as const,
        storeId: 18,
        storeName: '纯利宝测试门店',
        startAt: 1747180800000,
        endAt: 1747212600000,
        compareStartAt: 1747094400000,
        compareEndAt: 1747126200000,
        generatedAt: 1747212600000,
      },
      capability: {
        identityType: 'sub_account',
        subAccountRole: 'cashier',
        subAccountRoleLabel: '收银员',
        subAccountStatus: 'active',
        subAccountAssigned: true,
        canAccessHome: true,
        canUseHandover: true,
        allowedHomeModules: ['additional'],
        hiddenHomeModules: ['business-analysis'],
        canViewFinance: false,
        canViewMarketing: false,
        canUseGoodsManagement: false,
        canUseHandoverManagement: true,
        canUseSpaceManagement: true,
        canAccessStoreSettings: false,
        canAccessDashboardOverview: true,
      },
    };
    const query = {
      storeId: 18,
      period: 'today' as const,
    };
    dashboardHomeService.getOverview.mockResolvedValue(response);

    await expect(controller.getOverview(user, query)).resolves.toEqual(
      response,
    );
    expect(dashboardHomeService.getOverview).toHaveBeenCalledWith(user, query);
  });
});

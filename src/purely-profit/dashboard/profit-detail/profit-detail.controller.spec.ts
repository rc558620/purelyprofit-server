import { Test, TestingModule } from '@nestjs/testing';
import { PermissionsGuard } from '../../access-control/guards/permissions.guard';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { ProfitDetailController } from './profit-detail.controller';
import { ProfitDetailService } from './profit-detail.service';
import type { ServerResponse } from 'node:http';

const ALLOW_GUARD = { canActivate: jest.fn(() => true) };

describe('ProfitDetailController', () => {
  let controller: ProfitDetailController;

  const profitDetailService = {
    getReport: jest.fn(),
    getProfitDetail: jest.fn(),
  };

  const user: AuthenticatedUser = {
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
      role: 'owner',
      permissions: ['*'],
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

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleBuilder = Test.createTestingModule({
      controllers: [ProfitDetailController],
      providers: [
        { provide: ProfitDetailService, useValue: profitDetailService },
      ],
    });
    moduleBuilder.overrideGuard(JwtAuthGuard).useValue(ALLOW_GUARD);
    moduleBuilder.overrideGuard(PermissionsGuard).useValue(ALLOW_GUARD);
    const module: TestingModule = await moduleBuilder.compile();

    controller = module.get<ProfitDetailController>(ProfitDetailController);
  });

  it('getReport 透传当前用户与 query', async () => {
    const response = {
      summary: {
        revenue: 1280,
        totalCost: 860,
        netProfit: 420,
        profitRate: 32.81,
        revenueCompareLastPeriod: 18.6,
        profitCompareLastPeriod: -5.2,
        costCompareLastPeriod: 12.3,
        orderCount: 56,
      },
      products: [],
    };
    const query = {
      storeId: 18,
      period: 'year' as const,
      year: 2025,
    };
    profitDetailService.getReport.mockResolvedValue(response);

    await expect(
      controller.getReport(user, query, { raw: {} as ServerResponse }),
    ).resolves.toEqual(response);
    expect(profitDetailService.getReport).toHaveBeenCalledWith(user, query);
  });

  it('getProfitDetail 透传当前用户与 query', async () => {
    const response = {
      summary: {
        revenue: 1280,
        totalCost: 860,
        netProfit: 420,
        profitRate: 32.81,
        revenueCompareLastPeriod: 18.6,
        profitCompareLastPeriod: -5.2,
        costCompareLastPeriod: 12.3,
        orderCount: 56,
      },
      dailyProfits: [],
      productRanking: [],
      costBreakdown: [],
    };
    const query = {
      storeId: 18,
      period: 'custom_range' as const,
      rangeStartDate: 1746057600000,
      rangeEndDate: 1748735999999,
    };
    profitDetailService.getProfitDetail.mockResolvedValue(response);

    await expect(controller.getProfitDetail(user, query)).resolves.toEqual(
      response,
    );
    expect(profitDetailService.getProfitDetail).toHaveBeenCalledWith(
      user,
      query,
    );
  });
});

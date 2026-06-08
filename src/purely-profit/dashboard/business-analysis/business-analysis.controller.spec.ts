import { Test, TestingModule } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PermissionsGuard } from '../../access-control/guards/permissions.guard';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { BusinessAnalysisController } from './business-analysis.controller';
import { BusinessAnalysisService } from './business-analysis.service';
import { GetBusinessAnalysisQueryDto } from './dto/business-analysis-query.dto';

const ALLOW_GUARD = { canActivate: jest.fn(() => true) };

describe('BusinessAnalysisController', () => {
  let controller: BusinessAnalysisController;

  const businessAnalysisService = {
    getAnalysis: jest.fn(),
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
      canUseHandover: true,
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleBuilder = Test.createTestingModule({
      controllers: [BusinessAnalysisController],
      providers: [
        { provide: BusinessAnalysisService, useValue: businessAnalysisService },
      ],
    });
    moduleBuilder.overrideGuard(JwtAuthGuard).useValue(ALLOW_GUARD);
    moduleBuilder.overrideGuard(PermissionsGuard).useValue(ALLOW_GUARD);
    const module: TestingModule = await moduleBuilder.compile();

    controller = module.get<BusinessAnalysisController>(
      BusinessAnalysisController,
    );
  });

  it('getAnalysis 透传当前用户与前端查询参数', async () => {
    const response = {
      heroSummary: {
        netProfit: { current: 100, previous: 80, changeRate: 25 },
        revenue: { current: 500, previous: 400, changeRate: 25 },
        totalCost: { current: 400, previous: 320, changeRate: 25 },
        profitRate: { current: 20, previous: 20, changeRate: 0 },
        orderCount: 3,
      },
      dailyTrend: [],
      categoryShares: [],
      costRateItems: [],
      rankProducts: [],
    };
    const query = {
      storeId: 18,
      period: 'custom_range' as const,
      startTime: 1746057600000,
      endTime: 1748735999999,
    };
    businessAnalysisService.getAnalysis.mockResolvedValue(response);

    await expect(controller.getAnalysis(user, query)).resolves.toEqual(
      response,
    );
    expect(businessAnalysisService.getAnalysis).toHaveBeenCalledWith(
      user,
      query,
    );
  });

  it('GetBusinessAnalysisQueryDto 兼容旧版 all + 时间范围入参', async () => {
    const dto = plainToInstance(GetBusinessAnalysisQueryDto, {
      period: 'all',
      startTime: 1767196800000,
      endTime: 1798732799999,
    });

    await expect(
      validate(dto, {
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    ).resolves.toEqual([]);
    expect(dto.period).toBe('custom_range');
  });

  it('GetBusinessAnalysisQueryDto 缺少时间范围时仍拦截 all', async () => {
    const dto = plainToInstance(GetBusinessAnalysisQueryDto, {
      period: 'all',
    });

    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toMatchObject({
      isIn: '统计周期不合法',
    });
  });
});

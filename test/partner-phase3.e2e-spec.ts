import {
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { PermissionsGuard } from '../src/purely-profit/access-control/guards/permissions.guard';
import {
  JwtAuthGuard,
  PulseJwtAuthGuard,
} from '../src/purely-profit/auth/guards/jwt-auth.guard';
import { PlatformMembershipController } from '../src/purely-profit/member/platform-membership/platform-membership.controller';
import { PlatformMembershipService } from '../src/purely-profit/member/platform-membership/platform-membership.service';
import { WithdrawalsController } from '../src/purely-profit/member/withdrawals/withdrawals.controller';
import { WithdrawalsService } from '../src/purely-profit/member/withdrawals/withdrawals.service';
import { PulseGrowthController } from '../src/purely-pulse/growth/growth.controller';
import { PulseGrowthEarningsController } from '../src/purely-pulse/growth/growth-earnings.controller';
import { PulseGrowthService } from '../src/purely-pulse/growth/growth.service';
import { PulseGrowthWithdrawalsController } from '../src/purely-pulse/growth/growth-withdrawals.controller';

describe('Partner Phase 3 controllers (e2e)', () => {
  let app: INestApplication<App>;

  type GuardRequest = {
    headers?: Record<string, string | string[] | undefined>;
    user?: unknown;
  };

  const authHeaders = {
    Authorization: 'Bearer valid-token',
    'x-permissions': '*',
  };

  const authenticatedUser = {
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

  const platformMembershipService = {
    getCenter: jest.fn(),
  };

  const withdrawalsService = {
    getOverview: jest.fn(),
    apply: jest.fn(),
  };

  const pulseGrowthService = {
    getEarningsOverview: jest.fn(),
    getWithdrawalAccount: jest.fn(),
    applyWithdrawal: jest.fn(),
  };

  const authGuard = {
    canActivate: (context: {
      switchToHttp: () => { getRequest: () => GuardRequest };
    }): boolean => {
      const req = context.switchToHttp().getRequest();
      if (req.headers?.authorization !== 'Bearer valid-token') {
        throw new UnauthorizedException('未登录');
      }
      req.user = authenticatedUser;
      return true;
    },
  };

  const permissionsGuard = {
    canActivate: (): boolean => true,
  };

  beforeAll(async () => {
    const moduleBuilder = Test.createTestingModule({
      controllers: [
        PlatformMembershipController,
        WithdrawalsController,
        PulseGrowthController,
        PulseGrowthEarningsController,
        PulseGrowthWithdrawalsController,
      ],
      providers: [
        {
          provide: PlatformMembershipService,
          useValue: platformMembershipService,
        },
        { provide: WithdrawalsService, useValue: withdrawalsService },
        { provide: PulseGrowthService, useValue: pulseGrowthService },
      ],
    });

    moduleBuilder.overrideGuard(JwtAuthGuard).useValue(authGuard);
    moduleBuilder.overrideGuard(PulseJwtAuthGuard).useValue(authGuard);
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

  it('GET /platform-membership/center 返回多合伙人聚合结构', async () => {
    platformMembershipService.getCenter.mockResolvedValue({
      memberInfo: {
        isActive: true,
        planId: 'quarterly',
        expiredAt: 1780000000000,
        inviteCode: 'ABCD23',
        totalPoints: 1880,
        availablePoints: 1280,
      },
      approvedPartner: {
        id: '6',
        name: '张三',
        phone: '13800138000',
        joinedAt: 1747180800000,
        beanBalance: 700,
        totalEarnedBeans: 2000,
        totalWithdrawnBeans: 1300,
      },
      approvedPartners: [
        {
          id: '6',
          name: '张三',
          phone: '13800138000',
          joinedAt: 1747180800000,
          beanBalance: 700,
          totalEarnedBeans: 2000,
          totalWithdrawnBeans: 1300,
        },
        {
          id: '7',
          name: '李四',
          phone: '13900139000',
          joinedAt: 1747267200000,
          beanBalance: 500,
          totalEarnedBeans: 1200,
          totalWithdrawnBeans: 400,
        },
      ],
      overview: {
        planName: '季度会员',
        totalOrders: 3,
        totalSpent: 29700,
        totalPromos: 12,
        totalBeans: 1200,
      },
      rights: [],
    });

    await request(app.getHttpServer())
      .get('/platform-membership/center')
      .set(authHeaders)
      .expect(200)
      .expect(({ body }) => {
        expect(body.approvedPartner.id).toBe('6');
        expect(body.approvedPartners).toHaveLength(2);
        expect(body.approvedPartners[1].beanBalance).toBe(500);
      });

    expect(platformMembershipService.getCenter).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 1,
        currentMembership: expect.objectContaining({ storeId: 18 }),
      }),
    );
  });

  it('POST /withdrawals/apply 会透传 partnerId 并返回聚合 overview', async () => {
    withdrawalsService.apply.mockResolvedValue({
      record: {
        id: '21',
        beanAmount: 500,
        rmbAmount: 50000,
        accountType: 'alipay',
        accountNo: '13800138000',
        accountName: '张三',
        status: 'pending',
        appliedAt: 1747216800000,
      },
      overview: {
        approvedPartner: {
          id: '6',
          name: '张三',
          phone: '13800138000',
          joinedAt: 1747180800000,
          beanBalance: 700,
          totalEarnedBeans: 2000,
          totalWithdrawnBeans: 1300,
        },
        approvedPartners: [
          {
            id: '6',
            name: '张三',
            phone: '13800138000',
            joinedAt: 1747180800000,
            beanBalance: 700,
            totalEarnedBeans: 2000,
            totalWithdrawnBeans: 1300,
          },
          {
            id: '7',
            name: '李四',
            phone: '13900139000',
            joinedAt: 1747267200000,
            beanBalance: 500,
            totalEarnedBeans: 1200,
            totalWithdrawnBeans: 400,
          },
        ],
        beanBalance: 1200,
        totalWithdrawnBeans: 1700,
        pendingCount: 3,
      },
    });

    await request(app.getHttpServer())
      .post('/withdrawals/apply')
      .set(authHeaders)
      .send({
        partnerId: '7',
        beanAmount: 500,
        accountType: 'alipay',
        accountNo: '13800138000',
        accountName: '张三',
      })
      .expect(201)
      .expect(({ body }) => {
        expect(body.record.id).toBe('21');
        expect(body.overview.approvedPartners).toHaveLength(2);
        expect(body.overview.beanBalance).toBe(1200);
      });

    expect(withdrawalsService.apply).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      {
        partnerId: '7',
        beanAmount: 500,
        accountType: 'alipay',
        accountNo: '13800138000',
        accountName: '张三',
      },
    );
  });

  it('POST /withdrawals/apply 遇到非白名单字段时返回 400', async () => {
    await request(app.getHttpServer())
      .post('/withdrawals/apply')
      .set(authHeaders)
      .send({
        beanAmount: 500,
        accountType: 'alipay',
        accountNo: '13800138000',
        accountName: '张三',
        extraField: 'boom',
      })
      .expect(400)
      .expect(({ body }) => {
        expect(body.message).toContain('property extraField should not exist');
      });

    expect(withdrawalsService.apply).not.toHaveBeenCalled();
  });

  it('GET /pulse/growth/earnings/overview 返回多合伙人聚合收益结构', async () => {
    pulseGrowthService.getEarningsOverview.mockResolvedValue({
      approvedPartner: {
        id: '6',
        name: '张三',
        phone: '13800138000',
        joinedAt: 1747180800000,
        beanBalance: 700,
        totalEarnedBeans: 2000,
        totalWithdrawnBeans: 1300,
      },
      approvedPartners: [
        {
          id: '6',
          name: '张三',
          phone: '13800138000',
          joinedAt: 1747180800000,
          beanBalance: 700,
          totalEarnedBeans: 2000,
          totalWithdrawnBeans: 1300,
        },
        {
          id: '7',
          name: '李四',
          phone: '13900139000',
          joinedAt: 1747267200000,
          beanBalance: 500,
          totalEarnedBeans: 1200,
          totalWithdrawnBeans: 400,
        },
      ],
      beanBalance: 1200,
      totalEarnedBeans: 3200,
      totalWithdrawnBeans: 1700,
      totalPromos: 15,
      chargedPromos: 8,
      isPartner: true,
      pendingWithdrawals: 2,
    });

    await request(app.getHttpServer())
      .get('/pulse/growth/earnings/overview')
      .set(authHeaders)
      .expect(200)
      .expect(({ body }) => {
        expect(body.approvedPartners).toHaveLength(2);
        expect(body.totalEarnedBeans).toBe(3200);
        expect(body.pendingWithdrawals).toBe(2);
      });

    expect(pulseGrowthService.getEarningsOverview).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
    );
  });

  it('GET /pulse/growth/withdrawals/account 返回选中合伙人与聚合余额', async () => {
    pulseGrowthService.getWithdrawalAccount.mockResolvedValue({
      isPartner: true,
      selectedPartner: {
        id: '6',
        name: '张三',
        phone: '13800138000',
        joinedAt: 1747180800000,
        beanBalance: 700,
        totalEarnedBeans: 2000,
        totalWithdrawnBeans: 1300,
        accountType: 'alipay',
        accountNo: '13800138000',
        accountName: '张三',
      },
      approvedPartner: {
        id: '6',
        name: '张三',
        phone: '13800138000',
        joinedAt: 1747180800000,
        beanBalance: 700,
        totalEarnedBeans: 2000,
        totalWithdrawnBeans: 1300,
      },
      approvedPartners: [
        {
          id: '6',
          name: '张三',
          phone: '13800138000',
          joinedAt: 1747180800000,
          beanBalance: 700,
          totalEarnedBeans: 2000,
          totalWithdrawnBeans: 1300,
        },
        {
          id: '7',
          name: '李四',
          phone: '13900139000',
          joinedAt: 1747267200000,
          beanBalance: 500,
          totalEarnedBeans: 1200,
          totalWithdrawnBeans: 400,
        },
      ],
      accountType: 'alipay',
      accountNo: '13800138000',
      accountName: '张三',
      beanBalance: 1200,
    });

    await request(app.getHttpServer())
      .get('/pulse/growth/withdrawals/account')
      .set(authHeaders)
      .expect(200)
      .expect(({ body }) => {
        expect(body.selectedPartner.id).toBe('6');
        expect(body.approvedPartners).toHaveLength(2);
        expect(body.beanBalance).toBe(1200);
      });
  });

  it('POST /pulse/growth/withdrawals/apply 会把 partnerId 透传到 service', async () => {
    pulseGrowthService.applyWithdrawal.mockResolvedValue({
      record: {
        id: '31',
        beanAmount: 300,
        rmbAmount: 30000,
        accountType: 'alipay',
        accountNo: '13800138000',
        accountName: '张三',
        status: 'pending',
        appliedAt: 1747216800000,
      },
      overview: {
        approvedPartner: null,
        approvedPartners: [],
        beanBalance: 0,
        totalWithdrawnBeans: 0,
        pendingCount: 1,
      },
    });

    await request(app.getHttpServer())
      .post('/pulse/growth/withdrawals/apply')
      .set(authHeaders)
      .send({
        partnerId: '7',
        beanAmount: 300,
      })
      .expect(201);

    expect(pulseGrowthService.applyWithdrawal).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      300,
      '7',
    );
  });
});

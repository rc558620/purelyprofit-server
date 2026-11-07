// 店长（manager 子账号）持 marketing:manage 后的营销域写权限契约用例。
//
// 覆盖两类断言：
// 1. 营销中心其它子页面写操作对店长放行（积分调整 / 群发短信 / 顾客储值 / 门店坐标读写）；
// 2. 6 项禁止中可由本模块装配覆盖的部分仍 403（会员等级 / 优惠活动 / 两种充值）。
//    type=refund 的 service 层硬拒与「余额流水无变化」由
//    src/purely-profit/marketing/marketing.service.recharges.spec.ts 覆盖（此处 service 为 mock）。
//
// 鉴权链路与 marketing-auth.e2e-spec 保持同一套 mock 方式：真实 JwtStrategy +
// PermissionsGuard + SubAccountBlockGuard，业务 service 一律 mock，只验证守卫边界。
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test, TestingModule } from '@nestjs/testing';
import {
  StaffRole,
  StoreSubAccountRole,
  StoreSubAccountStatus,
} from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  AccessControlService,
  type AuthenticatedMembership,
} from '../src/purely-profit/access-control/access-control.service';
import { PermissionsGuard } from '../src/purely-profit/access-control/guards/permissions.guard';
import { SubAccountBlockGuard } from '../src/purely-profit/access-control/guards/sub-account-block.guard';
import { AuthBanGuardService } from '../src/purely-profit/auth/auth-ban-guard.service';
import { AuthMembershipResolverService } from '../src/purely-profit/auth/auth-membership-resolver.service';
import { AuthSessionService } from '../src/purely-profit/auth/auth-session.service';
import { JwtAuthGuard } from '../src/purely-profit/auth/guards/jwt-auth.guard';
import { JwtStrategy } from '../src/purely-profit/auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../src/purely-profit/commerce/commerce-access.service';
import { NewCustomerQuotaRechargeService } from '../src/purely-profit/member/new-customer-quota/new-customer-quota-recharge.service';
import { NewCustomerQuotaService } from '../src/purely-profit/member/new-customer-quota/new-customer-quota.service';
import {
  MarketingNewCustomerQuotaController,
  MarketingOverviewController,
  MarketingPromotionsController,
  MarketingStoreLocationController,
} from '../src/purely-profit/marketing/marketing.controller';
import { MarketingCustomersController } from '../src/purely-profit/marketing/marketing-customers.controller';
import { MarketingTransactionsController } from '../src/purely-profit/marketing/marketing-transactions.controller';
import { MarketingService } from '../src/purely-profit/marketing/marketing.service';
import { MarketingSharedService } from '../src/purely-profit/marketing/marketing-shared.service';
import { SmsController } from '../src/purely-profit/marketing/sms/sms.controller';
import { SmsBroadcastQueryService } from '../src/purely-profit/marketing/sms/sms-broadcast-query.service';
import { SmsBroadcastService } from '../src/purely-profit/marketing/sms/sms-broadcast.service';
import { SmsQuoteService } from '../src/purely-profit/marketing/sms/sms-quote.service';
import { SmsRechargeService } from '../src/purely-profit/marketing/sms/sms-recharge.service';
import { SmsWalletService } from '../src/purely-profit/marketing/sms/sms-wallet.service';
import { StoresService } from '../src/purely-profit/stores/stores.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';

const TEST_JWT_SECRET = 'test-secret';
const jwtService = new JwtService({ secret: TEST_JWT_SECRET });

const MANAGER_USER_ID = 201;
const CASHIER_USER_ID = 202;
const STORE_ID = 18;

describe('Marketing manager write access (e2e)', () => {
  let app: INestApplication<App>;
  let managerMembership: AuthenticatedMembership;
  let cashierMembership: AuthenticatedMembership;

  const prismaService = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    // @AllowLegacyOwnerAccess 在权限不足时会回退查「历史 owner 门店」，
    // 这里固定返回 null：无任何门店归属，鉴权链必须收敛成 403 而不是 500
    store: {
      findFirst: jest.fn(),
    },
  };

  const authBanGuardService = { ensureUserNotBanned: jest.fn() };
  const authMembershipResolverService = {
    resolveAuthenticatedMembership: jest.fn(),
  };
  const authSessionService = {
    getTokenVersion: jest.fn(),
    isSessionActive: jest.fn(),
  };
  const redisService = {
    getJson: jest.fn().mockResolvedValue(null),
    setJson: jest.fn().mockResolvedValue(undefined),
  };

  const marketingService = {
    getOverview: jest.fn(),
    getMemberLevelSettings: jest.fn(),
    updateMemberLevel: jest.fn(),
    updatePointsRatio: jest.fn(),
    adjustCustomerPoints: jest.fn(),
    createRecharge: jest.fn(),
  };
  const quotaService = {
    getOverview: jest.fn(),
    getTiers: jest.fn(),
    getLogs: jest.fn(),
  };
  const quotaRechargeService = { createRechargeOrder: jest.fn() };
  const commerceAccessService = {
    resolveSingleStoreId: jest.fn().mockResolvedValue(STORE_ID),
  };
  const marketingSharedService = {
    resolveMembershipManagedStoreId: jest.fn().mockResolvedValue(STORE_ID),
  };
  const smsQuoteService = { createQuote: jest.fn() };
  const smsBroadcastService = { broadcast: jest.fn() };
  const smsRechargeService = { createRechargeOrder: jest.fn() };
  const smsWalletService = {
    getWallet: jest.fn(),
    getRechargeTiers: jest.fn(),
    listWalletLogs: jest.fn(),
  };
  const smsBroadcastQueryService = {
    listBroadcasts: jest.fn(),
    getBroadcastDetail: jest.fn(),
    listRecipients: jest.fn(),
  };
  const storesService = {
    getCurrent: jest.fn(),
    updateCurrent: jest.fn(),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [PassportModule.register({ defaultStrategy: 'jwt' })],
      controllers: [
        MarketingOverviewController,
        MarketingPromotionsController,
        MarketingCustomersController,
        MarketingTransactionsController,
        MarketingNewCustomerQuotaController,
        MarketingStoreLocationController,
        SmsController,
      ],
      providers: [
        JwtStrategy,
        JwtAuthGuard,
        PermissionsGuard,
        SubAccountBlockGuard,
        AccessControlService,
        { provide: PrismaService, useValue: prismaService },
        { provide: RedisService, useValue: redisService },
        { provide: AuthBanGuardService, useValue: authBanGuardService },
        {
          provide: AuthMembershipResolverService,
          useValue: authMembershipResolverService,
        },
        { provide: AuthSessionService, useValue: authSessionService },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) =>
              key === 'jwt.secret' ? TEST_JWT_SECRET : undefined,
            ),
          },
        },
        { provide: MarketingService, useValue: marketingService },
        { provide: MarketingSharedService, useValue: marketingSharedService },
        { provide: NewCustomerQuotaService, useValue: quotaService },
        {
          provide: NewCustomerQuotaRechargeService,
          useValue: quotaRechargeService,
        },
        { provide: CommerceAccessService, useValue: commerceAccessService },
        { provide: SmsQuoteService, useValue: smsQuoteService },
        { provide: SmsBroadcastService, useValue: smsBroadcastService },
        { provide: SmsRechargeService, useValue: smsRechargeService },
        { provide: SmsWalletService, useValue: smsWalletService },
        {
          provide: SmsBroadcastQueryService,
          useValue: smsBroadcastQueryService,
        },
        { provide: StoresService, useValue: storesService },
      ],
    }).compile();

    // 会员上下文直接用真实权限白名单解析：店长是否真的拿到 marketing:manage
    // 由 access-control 的权限集决定，e2e 不手写权限数组，避免与角色表脱钩。
    const accessControlService = moduleFixture.get(AccessControlService);
    managerMembership = accessControlService.buildMembershipContext(
      {
        id: 14,
        storeId: STORE_ID,
        role: StaffRole.staff,
        permissions: [],
        isActive: true,
      },
      {
        id: 6,
        employeeId: 12,
        role: StoreSubAccountRole.manager,
        status: StoreSubAccountStatus.active,
        isAssigned: true,
        canAccessHome: true,
        canUseHandover: true,
      },
      'general',
    );
    cashierMembership = accessControlService.buildMembershipContext(
      {
        id: 15,
        storeId: STORE_ID,
        role: StaffRole.staff,
        permissions: [],
        isActive: true,
      },
      {
        id: 7,
        employeeId: 13,
        role: StoreSubAccountRole.cashier,
        status: StoreSubAccountStatus.active,
        isAssigned: true,
        canAccessHome: true,
        canUseHandover: true,
      },
      'general',
    );

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
    authBanGuardService.ensureUserNotBanned.mockResolvedValue(undefined);
    authSessionService.getTokenVersion.mockResolvedValue(0);
    authSessionService.isSessionActive.mockResolvedValue(true);
    commerceAccessService.resolveSingleStoreId.mockResolvedValue(STORE_ID);
    marketingSharedService.resolveMembershipManagedStoreId.mockResolvedValue(
      STORE_ID,
    );
    marketingService.adjustCustomerPoints.mockResolvedValue({
      id: '9',
      name: '张三',
    });
    marketingService.createRecharge.mockResolvedValue({ id: '100' });
    smsBroadcastService.broadcast.mockResolvedValue({
      broadcastId: 'bc_1',
      status: 'sent',
    });
    const storeSnapshot = {
      id: STORE_ID,
      storeName: '测试门店',
      storeType: '零售',
      businessMode: 'general',
      memberCareEnabled: false,
      technicianLabel: '技师',
      region: [],
      address: '北京市朝阳区望京街道 1 号',
      latitude: 39.984104,
      longitude: 116.307503,
      createdAt: new Date('2026-05-01T00:00:00.000Z'),
      updatedAt: new Date('2026-05-02T00:00:00.000Z'),
    };
    storesService.getCurrent.mockResolvedValue(storeSnapshot);
    storesService.updateCurrent.mockResolvedValue(storeSnapshot);
    prismaService.store.findFirst.mockResolvedValue(null);
    prismaService.user.findUnique.mockImplementation(
      ({ where }: { where: { id: number } }) => {
        const record = userRecords[where.id];
        return Promise.resolve(record ?? null);
      },
    );
    authMembershipResolverService.resolveAuthenticatedMembership.mockImplementation(
      ({ sub }: { sub: number }) =>
        Promise.resolve(
          sub === MANAGER_USER_ID
            ? managerMembership
            : sub === CASHIER_USER_ID
              ? cashierMembership
              : null,
        ),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('店长解析出的权限集包含 marketing:manage', () => {
    expect(managerMembership.permissions).toContain('marketing:view');
    expect(managerMembership.permissions).toContain('marketing:manage');
    // 门店设置权限不得连带下放
    expect(managerMembership.permissions).not.toContain('store:update');
    expect(cashierMembership.permissions).not.toContain('marketing:view');
    expect(cashierMembership.permissions).not.toContain('marketing:manage');
  });

  it('店长放开项：PATCH /marketing/customers/:id/points 积分调整放行', async () => {
    await request(app.getHttpServer())
      .patch('/marketing/customers/9/points')
      .set('Authorization', `Bearer ${createToken(MANAGER_USER_ID)}`)
      .send({ delta: 100, remark: '活动奖励' })
      .expect(200);

    expect(marketingService.adjustCustomerPoints).toHaveBeenCalledTimes(1);
  });

  it('店长放开项：POST /marketing/sms/broadcasts 放行到 service', async () => {
    await request(app.getHttpServer())
      .post('/marketing/sms/broadcasts')
      .set('Authorization', `Bearer ${createToken(MANAGER_USER_ID)}`)
      .send({
        customerIds: ['12'],
        content: '老顾客回馈',
        quoteId: 'qt_1',
        idempotencyKey: 'idem_1',
      })
      .expect(201);

    expect(smsBroadcastService.broadcast).toHaveBeenCalledTimes(1);
  });

  it('店长放开项：GET /marketing/store-location 能读到门店信息（/stores/current 对子账号 403）', async () => {
    await request(app.getHttpServer())
      .get('/marketing/store-location')
      .set('Authorization', `Bearer ${createToken(MANAGER_USER_ID)}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          id: STORE_ID,
          storeName: '测试门店',
          latitude: 39.984104,
          longitude: 116.307503,
        });
      });

    expect(storesService.getCurrent).toHaveBeenCalledTimes(1);
  });

  it('店长放开项：PATCH /marketing/store-location 只写坐标与地址', async () => {
    await request(app.getHttpServer())
      .patch('/marketing/store-location')
      .set('Authorization', `Bearer ${createToken(MANAGER_USER_ID)}`)
      .send({
        latitude: 39.984104,
        longitude: 116.307503,
        address: '北京市朝阳区望京街道 1 号',
      })
      .expect(200);

    expect(storesService.updateCurrent).toHaveBeenCalledWith(
      expect.objectContaining({ id: MANAGER_USER_ID }),
      {
        latitude: 39.984104,
        longitude: 116.307503,
        address: '北京市朝阳区望京街道 1 号',
      },
    );
  });

  it('店长放开项：坐标接口拒绝门店其它字段（门店名称等不属于该接口）', async () => {
    await request(app.getHttpServer())
      .patch('/marketing/store-location')
      .set('Authorization', `Bearer ${createToken(MANAGER_USER_ID)}`)
      .send({
        latitude: 39.984104,
        longitude: 116.307503,
        storeName: '被改名门店',
      })
      .expect(400);

    expect(storesService.updateCurrent).not.toHaveBeenCalled();
  });

  it('店长放开项：POST /marketing/recharges(type=recharge) 放行到 service', async () => {
    await request(app.getHttpServer())
      .post('/marketing/recharges?storeId=18')
      .set('Authorization', `Bearer ${createToken(MANAGER_USER_ID)}`)
      .send({
        customerId: 9,
        amount: 10000,
        giftAmount: 0,
        type: 'recharge',
        note: '店长储值',
      })
      .expect(201);

    expect(marketingService.createRecharge).toHaveBeenCalledWith(
      expect.objectContaining({ id: MANAGER_USER_ID }),
      STORE_ID,
      expect.objectContaining({ type: 'recharge' }),
    );
  });

  it('禁止项：店长 GET /marketing/member-level-settings 返回 403', async () => {
    await request(app.getHttpServer())
      .get('/marketing/member-level-settings')
      .set('Authorization', `Bearer ${createToken(MANAGER_USER_ID)}`)
      .expect(403);

    expect(marketingService.getMemberLevelSettings).not.toHaveBeenCalled();
  });

  it('禁止项：店长 PATCH /marketing/member-level-settings/points-ratio 返回 403', async () => {
    await request(app.getHttpServer())
      .patch('/marketing/member-level-settings/points-ratio')
      .set('Authorization', `Bearer ${createToken(MANAGER_USER_ID)}`)
      .send({ ratio: 1 })
      .expect(403);

    expect(marketingService.updatePointsRatio).not.toHaveBeenCalled();
  });

  it('禁止项：店长 GET /marketing/promotions 返回 403', async () => {
    await request(app.getHttpServer())
      .get('/marketing/promotions')
      .set('Authorization', `Bearer ${createToken(MANAGER_USER_ID)}`)
      .expect(403);
  });

  it('禁止项：店长 POST /marketing/new-customer-quota/recharge 返回 403 且不下单', async () => {
    await request(app.getHttpServer())
      .post('/marketing/new-customer-quota/recharge')
      .set('Authorization', `Bearer ${createToken(MANAGER_USER_ID)}`)
      .send({ amountFen: 1000 })
      .expect(403);

    expect(quotaRechargeService.createRechargeOrder).not.toHaveBeenCalled();
  });

  it('禁止项：店长 POST /marketing/sms/recharge-orders 返回 403 且不建支付单', async () => {
    await request(app.getHttpServer())
      .post('/marketing/sms/recharge-orders')
      .set('Authorization', `Bearer ${createToken(MANAGER_USER_ID)}`)
      .send({ amountFen: 1000 })
      .expect(403);

    expect(smsRechargeService.createRechargeOrder).not.toHaveBeenCalled();
  });

  it('收银员无营销权限：营销写接口与坐标接口均 403', async () => {
    await request(app.getHttpServer())
      .patch('/marketing/customers/9/points')
      .set('Authorization', `Bearer ${createToken(CASHIER_USER_ID)}`)
      .send({ delta: 100, remark: '越权' })
      .expect(403);

    await request(app.getHttpServer())
      .get('/marketing/store-location')
      .set('Authorization', `Bearer ${createToken(CASHIER_USER_ID)}`)
      .expect(403);

    await request(app.getHttpServer())
      .patch('/marketing/store-location')
      .set('Authorization', `Bearer ${createToken(CASHIER_USER_ID)}`)
      .send({ latitude: 39.9, longitude: 116.3 })
      .expect(403);

    expect(marketingService.adjustCustomerPoints).not.toHaveBeenCalled();
    expect(storesService.getCurrent).not.toHaveBeenCalled();
    expect(storesService.updateCurrent).not.toHaveBeenCalled();
  });
});

const userRecords: Record<
  number,
  {
    id: number;
    email: string;
    name: string;
    createdAt: Date;
    updatedAt: Date;
    lastActiveAt: Date | null;
  }
> = {
  [MANAGER_USER_ID]: {
    id: MANAGER_USER_ID,
    email: 'store-manager@example.com',
    name: '店长',
    createdAt: new Date('2026-05-01T00:00:00.000Z'),
    updatedAt: new Date('2026-05-02T00:00:00.000Z'),
    lastActiveAt: new Date('2026-05-03T00:00:00.000Z'),
  },
  [CASHIER_USER_ID]: {
    id: CASHIER_USER_ID,
    email: 'store-cashier@example.com',
    name: '收银员',
    createdAt: new Date('2026-05-01T00:00:00.000Z'),
    updatedAt: new Date('2026-05-02T00:00:00.000Z'),
    lastActiveAt: new Date('2026-05-03T00:00:00.000Z'),
  },
};

function createToken(sub: number): string {
  return jwtService.sign({
    sub,
    phone: '13800138000',
    sessionVersion: 0,
    accountScope: 'purely_profit',
  });
}

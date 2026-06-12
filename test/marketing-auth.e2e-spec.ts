import {
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AccessControlService } from '../src/purely-profit/access-control/access-control.service';
import { PermissionsGuard } from '../src/purely-profit/access-control/guards/permissions.guard';
import { AuthAccountMembershipService } from '../src/purely-profit/auth/auth-account-membership.service';
import { AuthSessionService } from '../src/purely-profit/auth/auth-session.service';
import { JwtAuthGuard } from '../src/purely-profit/auth/guards/jwt-auth.guard';
import { JwtStrategy } from '../src/purely-profit/auth/strategies/jwt.strategy';
import { MarketingCustomersFacadeService } from '../src/purely-profit/marketing/marketing-customers.facade.service';
import { MarketingFacadeService } from '../src/purely-profit/marketing/marketing-facade.service';
import { MarketingProductCategoriesController } from '../src/purely-profit/marketing/marketing-product-categories.controller';
import { MarketingProductCategoriesService } from '../src/purely-profit/marketing/marketing-product-categories.service';
import { MarketingProductsController } from '../src/purely-profit/marketing/marketing-products.controller';
import { MarketingProductsFacadeService } from '../src/purely-profit/marketing/marketing-products.facade.service';
import { MarketingProductsService } from '../src/purely-profit/marketing/marketing-products.service';
import { MarketingTransactionsController } from '../src/purely-profit/marketing/marketing-transactions.controller';
import { MarketingPromotionsFacadeService } from '../src/purely-profit/marketing/marketing-promotions.facade.service';
import { MarketingSharedService } from '../src/purely-profit/marketing/marketing-shared.service';
import { MarketingService } from '../src/purely-profit/marketing/marketing.service';
import { MarketingTransactionsFacadeService } from '../src/purely-profit/marketing/marketing-transactions.facade.service';
import { MarketingOverviewFacadeService } from '../src/purely-profit/marketing/marketing-overview.facade.service';
import { MarketingAccessService } from '../src/purely-profit/marketing/marketing-access.service';
import { PlatformMembershipAccessService } from '../src/purely-profit/member/platform-membership/platform-membership-access.service';
import { PrismaService } from '../src/prisma/prisma.service';

const TEST_JWT_SECRET = 'test-secret';
const jwtService = new JwtService({ secret: TEST_JWT_SECRET });

describe('Marketing auth chain (e2e)', () => {
  let app: INestApplication<App>;

  const prismaService = {
    user: {
      findUnique: jest.fn(),
    },
    store: {
      findFirst: jest.fn(),
    },
    marketingProductCategory: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  };

  const authAccountMembershipService = {
    ensureUserNotBanned: jest.fn(),
    resolveAuthenticatedMembership: jest.fn(),
  };

  const authSessionService = {
    getTokenVersion: jest.fn(),
  };

  const platformMembershipAccessService = {
    ensureMarketingFeatureEnabled: jest.fn(),
  };

  const unusedOverviewFacade = {
    getOverview: jest.fn(),
    getMemberLevelSettings: jest.fn(),
    updateMemberLevel: jest.fn(),
    updatePointsRatio: jest.fn(),
  };

  const unusedCustomersFacade = {
    listCustomers: jest.fn(),
    getCustomer: jest.fn(),
    createCustomer: jest.fn(),
    updateCustomer: jest.fn(),
    deleteCustomer: jest.fn(),
    listCustomerRecharges: jest.fn(),
    listCustomerPointsRecords: jest.fn(),
    listConsumptions: jest.fn(),
  };

  const unusedTransactionsFacade = {
    listRecharges: jest.fn(),
    createRecharge: jest.fn(),
    listPointsRecords: jest.fn(),
    createConsumption: jest.fn(),
  };

  const unusedPromotionsFacade = {
    listPromotions: jest.fn(),
    getPromotion: jest.fn(),
    createPromotion: jest.fn(),
    updatePromotion: jest.fn(),
    deletePromotion: jest.fn(),
    togglePromotion: jest.fn(),
  };

  const unusedProductsService = {
    listProducts: jest.fn(),
    createProduct: jest.fn(),
    updateProduct: jest.fn(),
    toggleProduct: jest.fn(),
    deleteProduct: jest.fn(),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [PassportModule.register({ defaultStrategy: 'jwt' })],
      controllers: [
        MarketingProductCategoriesController,
        MarketingProductsController,
        MarketingTransactionsController,
      ],
      providers: [
        JwtStrategy,
        JwtAuthGuard,
        PermissionsGuard,
        AccessControlService,
        MarketingAccessService,
        MarketingSharedService,
        MarketingProductCategoriesService,
        MarketingProductsFacadeService,
        {
          provide: MarketingService,
          useClass: MarketingFacadeService,
        },
        {
          provide: MarketingOverviewFacadeService,
          useValue: unusedOverviewFacade,
        },
        {
          provide: MarketingCustomersFacadeService,
          useValue: unusedCustomersFacade,
        },
        {
          provide: MarketingTransactionsFacadeService,
          useValue: unusedTransactionsFacade,
        },
        {
          provide: MarketingPromotionsFacadeService,
          useValue: unusedPromotionsFacade,
        },
        {
          provide: MarketingProductsService,
          useValue: unusedProductsService,
        },
        {
          provide: PrismaService,
          useValue: prismaService,
        },
        {
          provide: AuthAccountMembershipService,
          useValue: authAccountMembershipService,
        },
        {
          provide: AuthSessionService,
          useValue: authSessionService,
        },
        {
          provide: PlatformMembershipAccessService,
          useValue: platformMembershipAccessService,
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'jwt.secret') {
                return TEST_JWT_SECRET;
              }
              if (key === 'pulse.devAccountEmails') {
                return [];
              }
              return undefined;
            }),
          },
        },
      ],
    }).compile();

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
    authAccountMembershipService.ensureUserNotBanned.mockResolvedValue(undefined);
    authSessionService.getTokenVersion.mockResolvedValue(0);
    platformMembershipAccessService.ensureMarketingFeatureEnabled.mockResolvedValue(
      undefined,
    );
    prismaService.store.findFirst.mockResolvedValue({ id: 18 });
    prismaService.marketingProductCategory.findMany.mockResolvedValue([
      {
        id: 5,
        storeId: 18,
        name: '推拿按摩',
        icon: 'spa',
        createdAt: new Date('2026-05-10T10:00:00.000Z'),
        updatedAt: new Date('2026-05-12T10:00:00.000Z'),
      },
    ]);
    prismaService.marketingProductCategory.findUnique.mockResolvedValue(null);
    prismaService.marketingProductCategory.create.mockImplementation(
      ({ data }: { data: { storeId: number; name: string; icon: string | null } }) =>
        Promise.resolve({
          id: 6,
          storeId: data.storeId,
          name: data.name,
          icon: data.icon,
          createdAt: new Date('2026-05-13T10:00:00.000Z'),
          updatedAt: new Date('2026-05-13T10:00:00.000Z'),
        }),
    );
    prismaService.user.findUnique.mockImplementation(
      ({ where }: { where: { id: number } }) => {
        const record = userRecords[where.id];
        return Promise.resolve(record ?? null);
      },
    );
    authAccountMembershipService.resolveAuthenticatedMembership.mockImplementation(
      ({ sub }: { sub: number }) => Promise.resolve(membershipRecords[sub] ?? null),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /marketing/product-categories 未登录时返回 401', async () => {
    await request(app.getHttpServer())
      .get('/marketing/product-categories')
      .expect(401);
  });

  it('GET /marketing/product-categories 老 owner 无 membership 时仍可通过全链路鉴权', async () => {
    await request(app.getHttpServer())
      .get('/marketing/product-categories')
      .set('Authorization', `Bearer ${createToken(101)}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.items).toHaveLength(1);
        expect(body.items[0]).toMatchObject({
          id: '5',
          name: '推拿按摩',
          icon: 'spa',
        });
      });

    expect(
      authAccountMembershipService.resolveAuthenticatedMembership,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ sub: 101 }),
      'legacy-owner@example.com',
    );
    expect(prismaService.store.findFirst).toHaveBeenCalled();
    expect(
      platformMembershipAccessService.ensureMarketingFeatureEnabled,
    ).toHaveBeenCalledWith(18, false);
    expect(prismaService.marketingProductCategory.findMany).toHaveBeenCalledWith({
      where: { storeId: 18 },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    });
  });

  it('GET /marketing/product-categories 同店老 owner 历史 membership 无营销权限时仍可通过', async () => {
    await request(app.getHttpServer())
      .get('/marketing/product-categories')
      .set('Authorization', `Bearer ${createToken(102)}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.items[0].id).toBe('5');
      });

    expect(
      platformMembershipAccessService.ensureMarketingFeatureEnabled,
    ).toHaveBeenCalledWith(18, false);
  });

  it('POST /marketing/product-categories 未登录时返回 401', async () => {
    await request(app.getHttpServer())
      .post('/marketing/product-categories?storeId=18')
      .send(createCategoryPayload())
      .expect(401);
  });

  it('POST /marketing/product-categories 老 owner 无 membership 时仍可通过 manage 鉴权', async () => {
    await request(app.getHttpServer())
      .post('/marketing/product-categories?storeId=18')
      .set('Authorization', `Bearer ${createToken(101)}`)
      .send(createCategoryPayload())
      .expect(201)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          id: '6',
          name: '肩颈放松',
          icon: 'spa',
        });
      });

    expect(
      platformMembershipAccessService.ensureMarketingFeatureEnabled,
    ).toHaveBeenCalledWith(18, false);
    expect(prismaService.marketingProductCategory.findUnique).toHaveBeenCalledWith({
      where: { storeId_name: { storeId: 18, name: '肩颈放松' } },
      select: { id: true },
    });
    expect(prismaService.marketingProductCategory.create).toHaveBeenCalledWith({
      data: {
        storeId: 18,
        name: '肩颈放松',
        icon: 'spa',
      },
    });
  });

  it('POST /marketing/product-categories 同店老 owner 历史 membership 无营销权限时仍可通过 manage 鉴权', async () => {
    await request(app.getHttpServer())
      .post('/marketing/product-categories?storeId=18')
      .set('Authorization', `Bearer ${createToken(102)}`)
      .send(createCategoryPayload())
      .expect(201)
      .expect(({ body }) => {
        expect(body.id).toBe('6');
      });

    expect(
      platformMembershipAccessService.ensureMarketingFeatureEnabled,
    ).toHaveBeenCalledWith(18, false);
    expect(prismaService.marketingProductCategory.create).toHaveBeenCalledTimes(1);
  });

  it('GET /marketing/product-categories 历史 membership 门店不匹配时返回 403', async () => {
    await request(app.getHttpServer())
      .get('/marketing/product-categories')
      .set('Authorization', `Bearer ${createToken(103)}`)
      .expect(403)
      .expect(({ body }) => {
        expect(body.message).toBe('当前账号缺少接口访问权限');
      });

    expect(prismaService.marketingProductCategory.findMany).not.toHaveBeenCalled();
  });

  it('POST /marketing/product-categories 历史 membership 门店不匹配时返回 403', async () => {
    await request(app.getHttpServer())
      .post('/marketing/product-categories?storeId=18')
      .set('Authorization', `Bearer ${createToken(103)}`)
      .send(createCategoryPayload())
      .expect(403)
      .expect(({ body }) => {
        expect(body.message).toBe('当前账号缺少接口访问权限');
      });

    expect(prismaService.marketingProductCategory.findUnique).not.toHaveBeenCalled();
    expect(prismaService.marketingProductCategory.create).not.toHaveBeenCalled();
  });

  it('POST /marketing/products 异店 membership + 显式 storeId 串店写入时返回 403', async () => {
    await request(app.getHttpServer())
      .post('/marketing/products?storeId=18')
      .set('Authorization', `Bearer ${createToken(103)}`)
      .send(createProductPayload())
      .expect(403)
      .expect(({ body }) => {
        expect(body.message).toBe('当前账号缺少接口访问权限');
      });

    expect(unusedProductsService.createProduct).not.toHaveBeenCalled();
  });

  it('POST /marketing/recharges 异店 membership + 显式 storeId 串店写入时返回 403', async () => {
    await request(app.getHttpServer())
      .post('/marketing/recharges?storeId=18')
      .set('Authorization', `Bearer ${createToken(103)}`)
      .send(createRechargePayload())
      .expect(403)
      .expect(({ body }) => {
        expect(body.message).toBe('当前账号缺少接口访问权限');
      });

    expect(unusedTransactionsFacade.createRecharge).not.toHaveBeenCalled();
  });

  it('POST /marketing/consumptions 异店 membership + 显式 storeId 串店写入时返回 403', async () => {
    await request(app.getHttpServer())
      .post('/marketing/consumptions?storeId=18')
      .set('Authorization', `Bearer ${createToken(103)}`)
      .send(createConsumptionPayload())
      .expect(403)
      .expect(({ body }) => {
        expect(body.message).toBe('当前账号缺少接口访问权限');
      });

    expect(unusedTransactionsFacade.createConsumption).not.toHaveBeenCalled();
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
  }
> = {
  101: {
    id: 101,
    email: 'legacy-owner@example.com',
    name: '老老板',
    createdAt: new Date('2026-05-01T00:00:00.000Z'),
    updatedAt: new Date('2026-05-02T00:00:00.000Z'),
  },
  102: {
    id: 102,
    email: 'legacy-owner-with-membership@example.com',
    name: '老老板有旧 membership',
    createdAt: new Date('2026-05-01T00:00:00.000Z'),
    updatedAt: new Date('2026-05-02T00:00:00.000Z'),
  },
  103: {
    id: 103,
    email: 'legacy-owner-other-store@example.com',
    name: '老老板异店 membership',
    createdAt: new Date('2026-05-01T00:00:00.000Z'),
    updatedAt: new Date('2026-05-02T00:00:00.000Z'),
  },
};

const membershipRecords: Record<number, Record<string, unknown> | null> = {
  102: {
    staffId: 12,
    storeId: 18,
    role: 'STAFF',
    permissions: ['goods:view'],
    isActive: true,
    subjectType: 'staff',
    linkedEmployeeId: null,
    subAccountId: null,
    subAccountRole: null,
    subAccountStatus: null,
    subAccountAssigned: false,
    canAccessHome: true,
    canUseHandover: false,
  },
  103: {
    staffId: 13,
    storeId: 99,
    role: 'STAFF',
    permissions: ['goods:view'],
    isActive: true,
    subjectType: 'staff',
    linkedEmployeeId: null,
    subAccountId: null,
    subAccountRole: null,
    subAccountStatus: null,
    subAccountAssigned: false,
    canAccessHome: true,
    canUseHandover: false,
  },
};

function createCategoryPayload(): { name: string; icon: string } {
  return {
    name: '  肩颈放松  ',
    icon: 'spa',
  };
}

function createProductPayload(): {
  name: string;
  categoryId: number;
  price: number;
  stock: number;
} {
  return {
    name: '肩颈放松套餐',
    categoryId: 5,
    price: 19800,
    stock: 10,
  };
}

function createRechargePayload(): {
  customerId: number;
  amount: number;
  giftAmount: number;
  type: 'recharge';
  note: string;
} {
  return {
    customerId: 1,
    amount: 10000,
    giftAmount: 0,
    type: 'recharge',
    note: '异店串店储值校验',
  };
}

function createConsumptionPayload(): {
  customerId: number;
  amount: number;
  balancePaid: number;
  pointsDeducted: number;
  payType: 'cash';
  itemsSummary: string;
} {
  return {
    customerId: 1,
    amount: 5800,
    balancePaid: 0,
    pointsDeducted: 0,
    payType: 'cash',
    itemsSummary: '异店串店消费校验',
  };
}

function createToken(sub: number): string {
  return jwtService.sign({
    sub,
    phone: '13800138000',
    sessionVersion: 0,
    accountScope: 'purely_profit',
  });
}

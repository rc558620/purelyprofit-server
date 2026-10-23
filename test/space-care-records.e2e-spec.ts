import {
  ForbiddenException,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  ClubJwtAuthGuard,
  JwtAuthGuard,
} from '../src/purely-profit/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../src/purely-profit/access-control/guards/permissions.guard';
import { BusinessModeGuard } from '../src/purely-profit/stores/business-mode.guard';
import { MemberCareGuard } from '../src/purely-profit/stores/member-care.guard';
import { CommerceAccessService } from '../src/purely-profit/commerce/commerce-access.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { ClubCareRecordsController } from '../src/purely-club/care-records/club-care-records.controller';
import { ClubCareRecordsService } from '../src/purely-club/care-records/club-care-records.service';
import { ClubMemberProfileService } from '../src/purely-club/member/member-profile/club-member-profile.service';
import { ClubCurrentStoreContextService } from '../src/purely-club/stores/club-current-store-context.service';
import { SpaceCareRecordsController } from '../src/purely-profit/operations/spaces/space-care-records.controller';
import { SpaceCareRecordsService } from '../src/purely-profit/operations/spaces/space-care-records.service';
import { StoreBusinessCapabilityService } from '../src/purely-profit/stores/store-business-capability.service';

const CUSTOMER_ROW = {
  id: 55,
  storeId: 18,
  name: '张三',
  phone: '13800138000',
  avatar: null,
  tier: 'gold',
  balance: 50_000,
  points: 320,
  totalSpent: 158_000,
  visitCount: 12,
  lastVisitAt: new Date(1_761_000_000_000),
  remark: 'VIP',
  createdAt: new Date(1_700_000_000_000),
  updatedAt: new Date(1_761_000_000_000),
};

const buildCareRow = (overrides: Record<string, unknown> = {}) => ({
  id: 35,
  customerId: 55,
  seq: 1,
  visitAt: new Date(1_761_100_000_000),
  serviceName: '深层清洁',
  amountCents: 29_850,
  content: '本次做了深层清洁',
  photos: ['https://cdn.example.com/1.jpg'],
  technicianName: '李技师',
  updatedAt: new Date(1_761_100_360_000),
  ...overrides,
});

describe('Space care records routes (e2e)', () => {
  let app: INestApplication<App>;

  const prismaService = {
    marketingCustomer: {
      findMany: jest.fn(),
      // 详情页标题用顾客摘要（id / 昵称 / 头像）
      findFirst: jest.fn(),
      count: jest.fn(),
    },
    // 详情接口不查顾客档案 / 累计充值，$queryRaw 保留仅为断言「没有被调用」
    $queryRaw: jest.fn().mockResolvedValue([]),
    careRecord: {
      findMany: jest.fn(),
      // 效果对比首尾：各自 LIMIT 1（最早升序 / 最近降序）
      findFirst: jest.fn(),
      count: jest.fn(),
      updateMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
  };
  const commerceAccessService = {
    resolveViewStoreId: jest.fn(),
    resolveSingleStoreId: jest.fn(),
  };
  const clubMemberProfileService = {
    getSnapshotByStoreIdentity: jest.fn(),
  };
  const clubCurrentStoreContextService = {
    resolveCurrentContext: jest.fn(),
  };
  /** 门店能力服务：默认按「SPA/养生/美容/」模式（已开通护理档案）放行 */
  const storeBusinessCapabilityService = {
    ensureMemberCareAccess: jest.fn(),
  };

  const allowGuard = { canActivate: () => true };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [SpaceCareRecordsController, ClubCareRecordsController],
      providers: [
        SpaceCareRecordsService,
        ClubCareRecordsService,
        { provide: PrismaService, useValue: prismaService },
        { provide: CommerceAccessService, useValue: commerceAccessService },
        {
          provide: StoreBusinessCapabilityService,
          useValue: storeBusinessCapabilityService,
        },
        {
          provide: ClubMemberProfileService,
          useValue: clubMemberProfileService,
        },
        {
          provide: ClubCurrentStoreContextService,
          useValue: clubCurrentStoreContextService,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(allowGuard)
      .overrideGuard(PermissionsGuard)
      .useValue(allowGuard)
      .overrideGuard(BusinessModeGuard)
      .useValue(allowGuard)
      .overrideGuard(MemberCareGuard)
      .useValue(allowGuard)
      .overrideGuard(ClubJwtAuthGuard)
      .useValue(allowGuard)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    // 守卫已被 override，这里补上装饰器依赖的 request.user 与 requestId
    app.use(
      (
        req: { user?: unknown; id?: string },
        _res: unknown,
        next: () => void,
      ) => {
        req.user = {
          id: 1,
          email: 'boss@example.com',
          phone: '13900000001',
          name: '老板',
          currentMembership: { staffId: 7, storeId: 18 },
        };
        req.id = 'req-e2e';
        next();
      },
    );
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    commerceAccessService.resolveViewStoreId.mockResolvedValue(18);
    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    // 默认门店档位：已开通会员护理档案
    storeBusinessCapabilityService.ensureMemberCareAccess.mockResolvedValue(
      undefined,
    );
    clubCurrentStoreContextService.resolveCurrentContext.mockResolvedValue({
      user: { id: 201, phone: '13800138000' },
      // 「SPA/养生/美容/」模式门店
      store: { id: 11, memberCareEnabled: true },
    });
    clubMemberProfileService.getSnapshotByStoreIdentity.mockResolvedValue({
      customerId: 55,
    });
    // 默认无带照片记录：对比首尾为 null
    prismaService.careRecord.findFirst.mockResolvedValue(null);
    // 默认顾客摘要查不到：详情仍可正常返回（顾客可能跨店或已删除）
    prismaService.marketingCustomer.findFirst.mockResolvedValue(null);
  });

  it('GET /api/space-care-records/customers 返回分页结构与元/毫秒口径', async () => {
    prismaService.marketingCustomer.findMany.mockResolvedValue([CUSTOMER_ROW]);
    prismaService.marketingCustomer.count.mockResolvedValue(1);

    const response = await request(app.getHttpServer())
      .get('/api/space-care-records/customers')
      .query({
        status: 'active',
        name: '张',
        phone: '138',
        page: 1,
        pageSize: 10,
      })
      .expect(200);

    expect(response.body).toEqual({
      items: [
        expect.objectContaining({
          id: '55',
          phone: '13800138000',
          balance: 500,
          totalSpent: 1580,
          registeredAt: 1_700_000_000_000,
          lastVisitAt: 1_761_000_000_000,
        }),
      ],
      meta: { page: 1, pageSize: 10, total: 1, totalPages: 1 },
    });
  });

  it('GET /api/space-care-records/customers/:customerId 一次返回时间线首屏、对比首尾与顾客摘要', async () => {
    prismaService.careRecord.findMany.mockResolvedValue([
      buildCareRow({ seq: 2, visitAt: new Date(1_761_200_000_000) }),
    ]);
    prismaService.careRecord.count.mockResolvedValue(1);
    prismaService.marketingCustomer.findFirst.mockResolvedValue({
      id: 55,
      name: '纯利会员4010',
      avatar: null,
    });
    // 最早 / 最近一次有照片的护理：compareRange 由详情接口一并返回
    prismaService.careRecord.findFirst
      .mockResolvedValueOnce(
        buildCareRow({ id: 11, seq: 1, visitAt: new Date(1_761_000_000_000) }),
      )
      .mockResolvedValueOnce(
        buildCareRow({ id: 99, seq: 12, visitAt: new Date(1_761_900_000_000) }),
      );

    const response = await request(app.getHttpServer())
      .get('/api/space-care-records/customers/55')
      .expect(200);

    // 只带标题所需的顾客摘要；英雄卡口径（余额 / 累计充值）仍归营销域详情
    expect(response.body.customer).toEqual({ id: '55', name: '纯利会员4010' });
    expect(response.body).not.toHaveProperty('totalRecharge');
    expect(prismaService.$queryRaw).not.toHaveBeenCalled();
    expect(response.body.compareRange).toEqual({
      earliest: expect.objectContaining({ id: '11', seq: 1 }),
      latest: expect.objectContaining({ id: '99', seq: 12 }),
    });
    expect(response.body.items).toEqual([
      expect.objectContaining({
        id: '35',
        customerId: '55',
        seq: 2,
        visitAt: 1_761_200_000_000,
        amountYuan: 298.5,
      }),
    ]);
    expect(prismaService.careRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { storeId: 18, customerId: 55 },
        orderBy: [{ visitAt: 'desc' }, { id: 'desc' }],
        skip: 0,
        take: 10,
      }),
    );
  });

  it('GET /api/space-care-records/customers/:customerId/records 翻页只查记录，skip/take 按页换算', async () => {
    prismaService.careRecord.findMany.mockResolvedValue([
      buildCareRow({ id: 40, seq: 11, visitAt: new Date(1_761_000_000_000) }),
    ]);
    prismaService.careRecord.count.mockResolvedValue(21);

    const response = await request(app.getHttpServer())
      .get('/api/space-care-records/customers/55/records')
      .query({ page: 2, pageSize: 10 })
      .expect(200);

    expect(response.body.items).toEqual([
      expect.objectContaining({
        id: '40',
        seq: 11,
        visitAt: 1_761_000_000_000,
      }),
    ]);
    expect(response.body.meta).toEqual({
      page: 2,
      pageSize: 10,
      total: 21,
      totalPages: 3,
    });
    expect(prismaService.careRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { storeId: 18, customerId: 55 },
        orderBy: [{ visitAt: 'desc' }, { id: 'desc' }],
        skip: 10,
        take: 10,
      }),
    );
    // 翻页链路不应再打顾客档案查询（首屏已查过）
    expect(prismaService.$queryRaw).not.toHaveBeenCalled();
  });

  it('GET /api/space-care-records/customers/:customerId/records 页码超上限时以 400 拒绝', async () => {
    await request(app.getHttpServer())
      .get('/api/space-care-records/customers/55/records')
      .query({ page: 1001 })
      .expect(400);

    expect(prismaService.careRecord.findMany).not.toHaveBeenCalled();
  });

  it('PATCH /api/space-care-records/:recordId 只接受 content/photos，多余字段被拒绝', async () => {
    prismaService.careRecord.updateMany.mockResolvedValue({ count: 1 });
    prismaService.careRecord.findUniqueOrThrow.mockResolvedValue(
      buildCareRow({ content: '补录说明', seq: 1 }),
    );

    const response = await request(app.getHttpServer())
      .patch('/api/space-care-records/35')
      .send({ content: '补录说明', photos: ['https://cdn.example.com/2.jpg'] })
      .expect(200);

    expect(prismaService.careRecord.updateMany).toHaveBeenCalledWith({
      where: { id: 35, storeId: 18 },
      data: {
        content: '补录说明',
        photos: ['https://cdn.example.com/2.jpg'],
        updatedByStaffId: 7,
      },
    });
    // 只读快照字段原样回传，未被入参污染
    expect(response.body.seq).toBe(1);
    expect(response.body.amountYuan).toBe(298.5);
  });

  it('PATCH /api/space-care-records/:recordId 传入只读字段时以 400 拒绝', async () => {
    await request(app.getHttpServer())
      .patch('/api/space-care-records/35')
      .send({ content: 'x', photos: [], seq: 99, amountCents: 1 })
      .expect(400);

    expect(prismaService.careRecord.updateMany).not.toHaveBeenCalled();
  });

  it('GET /api/club/care-records 只返回会员本人记录，且不含商家内部字段', async () => {
    prismaService.careRecord.findMany.mockResolvedValue([buildCareRow()]);
    prismaService.careRecord.count.mockResolvedValue(3);

    const response = await request(app.getHttpServer())
      .get('/api/club/care-records')
      .expect(200);

    expect(
      clubMemberProfileService.getSnapshotByStoreIdentity,
    ).toHaveBeenCalledWith(11, 201, '13800138000');
    expect(prismaService.careRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { storeId: 11, customerId: 55 } }),
    );
    expect(response.body.meta).toEqual({
      page: 1,
      pageSize: 10,
      total: 3,
      totalPages: 1,
    });
    expect(Object.keys(response.body.items[0]).sort()).toEqual([
      'amountYuan',
      'content',
      'id',
      'photos',
      'seq',
      'serviceName',
      'technicianName',
      'visitAt',
    ]);
  });

  it('GET /api/club/care-records 换身份后只能读到本人档案（无法指定 customerId）', async () => {
    clubMemberProfileService.getSnapshotByStoreIdentity.mockResolvedValue({
      customerId: 77,
    });
    prismaService.careRecord.findMany.mockResolvedValue([
      buildCareRow({ id: 91, customerId: 77, seq: 4 }),
    ]);
    prismaService.careRecord.count.mockResolvedValue(1);

    const response = await request(app.getHttpServer())
      .get('/api/club/care-records')
      .expect(200);

    expect(prismaService.careRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { storeId: 11, customerId: 77 } }),
    );
    expect(response.body.items[0]).toEqual(
      expect.objectContaining({ id: '91', seq: 4 }),
    );
  });

  it('GET /api/club/care-records 页码超上限时以 400 拒绝（防深翻页放大）', async () => {
    await request(app.getHttpServer())
      .get('/api/club/care-records')
      .query({ page: 1001 })
      .expect(400);

    expect(prismaService.careRecord.findMany).not.toHaveBeenCalled();
  });

  it('GET /api/club/care-records 非本店会员返回空列表', async () => {
    clubMemberProfileService.getSnapshotByStoreIdentity.mockResolvedValue(null);

    const response = await request(app.getHttpServer())
      .get('/api/club/care-records')
      .expect(200);

    // 非本店会员同样走完整响应契约：空 items + 空首尾 + 分页元信息
    expect(response.body).toEqual({
      items: [],
      compareRange: { earliest: null, latest: null },
      meta: { page: 1, pageSize: 10, total: 0, totalPages: 1 },
    });
    expect(prismaService.careRecord.findMany).not.toHaveBeenCalled();
  });

  describe('未开通会员护理档案的门店（非 SPA/养生/美容 模式）', () => {
    it('GET /api/club/care-records 返回 403（后端不运行该功能）', async () => {
      clubCurrentStoreContextService.resolveCurrentContext.mockResolvedValue({
        user: { id: 201, phone: '13800138000' },
        store: { id: 11, memberCareEnabled: false },
      });

      await request(app.getHttpServer())
        .get('/api/club/care-records')
        .expect(403);

      expect(prismaService.careRecord.findMany).not.toHaveBeenCalled();
    });

    it('GET /api/space-care-records/customers 返回 403（档位断言在取数之前）', async () => {
      storeBusinessCapabilityService.ensureMemberCareAccess.mockRejectedValue(
        new ForbiddenException(
          '会员护理档案仅适用于「SPA/养生/美容/」模式的门店',
        ),
      );

      await request(app.getHttpServer())
        .get('/api/space-care-records/customers')
        .expect(403);

      expect(commerceAccessService.resolveViewStoreId).not.toHaveBeenCalled();
      expect(prismaService.marketingCustomer.findMany).not.toHaveBeenCalled();
    });
  });
});

import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { StoreBusinessCapabilityService } from '../../stores/store-business-capability.service';
import { PrismaService } from '../../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { UpdateSpaceCareRecordDto } from './dto/space-care-record.dto';
import { toSpaceCareRecordDto } from './space-care-record.mapper';
import { SpaceCareRecordsService } from './space-care-records.service';

const buildUser = (): AuthenticatedUser =>
  ({
    id: 1,
    email: 'owner@test',
    phone: '13900000001',
    name: '店长',
    createdAt: new Date(),
    updatedAt: new Date(),
    lastActiveAt: null,
    currentMembership: { staffId: 7, storeId: 18 },
  }) as unknown as AuthenticatedUser;

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

const CARE_ROW = {
  id: 35,
  customerId: 55,
  sessionId: 9,
  seq: 2,
  visitAt: new Date(1_761_100_000_000),
  serviceName: '深层清洁',
  amountCents: 29_850,
  content: '本次做了深层清洁',
  photos: ['https://cdn.example.com/1.jpg'],
  technicianName: null,
  updatedAt: new Date(1_761_100_360_000),
};

/** 时间线默认页大小（与 service 内 CARE_RECORD_DEFAULT_PAGE_SIZE 保持一致） */
const CARE_RECORD_PAGE_SIZE = 10;

describe('SpaceCareRecordsService', () => {
  let service: SpaceCareRecordsService;

  const prismaService = {
    marketingCustomer: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
    },
    careRecord: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      updateMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    // 保留仅为断言「顾客档案相关聚合不再被调用」
    marketingConsumption: { aggregate: jest.fn(), count: jest.fn() },
    $queryRaw: jest.fn(),
  };

  const commerceAccessService = {
    resolveViewStoreId: jest.fn(),
    resolveSingleStoreId: jest.fn(),
  };

  /** 门店能力服务：默认按「SPA/养生/美容/」模式（已开通护理档案）放行 */
  const storeBusinessCapabilityService = {
    ensureMemberCareAccess: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    commerceAccessService.resolveViewStoreId.mockResolvedValue(18);
    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    storeBusinessCapabilityService.ensureMemberCareAccess.mockResolvedValue(
      undefined,
    );
    // 默认没有任何带照片的记录：效果对比首尾为 null
    prismaService.careRecord.findFirst.mockResolvedValue(null);
    // 默认顾客摘要查不到（跨店 / 已删除），详情仍可正常返回
    prismaService.marketingCustomer.findFirst.mockResolvedValue(null);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SpaceCareRecordsService,
        { provide: PrismaService, useValue: prismaService },
        { provide: CommerceAccessService, useValue: commerceAccessService },
        {
          provide: StoreBusinessCapabilityService,
          useValue: storeBusinessCapabilityService,
        },
      ],
    }).compile();

    service = module.get<SpaceCareRecordsService>(SpaceCareRecordsService);
  });

  describe('listCustomers', () => {
    it('门店不可见时返回空列表而非报错', async () => {
      commerceAccessService.resolveViewStoreId.mockResolvedValue(null);

      await expect(
        service.listCustomers(buildUser(), { status: 'all' }),
      ).resolves.toEqual({
        items: [],
        meta: { page: 1, pageSize: 20, total: 0, totalPages: 1 },
      });
      expect(prismaService.marketingCustomer.findMany).not.toHaveBeenCalled();
    });

    it('查询条件必须带 storeId 与 deletedAt: null', async () => {
      prismaService.marketingCustomer.findMany.mockResolvedValue([]);
      prismaService.marketingCustomer.count.mockResolvedValue(0);

      await service.listCustomers(buildUser(), { status: 'all' });

      expect(prismaService.marketingCustomer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ storeId: 18, deletedAt: null }),
        }),
      );
    });

    it('金额按分→元输出、时间按毫秒输出', async () => {
      prismaService.marketingCustomer.findMany.mockResolvedValue([
        CUSTOMER_ROW,
      ]);
      prismaService.marketingCustomer.count.mockResolvedValue(1);

      const result = await service.listCustomers(buildUser(), {
        status: 'all',
      });

      expect(result.items[0]).toMatchObject({
        id: '55',
        phone: '13800138000',
        balance: 500,
        totalSpent: 1580,
        registeredAt: 1_700_000_000_000,
        lastVisitAt: 1_761_000_000_000,
      });
    });
  });

  describe('getCustomerDetail', () => {
    it('一次返回按 visitAt 倒序的第一页时间线与对比首尾', async () => {
      prismaService.careRecord.findMany.mockResolvedValue([CARE_ROW]);
      prismaService.careRecord.count.mockResolvedValue(1);

      const result = await service.getCustomerDetail(buildUser(), 55);

      expect(result.items).toHaveLength(1);
      expect(result.meta).toEqual({
        page: 1,
        pageSize: CARE_RECORD_PAGE_SIZE,
        total: 1,
        totalPages: 1,
      });
      expect(prismaService.careRecord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { storeId: 18, customerId: 55 },
          orderBy: [{ visitAt: 'desc' }, { id: 'desc' }],
          skip: 0,
          take: CARE_RECORD_PAGE_SIZE,
        }),
      );
    });

    it('按 page / pageSize 换算 skip 与 take（真分页）', async () => {
      prismaService.careRecord.findMany.mockResolvedValue([]);
      prismaService.careRecord.count.mockResolvedValue(25);

      const result = await service.getCustomerDetail(buildUser(), 55, {
        page: 3,
        pageSize: 10,
      });

      expect(prismaService.careRecord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
      expect(result.meta).toEqual({
        page: 3,
        pageSize: 10,
        total: 25,
        totalPages: 3,
      });
    });

    it('效果对比首尾只取「已补录照片」的最早 / 最近一次', async () => {
      prismaService.careRecord.findMany.mockResolvedValue([]);
      prismaService.careRecord.count.mockResolvedValue(0);
      prismaService.careRecord.findFirst
        .mockResolvedValueOnce({ ...CARE_ROW, id: 11, seq: 1 })
        .mockResolvedValueOnce({ ...CARE_ROW, id: 99, seq: 12 });

      const result = await service.getCustomerDetail(buildUser(), 55);

      expect(result.compareRange).toEqual({
        earliest: toSpaceCareRecordDto({ ...CARE_ROW, id: 11, seq: 1 }),
        latest: toSpaceCareRecordDto({ ...CARE_ROW, id: 99, seq: 12 }),
      });
      // 首尾查询各自 LIMIT 1：最早升序、最近降序，且只认有照片的记录
      expect(prismaService.careRecord.findFirst).toHaveBeenNthCalledWith(1, {
        where: { storeId: 18, customerId: 55, photos: { isEmpty: false } },
        orderBy: [{ visitAt: 'asc' }, { id: 'asc' }],
        select: expect.any(Object),
      });
      expect(prismaService.careRecord.findFirst).toHaveBeenNthCalledWith(2, {
        where: { storeId: 18, customerId: 55, photos: { isEmpty: false } },
        orderBy: [{ visitAt: 'desc' }, { id: 'desc' }],
        select: expect.any(Object),
      });
    });

    it('没有任何带照片的记录时对比首尾为 null', async () => {
      prismaService.careRecord.findMany.mockResolvedValue([]);
      prismaService.careRecord.count.mockResolvedValue(0);

      const result = await service.getCustomerDetail(buildUser(), 55);

      expect(result.compareRange).toEqual({ earliest: null, latest: null });
    });

    it('详情接口翻页时不再计算对比首尾（与 C 端同口径，前端沿用首屏结果）', async () => {
      prismaService.careRecord.findMany.mockResolvedValue([]);
      prismaService.careRecord.count.mockResolvedValue(25);

      const result = await service.getCustomerDetail(buildUser(), 55, {
        page: 3,
        pageSize: 10,
      });

      expect(result.compareRange).toBeUndefined();
      expect(result.customer).toBeUndefined();
      expect(prismaService.careRecord.findFirst).not.toHaveBeenCalled();
      // 顾客摘要只在首屏下发，翻页不再多打一条顾客查询
      expect(prismaService.marketingCustomer.findFirst).not.toHaveBeenCalled();
    });

    it('第 1 页附顾客摘要（仅 id / 昵称 / 头像），不查余额与消费统计', async () => {
      prismaService.careRecord.findMany.mockResolvedValue([]);
      prismaService.careRecord.count.mockResolvedValue(0);
      prismaService.marketingCustomer.findFirst.mockResolvedValue({
        id: 55,
        name: '纯利会员4010',
        avatar: null,
      });

      const result = await service.getCustomerDetail(buildUser(), 55);

      expect(result.customer).toEqual({ id: '55', name: '纯利会员4010' });
      expect(prismaService.marketingCustomer.findFirst).toHaveBeenCalledWith({
        where: { id: 55, storeId: 18, deletedAt: null },
        select: { id: true, name: true, avatar: true },
      });
      // 英雄卡口径（余额 / 积分 / 累计充值）仍归营销域顾客详情
      expect(prismaService.$queryRaw).not.toHaveBeenCalled();
      expect(
        prismaService.marketingConsumption.aggregate,
      ).not.toHaveBeenCalled();
    });

    it('顾客摘要查不到时不影响详情返回', async () => {
      prismaService.careRecord.findMany.mockResolvedValue([CARE_ROW]);
      prismaService.careRecord.count.mockResolvedValue(1);

      const result = await service.getCustomerDetail(buildUser(), 999);

      expect(result.customer).toBeUndefined();
      expect(result.items).toHaveLength(1);
      expect(Object.keys(result).sort()).toEqual([
        'compareRange',
        'customer',
        'items',
        'meta',
      ]);
    });

    it('跨店顾客按「查不到记录」处理（防跨店越权靠查询条件）', async () => {
      prismaService.careRecord.findMany.mockResolvedValue([]);
      prismaService.careRecord.count.mockResolvedValue(0);

      const result = await service.getCustomerDetail(buildUser(), 999);

      expect(prismaService.careRecord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { storeId: 18, customerId: 999 } }),
      );
      expect(result.items).toEqual([]);
    });
  });

  describe('listCustomerRecords', () => {
    it('翻页只查记录，按 visitAt 倒序并返回分页元信息', async () => {
      prismaService.careRecord.findMany.mockResolvedValue([CARE_ROW]);
      prismaService.careRecord.count.mockResolvedValue(21);

      const result = await service.listCustomerRecords(buildUser(), 55, {
        page: 2,
        pageSize: 10,
      });

      expect(prismaService.careRecord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { storeId: 18, customerId: 55 },
          orderBy: [{ visitAt: 'desc' }, { id: 'desc' }],
          skip: 10,
          take: 10,
        }),
      );
      expect(result.items).toHaveLength(1);
      expect(result.meta).toEqual({
        page: 2,
        pageSize: 10,
        total: 21,
        totalPages: 3,
      });
    });

    it('跨店顾客查不到记录（不做顾客存在性校验）', async () => {
      prismaService.careRecord.findMany.mockResolvedValue([]);
      prismaService.careRecord.count.mockResolvedValue(0);

      const result = await service.listCustomerRecords(buildUser(), 55, {});

      expect(prismaService.careRecord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { storeId: 18, customerId: 55 },
          skip: 0,
          take: CARE_RECORD_PAGE_SIZE,
        }),
      );
      expect(result.items).toEqual([]);
    });
  });

  describe('updateRecord', () => {
    it('只写 content / photos 与审计操作人，其余字段不改', async () => {
      prismaService.careRecord.updateMany.mockResolvedValue({ count: 1 });
      prismaService.careRecord.findUniqueOrThrow.mockResolvedValue(CARE_ROW);

      const result = await service.updateRecord(buildUser(), 35, {
        content: '补录说明',
        photos: ['https://cdn.example.com/2.jpg'],
      });

      expect(prismaService.careRecord.updateMany).toHaveBeenCalledWith({
        where: { id: 35, storeId: 18 },
        data: {
          content: '补录说明',
          photos: ['https://cdn.example.com/2.jpg'],
          updatedByStaffId: 7,
        },
      });
      expect(result.amountYuan).toBe(298.5);
      expect(result.seq).toBe(2);
    });

    it('影响行数为 0 视为跨店越权，抛 404', async () => {
      prismaService.careRecord.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.updateRecord(buildUser(), 35, {
          content: 'x',
          photos: [],
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('会员护理档案档位门禁', () => {
    it('未开通门店调用 listCustomers 直接被拒（service 层兜底）', async () => {
      storeBusinessCapabilityService.ensureMemberCareAccess.mockRejectedValue(
        new ForbiddenException(
          '会员护理档案仅适用于「SPA/养生/美容/」模式的门店',
        ),
      );

      await expect(
        service.listCustomers(buildUser(), { status: 'all' }),
      ).rejects.toThrow('会员护理档案仅适用于「SPA/养生/美容/」模式的门店');
      expect(commerceAccessService.resolveViewStoreId).not.toHaveBeenCalled();
    });

    it('未开通门店调用补录直接被拒', async () => {
      storeBusinessCapabilityService.ensureMemberCareAccess.mockRejectedValue(
        new ForbiddenException(
          '会员护理档案仅适用于「SPA/养生/美容/」模式的门店',
        ),
      );

      await expect(
        service.updateRecord(buildUser(), 35, { content: 'x', photos: [] }),
      ).rejects.toThrow('会员护理档案仅适用于「SPA/养生/美容/」模式的门店');
      expect(commerceAccessService.resolveSingleStoreId).not.toHaveBeenCalled();
    });

    it('已开通门店取数前先过档位断言', async () => {
      storeBusinessCapabilityService.ensureMemberCareAccess.mockResolvedValue(
        undefined,
      );

      await service.listCustomers(buildUser(), { status: 'all' });

      expect(
        storeBusinessCapabilityService.ensureMemberCareAccess,
      ).toHaveBeenCalledTimes(1);
    });
  });
});

describe('UpdateSpaceCareRecordDto 白名单', () => {
  it('未声明字段（seq / amountCents / customerId）被 whitelist 剥离', async () => {
    const dto = plainToInstance(UpdateSpaceCareRecordDto, {
      content: '补录说明',
      photos: ['https://cdn.example.com/2.jpg'],
      seq: 99,
      amountCents: 1,
      customerId: 1,
      visitAt: 1,
    });

    const errors = await validate(dto, { whitelist: true });

    expect(errors).toHaveLength(0);
    expect(Object.keys(dto).sort()).toEqual(['content', 'photos']);
  });

  it('护理说明超长时被拒绝', async () => {
    const dto = plainToInstance(UpdateSpaceCareRecordDto, {
      content: 'x'.repeat(501),
      photos: [],
    });

    await expect(validate(dto)).resolves.toHaveLength(1);
  });

  it('照片列表含空串时被拒绝（防止无图记录污染对比首尾）', async () => {
    const dto = plainToInstance(UpdateSpaceCareRecordDto, {
      content: '补录说明',
      photos: ['https://cdn.example.com/1.jpg', ''],
    });

    await expect(validate(dto)).resolves.toHaveLength(1);
  });

  it('空照片数组合法（允许清空照片）', async () => {
    const dto = plainToInstance(UpdateSpaceCareRecordDto, {
      content: '补录说明',
      photos: [],
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });
});

describe('toSpaceCareRecordDto', () => {
  it('id 为字符串、金额分转元、时间转毫秒', () => {
    expect(toSpaceCareRecordDto(CARE_ROW)).toEqual({
      id: '35',
      customerId: '55',
      seq: 2,
      visitAt: 1_761_100_000_000,
      serviceName: '深层清洁',
      amountYuan: 298.5,
      content: '本次做了深层清洁',
      photos: ['https://cdn.example.com/1.jpg'],
      updatedAt: 1_761_100_360_000,
    });
  });

  it('无技师时不输出 technicianName 字段', () => {
    expect(toSpaceCareRecordDto(CARE_ROW)).not.toHaveProperty('technicianName');
  });
});

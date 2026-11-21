import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { RefreshableCacheService } from '../../../redis/refreshable-cache.service';
import { RedisService } from '../../../redis/redis.service';
import { CacheInvalidatorService } from '../../../redis/invalidator';
import { SpaceZonesService } from './space-zones.service';

/**
 * 空间区域列表：与空间类型同源策略，覆盖缓存接入后的关键边界
 * （读路径统一走可刷新缓存、TTL 语义不变、写路径仍然失效）。
 */
describe('SpaceZonesService 列表缓存', () => {
  let service: SpaceZonesService;

  const prismaService = {
    spaceZone: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findUnique: jest.fn(),
    },
    space: {
      findFirst: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  /** 删除走交互式事务：行锁 + 引用复检 + 删除共用同一个 tx */
  const createTransaction = () => {
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 201 }]),
      space: { findFirst: jest.fn().mockResolvedValue(null) },
      spaceZone: { delete: jest.fn().mockResolvedValue({}) },
    };
    prismaService.$transaction.mockImplementation(
      async (callback: (tx: typeof transaction) => Promise<void>) =>
        callback(transaction),
    );
    return transaction;
  };

  const commerceAccessService = {
    resolveViewStoreId: jest.fn(),
    resolveSingleStoreId: jest.fn(),
    ensureCanAccessStore: jest.fn(),
  };

  const redisService = {
    del: jest.fn(),
  };

  // 区域改名会改变空间列表/看板里的区域名快照，写路径需要同步失效空间读缓存
  const cacheInvalidatorService = {
    invalidateSpacesReadCaches: jest.fn(),
  };

  const refreshableCacheService = {
    getOrLoadRefreshableJson: jest.fn(
      async (options: { loadValue: () => Promise<unknown> }) =>
        options.loadValue(),
    ),
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

  const makeZoneRow = (overrides: Record<string, unknown> = {}) => ({
    id: 201,
    storeId: 18,
    name: '一楼',
    createdAt: new Date('2026-05-18T10:00:00.000Z'),
    updatedAt: new Date('2026-05-18T10:10:00.000Z'),
    ...overrides,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    commerceAccessService.resolveViewStoreId.mockResolvedValue(18);
    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    commerceAccessService.ensureCanAccessStore.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SpaceZonesService,
        { provide: PrismaService, useValue: prismaService },
        { provide: CommerceAccessService, useValue: commerceAccessService },
        { provide: RedisService, useValue: redisService },
        {
          provide: RefreshableCacheService,
          useValue: refreshableCacheService,
        },
        {
          provide: CacheInvalidatorService,
          useValue: cacheInvalidatorService,
        },
      ],
    }).compile();

    service = module.get<SpaceZonesService>(SpaceZonesService);
  });

  it('无权访问任何门店时返回空数组且不触达缓存/DB', async () => {
    commerceAccessService.resolveViewStoreId.mockResolvedValueOnce(null);

    const result = await service.listSpaceZones(user, {});

    expect(result).toEqual([]);
    expect(
      refreshableCacheService.getOrLoadRefreshableJson,
    ).not.toHaveBeenCalled();
    expect(prismaService.spaceZone.findMany).not.toHaveBeenCalled();
  });

  it('未命中时回源 DB，并按 60s TTL / 20s 提前刷新接入可刷新缓存', async () => {
    prismaService.spaceZone.findMany.mockResolvedValueOnce([makeZoneRow()]);

    const result = await service.listSpaceZones(user, {});

    expect(result).toEqual([
      {
        id: '201',
        name: '一楼',
        createdAt: Date.parse('2026-05-18T10:00:00.000Z'),
        updatedAt: Date.parse('2026-05-18T10:10:00.000Z'),
      },
    ]);
    expect(prismaService.spaceZone.findMany).toHaveBeenCalledWith({
      where: { storeId: 18 },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    expect(
      refreshableCacheService.getOrLoadRefreshableJson,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        cacheKey: 'profit:space-zones:store:18',
        taskKey: expect.stringContaining('profit:space-zones:store:18'),
        ttlSeconds: 60,
        refreshAfterMs: 20_000,
      }),
    );
  });

  it('命中缓存时不回源 DB', async () => {
    const cachedZones = [
      {
        id: '201',
        name: '一楼',
        createdAt: 1,
        updatedAt: 2,
      },
    ];
    refreshableCacheService.getOrLoadRefreshableJson.mockResolvedValueOnce(
      cachedZones,
    );

    const result = await service.listSpaceZones(user, {});

    expect(result).toBe(cachedZones);
    expect(prismaService.spaceZone.findMany).not.toHaveBeenCalled();
  });

  it('创建成功后精确删除门店空间区域缓存', async () => {
    prismaService.spaceZone.findFirst.mockResolvedValueOnce(null);
    prismaService.spaceZone.create.mockResolvedValueOnce(makeZoneRow());

    await service.createSpaceZone(user, { name: '一楼' });

    expect(redisService.del).toHaveBeenCalledWith(
      'profit:space-zones:store:18',
    );
  });

  it('缓存失效失败不把已落库的创建报成失败', async () => {
    prismaService.spaceZone.findFirst.mockResolvedValueOnce(null);
    prismaService.spaceZone.create.mockResolvedValueOnce(makeZoneRow());
    redisService.del.mockRejectedValueOnce(new Error('redis down'));

    await expect(
      service.createSpaceZone(user, { name: '一楼' }),
    ).resolves.toMatchObject({ id: '201', name: '一楼' });
  });

  it('更新成功后精确失效区域缓存并清理空间读缓存', async () => {
    prismaService.spaceZone.findUnique.mockResolvedValueOnce(makeZoneRow());
    prismaService.spaceZone.update.mockResolvedValueOnce(
      makeZoneRow({ name: '二楼' }),
    );

    await service.updateSpaceZone(user, 201, { name: '二楼' });

    expect(redisService.del).toHaveBeenCalledWith(
      'profit:space-zones:store:18',
    );
    // 空间列表/看板缓存内嵌 zone.name，改名后必须一并失效，否则看板陈旧
    expect(
      cacheInvalidatorService.invalidateSpacesReadCaches,
    ).toHaveBeenCalledWith(18);
  });

  it('并发改名撞唯一约束时返回 409，而不是透传 500', async () => {
    prismaService.spaceZone.findUnique.mockResolvedValueOnce(makeZoneRow());
    prismaService.spaceZone.update.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    await expect(service.updateSpaceZone(user, 201, { name: '二楼' })).rejects.toThrow(
      ConflictException,
    );
  });

  it('删除时在事务内锁定区域行并复检引用，再执行删除', async () => {
    const transaction = createTransaction();
    prismaService.spaceZone.findUnique.mockResolvedValueOnce({
      id: 201,
      storeId: 18,
    });

    await service.removeSpaceZone(user, 201);

    expect(transaction.$queryRaw).toHaveBeenCalledTimes(1);
    expect(transaction.space.findFirst).toHaveBeenCalledWith({
      where: { zoneId: 201 },
      select: { id: true },
    });
    expect(transaction.spaceZone.delete).toHaveBeenCalledWith({
      where: { id: 201 },
    });
    expect(redisService.del).toHaveBeenCalledWith(
      'profit:space-zones:store:18',
    );
  });

  it('锁后复检到引用时返回 409 且不删除', async () => {
    const transaction = createTransaction();
    transaction.space.findFirst.mockResolvedValueOnce({ id: 7 });
    prismaService.spaceZone.findUnique.mockResolvedValueOnce({
      id: 201,
      storeId: 18,
    });

    await expect(service.removeSpaceZone(user, 201)).rejects.toThrow(
      ConflictException,
    );
    expect(transaction.spaceZone.delete).not.toHaveBeenCalled();
  });
});

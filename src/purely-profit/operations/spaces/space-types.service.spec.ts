import { Test, TestingModule } from '@nestjs/testing';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { RefreshableCacheService } from '../../../redis/refreshable-cache.service';
import { RedisService } from '../../../redis/redis.service';
import { CacheInvalidatorService } from '../../../redis/invalidator';
import { SpaceTypesService } from './space-types.service';

/**
 * 空间类型列表：覆盖「缓存接入」这一改动的关键边界。
 *
 * 重点不是重复验证 DB 映射，而是保证：
 * - 读路径不再手写 getJson/setJson，统一走 RefreshableCacheService（含单飞与后台刷新）；
 * - TTL 保持 60s 业务语义，提前刷新窗口 20s；
 * - 写路径仍然按 pattern 失效，否则会出现跨写读旧值。
 */
describe('SpaceTypesService 列表缓存', () => {
  let service: SpaceTypesService;

  const prismaService = {
    spaceType: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findUnique: jest.fn(),
    },
  };

  const commerceAccessService = {
    resolveViewStoreId: jest.fn(),
    resolveSingleStoreId: jest.fn(),
    ensureCanAccessStore: jest.fn(),
  };

  const redisService = {
    delByPattern: jest.fn(),
  };

  // 类型改名会改变空间列表/看板里的类型名快照，写路径需要同步失效空间读缓存
  const cacheInvalidatorService = {
    invalidateSpacesReadCaches: jest.fn(),
  };

  // 缓存 mock：默认透传 loadValue，模拟「未命中走回源」；
  // 命中用例在单个测试里改写为直接返回缓存值。
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

  const makeTypeRow = (overrides: Record<string, unknown> = {}) => ({
    id: 101,
    storeId: 18,
    name: '台球台',
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
        SpaceTypesService,
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

    service = module.get<SpaceTypesService>(SpaceTypesService);
  });

  it('无权访问任何门店时返回空数组且不触达缓存/DB', async () => {
    commerceAccessService.resolveViewStoreId.mockResolvedValueOnce(null);

    const result = await service.listSpaceTypes(user, {});

    expect(result).toEqual([]);
    expect(
      refreshableCacheService.getOrLoadRefreshableJson,
    ).not.toHaveBeenCalled();
    expect(prismaService.spaceType.findMany).not.toHaveBeenCalled();
  });

  it('未命中时回源 DB，并按 60s TTL / 20s 提前刷新接入可刷新缓存', async () => {
    prismaService.spaceType.findMany.mockResolvedValueOnce([makeTypeRow()]);

    const result = await service.listSpaceTypes(user, {});

    expect(result).toEqual([
      {
        id: '101',
        name: '台球台',
        createdAt: Date.parse('2026-05-18T10:00:00.000Z'),
        updatedAt: Date.parse('2026-05-18T10:10:00.000Z'),
      },
    ]);
    expect(prismaService.spaceType.findMany).toHaveBeenCalledWith({
      where: { storeId: 18 },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    expect(
      refreshableCacheService.getOrLoadRefreshableJson,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        cacheKey: 'profit:space-types:store:18',
        taskKey: expect.stringContaining('profit:space-types:store:18'),
        ttlSeconds: 60,
        refreshAfterMs: 20_000,
      }),
    );
  });

  it('命中缓存时不回源 DB', async () => {
    const cachedTypes = [
      {
        id: '101',
        name: '台球台',
        createdAt: 1,
        updatedAt: 2,
      },
    ];
    refreshableCacheService.getOrLoadRefreshableJson.mockResolvedValueOnce(
      cachedTypes,
    );

    const result = await service.listSpaceTypes(user, {});

    expect(result).toBe(cachedTypes);
    expect(prismaService.spaceType.findMany).not.toHaveBeenCalled();
  });

  it('创建成功后按 pattern 失效门店空间类型缓存', async () => {
    prismaService.spaceType.findFirst.mockResolvedValueOnce(null);
    prismaService.spaceType.create.mockResolvedValueOnce(makeTypeRow());

    await service.createSpaceType(user, { name: '台球台' });

    expect(redisService.delByPattern).toHaveBeenCalledWith(
      'profit:space-types:store:18',
    );
  });

  it('更新成功后按 pattern 失效门店空间类型缓存', async () => {
    prismaService.spaceType.findUnique.mockResolvedValueOnce(makeTypeRow());
    prismaService.spaceType.update.mockResolvedValueOnce(
      makeTypeRow({ name: '斯诺克台' }),
    );

    await service.updateSpaceType(user, 101, { name: '斯诺克台' });

    expect(redisService.delByPattern).toHaveBeenCalledWith(
      'profit:space-types:store:18',
    );
    // 空间列表/看板缓存内嵌 type.name，改名后必须一并失效，否则看板陈旧
    expect(
      cacheInvalidatorService.invalidateSpacesReadCaches,
    ).toHaveBeenCalledWith(18);
  });
});

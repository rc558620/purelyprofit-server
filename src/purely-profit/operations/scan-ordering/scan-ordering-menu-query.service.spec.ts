import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { RedisService } from '../../../redis/redis.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { ScanOrderingMenuCategoryService } from './scan-ordering-menu-category.service';
import { ScanOrderingMenuQueryService } from './scan-ordering-menu-query.service';

describe('商家扫码点餐菜单缓存', () => {
  let queryService: ScanOrderingMenuQueryService;
  let categoryService: ScanOrderingMenuCategoryService;

  const user = { id: 1 } as AuthenticatedUser;
  const prisma = {
    scanOrderingMenuCategory: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    scanOrderingMenuProduct: { count: jest.fn() },
  };
  const commerceAccess = { resolveSingleStoreId: jest.fn() };
  const redis = {
    getJson: jest.fn(),
    setJson: jest.fn(),
    del: jest.fn(),
    delByPattern: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    commerceAccess.resolveSingleStoreId.mockResolvedValue(11);
    redis.getJson.mockResolvedValue(null);
    redis.setJson.mockResolvedValue(undefined);
    redis.del.mockResolvedValue(1);
    redis.delByPattern.mockResolvedValue(0);
    prisma.scanOrderingMenuCategory.findMany.mockResolvedValue([]);
    prisma.scanOrderingMenuCategory.findUnique.mockResolvedValue(null);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScanOrderingMenuQueryService,
        ScanOrderingMenuCategoryService,
        { provide: PrismaService, useValue: prisma },
        { provide: CommerceAccessService, useValue: commerceAccess },
        { provide: RedisService, useValue: redis },
      ],
    }).compile();
    queryService = module.get(ScanOrderingMenuQueryService);
    categoryService = module.get(ScanOrderingMenuCategoryService);
  });

  it('缓存命中时不查库，且 key 按门店隔离', async () => {
    const cached = [{ id: 1, name: '热销', sortOrder: 0, isActive: true }];
    redis.getJson.mockResolvedValue(cached);

    const result = await queryService.listMenu(user);

    expect(result).toBe(cached);
    expect(redis.getJson).toHaveBeenCalledWith('scanordering:menu:11');
    expect(prisma.scanOrderingMenuCategory.findMany).not.toHaveBeenCalled();
  });

  it('缓存未命中时并发请求共用一次回源（singleflight）', async () => {
    let resolveQuery: (value: unknown[]) => void = () => undefined;
    prisma.scanOrderingMenuCategory.findMany.mockImplementation(
      () =>
        new Promise<unknown[]>((resolve) => {
          resolveQuery = resolve;
        }),
    );

    const first = queryService.listMenu(user);
    const second = queryService.listMenu(user);
    // 让两次 getJson 都完成并进入 loadMenuOnce，再放行回源
    await new Promise((resolve) => setImmediate(resolve));
    resolveQuery([]);
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult).toBe(secondResult);
    expect(prisma.scanOrderingMenuCategory.findMany).toHaveBeenCalledTimes(1);
    expect(redis.setJson).toHaveBeenCalledWith('scanordering:menu:11', [], 60);
  });

  it('失效时同时清理商家菜单、C 端菜单与 C 端版本缓存', async () => {
    await queryService.invalidateMenuCache(11);

    expect(redis.del).toHaveBeenCalledWith('scanordering:menu:11');
    expect(redis.delByPattern).toHaveBeenCalledWith('club:menu:store:11:v:*');
    expect(redis.del).toHaveBeenCalledWith('club:menu-version:store:11');
  });

  it('Redis 读失败时降级回源，菜单仍可用', async () => {
    redis.getJson.mockRejectedValue(new Error('redis unavailable'));

    const result = await queryService.listMenu(user);

    expect(result).toEqual([]);
    expect(prisma.scanOrderingMenuCategory.findMany).toHaveBeenCalledTimes(1);
  });

  it('分类创建成功后触发缓存失效', async () => {
    prisma.scanOrderingMenuCategory.create.mockResolvedValue({
      id: 9,
      name: '新品',
      sortOrder: 0,
      isActive: true,
    });
    const invalidate = jest
      .spyOn(queryService, 'invalidateMenuCache')
      .mockResolvedValue(undefined);

    await categoryService.createCategory(user, { name: '新品' } as never);

    expect(invalidate).toHaveBeenCalledWith(11);
  });

  it('写操作失败（分类重名）时不触发缓存失效', async () => {
    prisma.scanOrderingMenuCategory.findUnique.mockResolvedValue({ id: 3 });
    const invalidate = jest
      .spyOn(queryService, 'invalidateMenuCache')
      .mockResolvedValue(undefined);

    await expect(
      categoryService.createCategory(user, { name: '重复' } as never),
    ).rejects.toThrow('扫码点餐菜单分类已存在');
    expect(invalidate).not.toHaveBeenCalled();
  });
});

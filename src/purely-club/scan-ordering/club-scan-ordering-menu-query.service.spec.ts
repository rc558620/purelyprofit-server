import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { ClubScanOrderingMenuQueryService } from './club-scan-ordering-menu-query.service';
import { ClubScanOrderingMenuStockService } from './club-scan-ordering-menu-stock.service';

describe('ClubScanOrderingMenuQueryService', () => {
  let service: ClubScanOrderingMenuQueryService;

  const prisma = {
    scanOrderingSession: { findFirst: jest.fn() },
    scanOrderingMenuCategory: { findMany: jest.fn() },
    scanOrderingMenuProduct: { findMany: jest.fn() },
    scanOrderingSpecOption: { findMany: jest.fn() },
    $queryRaw: jest.fn(),
  };
  const redisService = {
    get: jest.fn(),
    getJson: jest.fn(),
    set: jest.fn(),
    setJson: jest.fn(),
    del: jest.fn(),
  };
  const user = { id: 7 } as AuthenticatedUser;

  const categoryQuery = (): Record<string, unknown> =>
    prisma.scanOrderingMenuCategory.findMany.mock.calls[0][0] as Record<
      string,
      unknown
    >;

  const menuProductRow = (
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> => ({
    id: 11,
    categoryId: 3,
    name: '柠檬茶',
    description: '少冰',
    imageUrl: 'menu.png',
    basePrice: 1200,
    stockMode: 'finite',
    product: null,
    specGroups: [
      {
        id: 21,
        name: '规格',
        selectionType: 'single',
        minSelections: 1,
        maxSelections: 1,
        options: [
          {
            id: 31,
            name: '大杯',
            extraPrice: 300,
            isDefault: true,
            isActive: true,
          },
        ],
      },
    ],
    ...overrides,
  });

  const categoryRow = (
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> => ({
    id: 3,
    name: '茶饮',
    sortOrder: 1,
    products: [menuProductRow()],
    ...overrides,
  });

  /** 静态菜单缓存命中判定：只有菜单 key 走 getJson 的「已缓存」分支。 */
  const cacheMenuOnly = (value: unknown): void => {
    redisService.getJson.mockImplementation((key: string) =>
      Promise.resolve(key.startsWith('club:menu:store:') ? value : null),
    );
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.scanOrderingSession.findFirst.mockResolvedValue({ storeId: 42 });
    prisma.scanOrderingMenuCategory.findMany.mockResolvedValue([categoryRow()]);
    prisma.scanOrderingMenuProduct.findMany.mockResolvedValue([
      {
        id: 11,
        stockQuantity: 10,
        reservedQuantity: 2,
        salesCount: 33,
        product: null,
      },
    ]);
    prisma.scanOrderingSpecOption.findMany.mockResolvedValue([
      { id: 31, stockQuantity: 5, reservedQuantity: 1 },
    ]);
    redisService.get.mockResolvedValue('version-1');
    cacheMenuOnly(null);
    redisService.set.mockResolvedValue(undefined);
    redisService.setJson.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClubScanOrderingMenuQueryService,
        ClubScanOrderingMenuStockService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redisService },
      ],
    }).compile();
    service = module.get(ClubScanOrderingMenuQueryService);
  });

  it('会话校验只投影 storeId，不把含 token/设备信息的整行读回内存', async () => {
    await service.getMenu(user, 9);

    const query = prisma.scanOrderingSession.findFirst.mock.calls[0][0];
    expect(query.select).toEqual({ storeId: true });
    expect(query.select).not.toHaveProperty('sessionTokenHash');
  });

  it('会话不可用时抛 403，不触发菜单查询', async () => {
    prisma.scanOrderingSession.findFirst.mockResolvedValue(null);

    await expect(service.getMenu(user, 9)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.scanOrderingMenuCategory.findMany).not.toHaveBeenCalled();
    expect(prisma.scanOrderingMenuProduct.findMany).not.toHaveBeenCalled();
  });

  it('菜单查询按白名单投影，整行非业务字段与动态列不再下发', async () => {
    await service.getMenu(user, 9);

    const select = categoryQuery().select as Record<string, unknown>;
    expect(Object.keys(select).sort()).toEqual([
      'id',
      'name',
      'products',
      'sortOrder',
    ]);

    const productSelect = (
      select.products as { select: Record<string, unknown> }
    ).select;
    // product 关系只用于「是否关联商品 / 图片兜底」，库存列已移出静态投影
    expect(productSelect).toHaveProperty('product');
    expect(productSelect).not.toHaveProperty('stockQuantity');
    expect(productSelect).not.toHaveProperty('reservedQuantity');
    expect(productSelect).not.toHaveProperty('salesCount');
    // 前端零命中的整行字段不得再出现
    expect(productSelect).not.toHaveProperty('storeId');
    expect(productSelect).not.toHaveProperty('isRecommended');
    expect(productSelect).not.toHaveProperty('availableFrom');
    expect(productSelect).not.toHaveProperty('version');
    expect(productSelect).not.toHaveProperty('createdAt');
    expect(productSelect).not.toHaveProperty('deletedAt');

    const groupSelect = (
      productSelect.specGroups as { select: Record<string, unknown> }
    ).select;
    expect(groupSelect).not.toHaveProperty('menuProductId');
    expect(groupSelect).not.toHaveProperty('sortOrder');

    const optionSelect = (
      groupSelect.options as { select: Record<string, unknown> }
    ).select;
    expect(optionSelect).not.toHaveProperty('groupId');
    expect(optionSelect).not.toHaveProperty('version');
    expect(optionSelect).not.toHaveProperty('stockQuantity');
  });

  it('响应字段集与前端 ScanOrderingMenuResponse 声明完全一致', async () => {
    const result = await service.getMenu(user, 9);

    expect(Object.keys(result).sort()).toEqual(['categories', 'menuVersion']);
    const [category] = result.categories;
    expect(Object.keys(category).sort()).toEqual([
      'id',
      'name',
      'products',
      'sortOrder',
    ]);

    const [product] = category.products;
    expect(Object.keys(product).sort()).toEqual([
      'basePrice',
      'categoryId',
      'description',
      'id',
      'imageUrl',
      'name',
      'salesCount',
      'specGroups',
      'stockMode',
      'stockQuantity',
    ]);

    expect(Object.keys(product.specGroups[0]).sort()).toEqual([
      'id',
      'maxSelections',
      'minSelections',
      'name',
      'options',
      'selectionType',
    ]);
    expect(Object.keys(product.specGroups[0].options[0]).sort()).toEqual([
      'extraPrice',
      'id',
      'isActive',
      'isDefault',
      'name',
      'stockQuantity',
    ]);
  });

  it('库存由 5s 快照覆盖：可用量扣预留、销量取快照', async () => {
    const result = await service.getMenu(user, 9);
    const [product] = result.categories[0].products;

    expect(product.stockQuantity).toBe(8);
    expect(product.salesCount).toBe(33);
  });

  it('关联商品时降级为 finite，库存取商品表并覆盖图片', async () => {
    prisma.scanOrderingMenuCategory.findMany.mockResolvedValue([
      categoryRow({
        products: [
          menuProductRow({
            stockMode: 'unlimited',
            product: { image: 'product.png' },
          }),
        ],
      }),
    ]);
    prisma.scanOrderingMenuProduct.findMany.mockResolvedValue([
      {
        id: 11,
        stockQuantity: null,
        reservedQuantity: 3,
        salesCount: 7,
        product: { stock: 8 },
      },
    ]);

    const result = await service.getMenu(user, 9);
    const [product] = result.categories[0].products;

    expect(product.stockMode).toBe('finite');
    expect(product.stockQuantity).toBe(5);
    expect(product.imageUrl).toBe('product.png');
  });

  it('规格项库存扣预留，null 保持不限库存', async () => {
    prisma.scanOrderingSpecOption.findMany.mockResolvedValue([
      { id: 31, stockQuantity: 5, reservedQuantity: 1 },
      { id: 32, stockQuantity: null, reservedQuantity: 0 },
    ]);
    prisma.scanOrderingMenuCategory.findMany.mockResolvedValue([
      categoryRow({
        products: [
          menuProductRow({
            specGroups: [
              {
                id: 21,
                name: '规格',
                selectionType: 'multiple',
                minSelections: 0,
                maxSelections: 2,
                options: [
                  {
                    id: 31,
                    name: '大杯',
                    extraPrice: 300,
                    isDefault: true,
                    isActive: true,
                  },
                  {
                    id: 32,
                    name: '加冰',
                    extraPrice: 0,
                    isDefault: false,
                    isActive: true,
                  },
                ],
              },
            ],
          }),
        ],
      }),
    ]);

    const result = await service.getMenu(user, 9);
    const options = result.categories[0].products[0].specGroups[0].options;

    expect(options[0].stockQuantity).toBe(4);
    expect(options[1].stockQuantity).toBeNull();
  });

  it('静态菜单命中缓存时不查菜单表，但仍覆盖最新库存快照', async () => {
    cacheMenuOnly({
      menuVersion: 'version-1',
      categories: [
        {
          id: 3,
          name: '茶饮',
          sortOrder: 1,
          products: [
            {
              id: 11,
              categoryId: 3,
              name: '柠檬茶',
              description: '少冰',
              imageUrl: 'menu.png',
              basePrice: 1200,
              stockMode: 'finite',
              specGroups: [],
            },
          ],
        },
      ],
    });

    const result = await service.getMenu(user, 9);

    expect(prisma.scanOrderingMenuCategory.findMany).not.toHaveBeenCalled();
    expect(result.categories[0].products[0].stockQuantity).toBe(8);
    expect(result.categories[0].products[0].salesCount).toBe(33);
  });

  it('库存快照命中 Redis 时不再回源商品/规格表', async () => {
    redisService.getJson.mockImplementation((key: string) => {
      if (key.startsWith('club:menu:store:')) {
        return Promise.resolve({ menuVersion: 'version-1', categories: [] });
      }
      // 库存快照 key
      return Promise.resolve({ products: {}, options: {} });
    });

    await service.getMenu(user, 9);

    expect(prisma.scanOrderingMenuProduct.findMany).not.toHaveBeenCalled();
    expect(prisma.scanOrderingSpecOption.findMany).not.toHaveBeenCalled();
  });
});

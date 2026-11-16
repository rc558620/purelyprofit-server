import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { ClubScanOrderingMenuQueryService } from './club-scan-ordering-menu-query.service';

describe('ClubScanOrderingMenuQueryService', () => {
  let service: ClubScanOrderingMenuQueryService;

  const prisma = {
    scanOrderingSession: { findFirst: jest.fn() },
    scanOrderingMenuCategory: { findMany: jest.fn() },
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
    stockQuantity: 10,
    reservedQuantity: 2,
    salesCount: 33,
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
            stockQuantity: 5,
            reservedQuantity: 1,
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

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.scanOrderingSession.findFirst.mockResolvedValue({ storeId: 42 });
    prisma.scanOrderingMenuCategory.findMany.mockResolvedValue([categoryRow()]);
    redisService.get.mockResolvedValue('version-1');
    redisService.getJson.mockResolvedValue(null);
    redisService.set.mockResolvedValue(undefined);
    redisService.setJson.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClubScanOrderingMenuQueryService,
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
  });

  it('菜单查询按白名单投影，整行非业务字段不再下发', async () => {
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
    // reservedQuantity / product 必须保留在投影里用于派生
    expect(productSelect).toHaveProperty('reservedQuantity');
    expect(productSelect).toHaveProperty('product');
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
    // 内部派生字段不得泄漏到响应
    expect(product).not.toHaveProperty('reservedQuantity');
    expect(product).not.toHaveProperty('product');

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

  it('可用库存按预留量扣减，关联商品存在时降级为 finite 并覆盖图片', async () => {
    prisma.scanOrderingMenuCategory.findMany.mockResolvedValue([
      categoryRow({
        products: [
          menuProductRow({
            stockMode: 'unlimited',
            stockQuantity: null,
            reservedQuantity: 3,
            product: { stock: 8, image: 'product.png' },
          }),
        ],
      }),
    ]);

    const result = await service.getMenu(user, 9);
    const [product] = result.categories[0].products;

    expect(product.stockMode).toBe('finite');
    expect(product.stockQuantity).toBe(5);
    expect(product.imageUrl).toBe('product.png');
  });

  it('规格项库存扣预留，null 保持不限库存', async () => {
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
                    stockQuantity: 5,
                    reservedQuantity: 1,
                    isDefault: true,
                    isActive: true,
                  },
                  {
                    id: 32,
                    name: '加冰',
                    extraPrice: 0,
                    stockQuantity: null,
                    reservedQuantity: 0,
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

  it('缓存命中时直接返回，不再查库', async () => {
    redisService.getJson.mockResolvedValue({
      menuVersion: 'version-1',
      categories: [],
    });

    const result = await service.getMenu(user, 9);

    expect(result).toEqual({ menuVersion: 'version-1', categories: [] });
    expect(prisma.scanOrderingMenuCategory.findMany).not.toHaveBeenCalled();
  });
});

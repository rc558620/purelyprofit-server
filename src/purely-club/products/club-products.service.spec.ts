import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { ClubProductPromotionService } from './club-product-promotion.service';
import { ClubProductQueryService } from './club-product-query.service';
import { ClubProductViewService } from './club-product-view.service';
import type {
  ClubProductPricingContext,
  ClubProductRecord,
} from './club-products.types';
import { ClubProductsService } from './club-products.service';

describe('ClubProductsService', () => {
  let service: ClubProductsService;

  const clubProductQueryService = {
    listActiveByStore: jest.fn(),
    getActiveDetailByStore: jest.fn(),
    resolveHotProductIds: jest.fn(),
  };

  const clubProductPromotionService = {
    resolvePricingContext: jest.fn(),
  };

  const clubProductViewService = {
    toClubProduct: jest.fn(),
  };

  const user: AuthenticatedUser = {
    id: 201,
    email: 'club_phone_13800138000@purelyprofit.local',
    phone: '13800138000',
    name: '俱乐部用户',
    createdAt: new Date('2026-05-12T00:00:00.000Z'),
    updatedAt: new Date('2026-05-13T00:00:00.000Z'),
    accountScope: 'purely_club',
    currentMembership: null,
  };

  const currentContext = {
    user,
    store: {
      id: 11,
      name: '望京旗舰店',
      address: '北京市朝阳区望京 SOHO T3 B1',
      createdAt: new Date('2026-05-12T00:00:00.000Z'),
      updatedAt: new Date('2026-05-13T00:00:00.000Z'),
    },
  };

  const emptyPricingContext: ClubProductPricingContext = {
    memberDiscountRate: null,
    isFirstOrderBuyer: false,
    firstOrderPromotions: [],
    discountPromotions: [],
    reducePromotions: [],
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    clubProductPromotionService.resolvePricingContext.mockResolvedValue(
      emptyPricingContext,
    );
    clubProductQueryService.resolveHotProductIds.mockImplementation(
      (products: ClubProductRecord[]) =>
        new Set(products.slice(0, 3).map((item) => item.id)),
    );
    clubProductViewService.toClubProduct.mockImplementation(
      (
        product: ClubProductRecord,
        hotProductIds: Set<number>,
        pricingContext: ClubProductPricingContext,
      ) => ({
        id: String(product.id),
        name: product.name,
        description: product.description?.trim() || '暂无服务说明',
        coverImage: product.image?.trim() || '',
        originalPrice: (product.originalPrice ?? product.price) / 100,
        // 简化：直接取原价，实际价格逻辑由 ClubProductViewService 单元测试覆盖
        memberPrice: product.price / 100,
        type: 'product',
        tags: hotProductIds.has(product.id) ? ['热销'] : [],
        isHot: hotProductIds.has(product.id),
        details: [],
      }),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClubProductsService,
        { provide: ClubProductQueryService, useValue: clubProductQueryService },
        {
          provide: ClubProductPromotionService,
          useValue: clubProductPromotionService,
        },
        { provide: ClubProductViewService, useValue: clubProductViewService },
      ],
    }).compile();

    service = module.get<ClubProductsService>(ClubProductsService);
  });

  it('list 在 featured=true 时仅返回热门商品并映射到 club 视图', async () => {
    const products = [
      createProduct({
        id: 31,
        name: '经典养护套餐',
        createdAt: new Date('2026-06-03T00:00:00.000Z'),
      }),
      createProduct({
        id: 30,
        name: '黄金焕肤疗程',
        createdAt: new Date('2026-06-02T00:00:00.000Z'),
      }),
      createProduct({
        id: 29,
        name: '头皮护理套组',
        createdAt: new Date('2026-06-01T00:00:00.000Z'),
      }),
      createProduct({
        id: 28,
        name: '肩颈舒缓护理',
        createdAt: new Date('2026-05-31T00:00:00.000Z'),
      }),
    ];
    clubProductQueryService.listActiveByStore.mockResolvedValue(products);

    await expect(
      service.list(currentContext, { featured: true }),
    ).resolves.toEqual({
      items: [
        expect.objectContaining({ id: '31', isHot: true }),
        expect.objectContaining({ id: '30', isHot: true }),
        expect.objectContaining({ id: '29', isHot: true }),
      ],
    });
    expect(clubProductQueryService.listActiveByStore).toHaveBeenCalledWith(11);
    expect(clubProductQueryService.resolveHotProductIds).toHaveBeenCalledWith(
      products,
    );
    expect(clubProductViewService.toClubProduct).toHaveBeenCalledTimes(3);
  });

  it('list 将 pricingContext 透传给视图映射层', async () => {
    const pricingContext: ClubProductPricingContext = {
      memberDiscountRate: null,
      isFirstOrderBuyer: true,
      firstOrderPromotions: [{ id: 18, discountRate: 75, tag: '首单 7.5 折' }],
      discountPromotions: [],
      reducePromotions: [],
    };
    clubProductQueryService.listActiveByStore.mockResolvedValue([
      createProduct({ id: 31, price: 49900 }),
    ]);
    clubProductPromotionService.resolvePricingContext.mockResolvedValue(
      pricingContext,
    );

    await service.list(currentContext, {});

    expect(
      clubProductPromotionService.resolvePricingContext,
    ).toHaveBeenCalledWith(11, user.phone);
    expect(clubProductViewService.toClubProduct).toHaveBeenCalledWith(
      expect.objectContaining({ id: 31 }),
      expect.any(Set),
      pricingContext,
    );
  });

  it('getDetail 返回当前门店指定商品详情', async () => {
    const product = createProduct({
      id: 18,
      name: '黄金焕肤疗程',
      price: 49900,
      originalPrice: 68800,
      description: '激活细胞，提亮肤色，7 天肉眼可见变化',
      durationMinutes: 100,
      personCount: 1,
    });
    clubProductQueryService.getActiveDetailByStore.mockResolvedValue(product);

    await expect(service.getDetail(currentContext, 18)).resolves.toEqual(
      expect.objectContaining({
        id: '18',
        name: '黄金焕肤疗程',
        memberPrice: 499,
      }),
    );
    expect(clubProductQueryService.getActiveDetailByStore).toHaveBeenCalledWith(
      11,
      18,
    );
    expect(clubProductViewService.toClubProduct).toHaveBeenCalledWith(
      product,
      new Set([18]),
      emptyPricingContext,
    );
  });

  it('getDetail 在当前门店找不到商品时抛出 NotFoundException', async () => {
    clubProductQueryService.getActiveDetailByStore.mockResolvedValue(null);

    await expect(service.getDetail(currentContext, 99)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

function createProduct(
  overrides?: Partial<ClubProductRecord>,
): ClubProductRecord {
  return {
    id: 1,
    categoryId: 3,
    name: '经典养护套餐',
    price: 19900,
    originalPrice: 28800,
    image: null,
    descriptionTitle: null,
    description: '深层清洁 + 补水保湿，恢复肌肤光泽活力',
    stock: 30,
    durationMinutes: 60,
    personCount: 1,
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
    category: { name: '面部护理' },
    ...overrides,
  };
}

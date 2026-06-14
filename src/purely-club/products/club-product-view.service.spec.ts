import { ClubProductViewService } from './club-product-view.service';
import type {
  ClubProductPricingContext,
  ClubProductRecord,
} from './club-products.types';

describe('ClubProductViewService', () => {
  let service: ClubProductViewService;

  beforeEach(() => {
    service = new ClubProductViewService();
  });

  it('toClubProduct 无任何折扣时以原价展示', () => {
    const product = createProduct({
      id: 18,
      price: 49900,
      originalPrice: 68800,
      description: '激活细胞，提亮肤色，7 天肉眼可见变化',
      durationMinutes: 100,
      personCount: 2,
    });
    const pricingContext = emptyPricingContext();

    expect(
      service.toClubProduct(product, new Set([18]), pricingContext),
    ).toEqual({
      id: '18',
      name: '经典养护套餐',
      categoryId: '3',
      categoryName: '面部护理',
      description: '激活细胞，提亮肤色，7 天肉眼可见变化',
      coverImage: '',
      originalPrice: 688,
      memberPrice: 499,
      finalPrice: 499,
      memberDiscountRate: null,
      levelOverridden: false,
      type: 'package',
      tags: ['热销', '面部护理', '多人适用'],
      isHot: true,
      isActive: true,
      stock: 30,
      durationMinutes: 100,
      personCount: 2,
      validityDesc: '单次服务约 100 分钟 · 适用 2 人',
      createdAt: new Date('2026-06-01T00:00:00.000Z').getTime(),
      updatedAt: new Date('2026-06-01T00:00:00.000Z').getTime(),
    });
  });

  it('toClubProduct 会员 8 折时以折后价展示', () => {
    const product = createProduct({
      id: 18,
      price: 49900,
      originalPrice: 68800,
    });
    const pricingContext: ClubProductPricingContext = {
      memberDiscountRate: 0.8,
      isFirstOrderBuyer: false,
      firstOrderPromotions: [],
      discountPromotions: [],
      reducePromotions: [],
    };

    const result = service.toClubProduct(
      product,
      new Set([18]),
      pricingContext,
    );
    // 49900 * 0.8 = 39920 -> 399.20
    expect(result.memberPrice).toBe(399.2);
    expect(result.finalPrice).toBe(399.2);
    expect(result).not.toHaveProperty('promotionId');
  });

  it('toClubProduct 会组装首单优惠、标签与详情', () => {
    const product = createProduct({
      id: 18,
      price: 49900,
      originalPrice: 68800,
      description: '激活细胞，提亮肤色，7 天肉眼可见变化',
      durationMinutes: 100,
      personCount: 2,
    });
    const pricingContext: ClubProductPricingContext = {
      memberDiscountRate: null,
      isFirstOrderBuyer: true,
      firstOrderPromotions: [{ id: 9, discountRate: 75, tag: '首单 7.5 折' }],
      discountPromotions: [],
      reducePromotions: [],
    };

    expect(
      service.toClubProduct(product, new Set([18]), pricingContext),
    ).toEqual({
      id: '18',
      name: '经典养护套餐',
      categoryId: '3',
      categoryName: '面部护理',
      description: '激活细胞，提亮肤色，7 天肉眼可见变化',
      coverImage: '',
      originalPrice: 688,
      memberPrice: 499,
      finalPrice: 374.25,
      memberDiscountRate: null,
      levelOverridden: false,
      promotionId: '9',
      promotionType: 'first_order_discount',
      discountRate: 75,
      promotionTag: '首单 7.5 折',
      appliedPromotions: [
        {
          id: '9',
          type: 'first_order_discount',
          tag: '首单 7.5 折',
          discountRate: 75,
          savingAmount: 124.75,
        },
      ],
      type: 'package',
      tags: ['热销', '面部护理', '多人适用'],
      isHot: true,
      isActive: true,
      stock: 30,
      durationMinutes: 100,
      personCount: 2,
      validityDesc: '单次服务约 100 分钟 · 适用 2 人',
      createdAt: new Date('2026-06-01T00:00:00.000Z').getTime(),
      updatedAt: new Date('2026-06-01T00:00:00.000Z').getTime(),
    });
  });

  it('toClubProduct 活动折扣(7折)优于会员折扣(8折)时覆盖会员折扣', () => {
    const product = createProduct({
      id: 18,
      price: 49900,
      originalPrice: 68800,
    });
    const pricingContext: ClubProductPricingContext = {
      memberDiscountRate: 0.8,
      isFirstOrderBuyer: false,
      firstOrderPromotions: [],
      discountPromotions: [{ id: 99, discountRate: 70, tag: '限时 7 折' }],
      reducePromotions: [],
    };

    const result = service.toClubProduct(
      product,
      new Set([18]),
      pricingContext,
    );
    // memberPrice = 会员基准价 8 折: 399.20
    expect(result.memberPrice).toBe(399.2);
    // finalPrice = 活动 7 折覆盖: 349.30
    expect(result.finalPrice).toBe(349.3);
    expect(result.promotionId).toBe('99');
    expect(result.promotionType).toBe('discount');
    expect(result.discountRate).toBe(70);
  });

  it('toClubProduct 活动折扣(8.5折)不如会员折扣(8折)时沿用会员折扣', () => {
    const product = createProduct({
      id: 18,
      price: 49900,
      originalPrice: 68800,
    });
    const pricingContext: ClubProductPricingContext = {
      memberDiscountRate: 0.8,
      isFirstOrderBuyer: false,
      firstOrderPromotions: [],
      discountPromotions: [{ id: 100, discountRate: 85, tag: '限时 8.5 折' }],
      reducePromotions: [],
    };

    const result = service.toClubProduct(
      product,
      new Set([18]),
      pricingContext,
    );
    // 会员 8 折: 39920 -> 399.20，活动 8.5 折: 42415 -> 不如会员
    expect(result.memberPrice).toBe(399.2);
    expect(result).not.toHaveProperty('promotionId');
  });

  it('toClubProduct 非首单买家时忽略首单折扣，使用活动折扣(8折)优于会员折扣(8.7折)', () => {
    const product = createProduct({
      id: 18,
      price: 49900,
      originalPrice: 68800,
    });
    const pricingContext: ClubProductPricingContext = {
      memberDiscountRate: 0.87,
      isFirstOrderBuyer: false,
      // 即使 firstOrderPromotions 意外包含首单活动，也应当被拦截
      firstOrderPromotions: [{ id: 9, discountRate: 75, tag: '首单 7.5 折' }],
      discountPromotions: [{ id: 10, discountRate: 80, tag: '全场 8 折' }],
      reducePromotions: [],
    };

    const result = service.toClubProduct(
      product,
      new Set([18]),
      pricingContext,
    );
    // 会员 8.7 折: 49900 * 0.87 = 43413 -> 434.13
    expect(result.memberPrice).toBe(434.13);
    // 全场 8 折优于会员 8.7 折: 49900 * 80 / 100 = 39920 -> 399.20
    expect(result.finalPrice).toBe(399.2);
    expect(result.promotionId).toBe('10');
    expect(result.promotionType).toBe('discount');
    expect(result.discountRate).toBe(80);
    // 首单折扣不应出现在 appliedPromotions 中
    expect(result.appliedPromotions ?? []).not.toContainEqual(
      expect.objectContaining({ type: 'first_order_discount' }),
    );
  });

  it('toClubProduct 首单买家时首单折扣(7.5折)优于活动折扣(8折)和会员折扣(8.7折)', () => {
    const product = createProduct({
      id: 18,
      price: 49900,
      originalPrice: 68800,
    });
    const pricingContext: ClubProductPricingContext = {
      memberDiscountRate: 0.87,
      isFirstOrderBuyer: true,
      firstOrderPromotions: [{ id: 9, discountRate: 75, tag: '首单 7.5 折' }],
      discountPromotions: [{ id: 10, discountRate: 80, tag: '全场 8 折' }],
      reducePromotions: [],
    };

    const result = service.toClubProduct(
      product,
      new Set([18]),
      pricingContext,
    );
    // 首单 7.5 折: 49900 * 75 / 100 = 37425 -> 374.25
    expect(result.finalPrice).toBe(374.25);
    expect(result.promotionId).toBe('9');
    expect(result.promotionType).toBe('first_order_discount');
    expect(result.discountRate).toBe(75);
  });

  it('toClubProduct 在缺少可展示信息时返回默认描述', () => {
    const product = createProduct({
      id: 21,
      originalPrice: null,
      image: '   ',
      description: '   ',
      stock: null,
      durationMinutes: null,
      personCount: null,
      category: null,
    });

    expect(
      service.toClubProduct(product, new Set<number>(), emptyPricingContext()),
    ).toEqual({
      id: '21',
      name: '经典养护套餐',
      categoryId: '3',
      categoryName: undefined,
      description: '暂无服务说明',
      coverImage: '',
      originalPrice: 199,
      memberPrice: 199,
      finalPrice: 199,
      memberDiscountRate: null,
      levelOverridden: false,
      type: 'product',
      tags: [],
      isHot: false,
      isActive: true,
      createdAt: new Date('2026-06-01T00:00:00.000Z').getTime(),
      updatedAt: new Date('2026-06-01T00:00:00.000Z').getTime(),
    });
  });
});

function emptyPricingContext(): ClubProductPricingContext {
  return {
    memberDiscountRate: null,
    isFirstOrderBuyer: false,
    firstOrderPromotions: [],
    discountPromotions: [],
    reducePromotions: [],
  };
}

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
    isActive: true,
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
    updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    category: { name: '面部护理' },
    ...overrides,
  };
}

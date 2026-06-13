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
      description: '激活细胞，提亮肤色，7 天肉眼可见变化',
      coverImage: '',
      originalPrice: 688,
      memberPrice: 499,
      finalPrice: 499,
      type: 'package',
      tags: ['热销', '面部护理', '多人适用'],
      isHot: true,
      stock: 30,
      validityDesc: '单次服务约 100 分钟 · 适用 2 人',
      details: [
        '激活细胞，提亮肤色，7 天肉眼可见变化',
        '服务分类：面部护理',
        '参考时长：100 分钟',
        '适用人数：2 人',
        '当前库存：30 份',
      ],
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
      firstOrderPromotions: [{ id: 9, discountRate: 75, tag: '首单 7.5 折' }],
      discountPromotions: [],
      reducePromotions: [],
    };

    expect(
      service.toClubProduct(product, new Set([18]), pricingContext),
    ).toEqual({
      id: '18',
      name: '经典养护套餐',
      description: '激活细胞，提亮肤色，7 天肉眼可见变化',
      coverImage: '',
      originalPrice: 688,
      memberPrice: 499,
      finalPrice: 374.25,
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
      stock: 30,
      validityDesc: '单次服务约 100 分钟 · 适用 2 人',
      details: [
        '激活细胞，提亮肤色，7 天肉眼可见变化',
        '服务分类：面部护理',
        '参考时长：100 分钟',
        '适用人数：2 人',
        '当前库存：30 份',
      ],
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
      description: '暂无服务说明',
      coverImage: '',
      originalPrice: 199,
      memberPrice: 199,
      finalPrice: 199,
      type: 'product',
      tags: [],
      isHot: false,
      details: ['暂无服务详情'],
    });
  });
});

function emptyPricingContext(): ClubProductPricingContext {
  return {
    memberDiscountRate: null,
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
    description: '深层清洁 + 补水保湿，恢复肌肤光泽活力',
    stock: 30,
    durationMinutes: 60,
    personCount: 1,
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
    category: { name: '面部护理' },
    ...overrides,
  };
}

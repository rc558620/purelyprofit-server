import { ClubProductViewService } from './club-product-view.service';
import type {
  ClubFirstOrderPromotion,
  ClubProductRecord,
} from './club-products.types';

describe('ClubProductViewService', () => {
  let service: ClubProductViewService;

  beforeEach(() => {
    service = new ClubProductViewService();
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
    const promotion = {
      id: 9,
      discountRate: 75,
      tag: '首单 7.5 折',
    } satisfies ClubFirstOrderPromotion;

    expect(service.toClubProduct(product, new Set([18]), promotion)).toEqual({
      id: '18',
      name: '经典养护套餐',
      description: '激活细胞，提亮肤色，7 天肉眼可见变化',
      coverImage: '',
      originalPrice: 688,
      memberPrice: 374.25,
      promotionId: '9',
      promotionType: 'first_order_discount',
      discountRate: 75,
      promotionTag: '首单 7.5 折',
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

    expect(service.toClubProduct(product, new Set<number>(), null)).toEqual({
      id: '21',
      name: '经典养护套餐',
      description: '暂无服务说明',
      coverImage: '',
      originalPrice: 199,
      memberPrice: 199,
      type: 'product',
      tags: [],
      isHot: false,
      details: ['暂无服务详情'],
    });
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
    description: '深层清洁 + 补水保湿，恢复肌肤光泽活力',
    stock: 30,
    durationMinutes: 60,
    personCount: 1,
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
    category: { name: '面部护理' },
    ...overrides,
  };
}

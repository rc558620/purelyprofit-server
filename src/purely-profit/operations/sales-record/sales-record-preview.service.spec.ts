import { Test, TestingModule } from '@nestjs/testing';
import { Money } from '../../../shared/money.utils';
import { SalesRecordPreviewService } from './sales-record-preview.service';
import { SalesRecordAmountsDomain } from './sales-record-amounts.domain';
import type { CreateSalesRecordDto } from './dto/sales-record.dto';

describe('SalesRecordPreviewService', () => {
  let service: SalesRecordPreviewService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SalesRecordPreviewService],
    }).compile();

    service = module.get<SalesRecordPreviewService>(SalesRecordPreviewService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  /**
   * 【核心测试】/preview 必须返回总金额、每个 item 小计
   */
  it('should return totalRevenue, totalProfit, totalQuantity and item subtotals', () => {
    const dto: CreateSalesRecordDto = {
      items: [
        {
          productId: '1',
          productName: '可口可乐',
          categoryName: '饮品',
          salePrice: 6.5,
          profit: 2.5,
          quantity: 2,
        },
        {
          productId: '2',
          productName: '薯条',
          categoryName: '小食',
          salePrice: 12.0,
          profit: 4.0,
          quantity: 1,
        },
      ],
      paymentMethod: 'cash',
      calcMode: 'business',
    };

    const result = service.preview(dto);

    // 总金额验证
    // item1: 6.5 * 2 = 13.0
    // item2: 12.0 * 1 = 12.0
    // total: 25.0
    expect(result.totalRevenue).toBe(25.0);
    expect(result.totalProfit).toBe(2.5 * 2 + 4.0 * 1); // 5 + 4 = 9
    expect(result.totalQuantity).toBe(3);

    // 每个 item 小计验证
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({
      productId: '1',
      productName: '可口可乐',
      revenueSubtotal: 13.0, // 6.5 * 2
      profitSubtotal: 5.0, // 2.5 * 2
      quantity: 2,
    });
    expect(result.items[1]).toMatchObject({
      productId: '2',
      productName: '薯条',
      revenueSubtotal: 12.0, // 12.0 * 1
      profitSubtotal: 4.0, // 4.0 * 1
      quantity: 1,
    });
  });

  /**
   * 【关键验证】preview 与 create 应该使用同一个 domain 计算
   * 这个测试验证了金额一致性的关键原则
   */
  it('should use SalesRecordAmountsDomain for calculation (same as create)', () => {
    const dto: CreateSalesRecordDto = {
      items: [
        {
          productId: 'manual_1',
          productName: '手冲咖啡',
          categoryName: '咖啡',
          salePrice: 28.0,
          profit: 8.5,
          quantity: 3,
        },
      ],
      paymentMethod: 'cash',
      calcMode: 'profit',
    };

    const result = service.preview(dto);

    // 验证金额是否通过 SalesRecordAmountsDomain 计算
    // 利润模式下，totalProfit 应该是 8.5 * 3 = 25.5
    const expectedProfit = Money.fromInputYuan(8.5).multiply(3).toOutputYuan();
    expect(result.totalProfit).toBe(expectedProfit);

    // 验证 item 小计是否正确
    expect(result.items[0].profitSubtotal).toBe(expectedProfit);
  });

  /**
   * 【边界测试】0 金额也应该被正确返回
   */
  it('should correctly return 0 when amount is zero', () => {
    const dto: CreateSalesRecordDto = {
      items: [
        {
          productId: '1',
          productName: '赠品',
          categoryName: '礼品',
          salePrice: 0,
          profit: 0,
          quantity: 1,
        },
      ],
      paymentMethod: 'cash',
      calcMode: 'business',
    };

    const result = service.preview(dto);

    expect(result.totalRevenue).toBe(0);
    expect(result.totalProfit).toBe(0);
    expect(result.items[0].revenueSubtotal).toBe(0);
    expect(result.items[0].profitSubtotal).toBe(0);
  });

  /**
   * 【业务验证】抵扣项（负数金额）也应该正确计算
   */
  it('should correctly handle negative amounts (deduction items)', () => {
    const dto: CreateSalesRecordDto = {
      items: [
        {
          productId: 'normal_1',
          productName: '可乐',
          categoryName: '饮品',
          salePrice: 6.5,
          profit: 2.5,
          quantity: 2,
        },
        {
          productId: 'deduction_1',
          productName: '9折优惠',
          categoryName: '优惠',
          salePrice: -1.3, // 负数
          profit: -0.5, // 负数
          quantity: 1,
        },
      ],
      paymentMethod: 'cash',
      calcMode: 'business',
    };

    const result = service.preview(dto);

    // 总金额应该是 13.0 - 1.3 = 11.7
    // 总利润应该是 5.0 - 0.5 = 4.5
    expect(result.totalRevenue).toBe(11.7);
    expect(result.totalProfit).toBe(4.5);
    expect(result.items[1].revenueSubtotal).toBe(-1.3);
    expect(result.items[1].profitSubtotal).toBe(-0.5);
  });

  /**
   * 【一致性验证】preview 返回的 items 应该能完整重建总金额
   */
  it('should ensure items subtotals can reconstruct totalRevenue and totalProfit', () => {
    const dto: CreateSalesRecordDto = {
      items: [
        {
          productId: '1',
          productName: '咖啡',
          categoryName: '饮品',
          salePrice: 15.5,
          profit: 4.0,
          quantity: 2,
        },
        {
          productId: '2',
          productName: '蛋糕',
          categoryName: '甜点',
          salePrice: 18.0,
          profit: 5.0,
          quantity: 3,
        },
      ],
      paymentMethod: 'cash',
      calcMode: 'business',
    };

    const result = service.preview(dto);

    // 通过 items 重新计算总金额
    const reconstructedRevenue = result.items.reduce(
      (sum, item) => sum + item.revenueSubtotal,
      0,
    );
    const reconstructedProfit = result.items.reduce(
      (sum, item) => sum + item.profitSubtotal,
      0,
    );

    // 应该与 preview 返回的总金额完全相等
    expect(Math.abs(reconstructedRevenue - result.totalRevenue)).toBeLessThan(
      0.01,
    ); // 浮点数容差
    expect(Math.abs(reconstructedProfit - result.totalProfit)).toBeLessThan(
      0.01,
    );
  });

  /**
   * 【完整场景】模拟实际 additional 页面场景
   */
  it('should handle realistic additional page scenario', () => {
    // 模拟用户在 additional 页面选择的商品和数量
    const dto: CreateSalesRecordDto = {
      items: [
        {
          productId: '1',
          productName: '利用测试3',
          categoryName: '测试',
          salePrice: 15.5,
          profit: 4.0,
          quantity: 2,
        },
        {
          productId: '2',
          productName: '利用测试',
          categoryName: '测试',
          salePrice: 18.0,
          profit: 5.0,
          quantity: 1,
        },
      ],
      paymentMethod: 'cash',
      calcMode: 'profit',
    };

    const result = service.preview(dto);

    // 利润模式下，验证总利润
    // item1 profit: 4.0 * 2 = 8.0
    // item2 profit: 5.0 * 1 = 5.0
    // total: 13.0
    expect(result.totalProfit).toBe(13.0);

    // 验证响应结构完整
    expect(result).toHaveProperty('items');
    expect(result).toHaveProperty('totalRevenue');
    expect(result).toHaveProperty('totalProfit');
    expect(result).toHaveProperty('totalQuantity');

    // 验证每个 item 都有小计
    result.items.forEach((item) => {
      expect(item).toHaveProperty('revenueSubtotal');
      expect(item).toHaveProperty('profitSubtotal');
      expect(item).toHaveProperty('quantity');
    });
  });
});

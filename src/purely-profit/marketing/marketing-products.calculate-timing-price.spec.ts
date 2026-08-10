// 营销产品费率自动计算单测：金额计算权在后端（per_hour 按小时折算；per_session 整次=售价）
import { MarketingProductsService } from './marketing-products.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { MarketingSharedService } from './marketing-shared.service';

const buildService = (): MarketingProductsService =>
  new MarketingProductsService(
    {} as PrismaService,
    {} as MarketingSharedService,
  );

describe('MarketingProductsService.calculateTimingPrice', () => {
  const service = buildService();

  it('per_hour：售价 98 元 ÷ 45 分钟 → 130.67 元/小时（四舍五入到分）', () => {
    const result = service.calculateTimingPrice({
      price: 98,
      durationMinutes: 45,
      mode: 'per_hour',
    });
    expect(result.rate).toBeCloseTo(130.67, 2);
  });

  it('per_hour：售价 60 元 ÷ 60 分钟 → 60 元/小时', () => {
    const result = service.calculateTimingPrice({
      price: 60,
      durationMinutes: 60,
      mode: 'per_hour',
    });
    expect(result.rate).toBeCloseTo(60, 2);
  });

  it('per_hour：售价 10 元 ÷ 90 分钟 → 6.67 元/小时', () => {
    const result = service.calculateTimingPrice({
      price: 10,
      durationMinutes: 90,
      mode: 'per_hour',
    });
    expect(result.rate).toBeCloseTo(6.67, 2);
  });

  it('per_session：倒计时台位费 = 售价（元/次），不按时长折算', () => {
    const result = service.calculateTimingPrice({
      price: 77,
      durationMinutes: 2,
      mode: 'per_session',
    });
    expect(result.rate).toBeCloseTo(77, 2);
  });

  it('未传 mode 时默认按 per_hour 折算（兼容旧调用）', () => {
    const result = service.calculateTimingPrice({
      price: 98,
      durationMinutes: 45,
    });
    expect(result.rate).toBeCloseTo(130.67, 2);
  });
});

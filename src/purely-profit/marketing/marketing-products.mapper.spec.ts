// 营销商品「DTO → Prisma 写入数据」映射单测：聚焦限时团购标签开关的落库语义
import { plainToInstance } from 'class-transformer';
import {
  CreateMarketingProductDto,
  UpdateMarketingProductDto,
} from './dto/marketing-product.dto';
import {
  buildProductCreateData,
  buildProductUpdateData,
} from './marketing-products.mapper';
import type { NormalizedProductBilling } from './marketing-products.billing';

/** 计费字段归一化结果与本用例无关，统一给空配置 */
const EMPTY_BILLING: NormalizedProductBilling = {
  validDays: null,
  billingMode: 'items',
  hourlyRateCents: null,
  countdownMinutes: null,
  countdownPriceCents: null,
  autoCheckout: false,
};

const toCreateDto = (
  payload: Record<string, unknown>,
): CreateMarketingProductDto =>
  plainToInstance(CreateMarketingProductDto, payload, {
    enableImplicitConversion: true,
  });

const toUpdateDto = (
  payload: Record<string, unknown>,
): UpdateMarketingProductDto =>
  plainToInstance(UpdateMarketingProductDto, payload, {
    enableImplicitConversion: true,
  });

describe('marketing-products.mapper · showGroupBuyTag', () => {
  it('新增时未传开关，按默认「展示」落库', () => {
    const dto = toCreateDto({
      name: '双人套餐',
      categoryId: 3,
      price: 98,
      type: 'voucher',
    });

    const data = buildProductCreateData({
      storeId: 1,
      dto,
      billing: EMPTY_BILLING,
    });

    expect(data.showGroupBuyTag).toBe(true);
  });

  it('新增时显式关闭开关，false 必须原样落库', () => {
    const dto = toCreateDto({
      name: '双人套餐',
      categoryId: 3,
      price: 98,
      type: 'voucher',
      showGroupBuyTag: false,
    });

    const data = buildProductCreateData({
      storeId: 1,
      dto,
      billing: EMPTY_BILLING,
    });

    expect(data.showGroupBuyTag).toBe(false);
  });

  it('编辑时未传开关，不覆盖库中原值', () => {
    const dto = toUpdateDto({ name: '改名套餐' });

    const data = buildProductUpdateData({ dto, billing: EMPTY_BILLING });

    expect('showGroupBuyTag' in data).toBe(false);
  });

  it('编辑时显式关闭开关，false 必须落库而不是被兜底成 true', () => {
    const dto = toUpdateDto({ showGroupBuyTag: false });

    const data = buildProductUpdateData({ dto, billing: EMPTY_BILLING });

    expect(data.showGroupBuyTag).toBe(false);
  });
});

import { NotFoundException } from '@nestjs/common';

/**
 * 自助下单建单测试的商品规格定价桩。
 *
 * 商品 101 = 可口可乐（800 分 / 成本 300 分），选中选项 11（大杯 +200 分）
 * 后单价 1000 分、展示名带规格后缀。
 * price / priceMany 共用同一份结果计算，保证两种调用口径在桩里也不分裂。
 */
export interface PricingInput {
  productId: number;
  specOptionIds?: number[] | null;
}

const priceOne = (input: PricingInput): Record<string, unknown> => {
  const ids = [...new Set(input.specOptionIds ?? [])].sort(
    (left, right) => left - right,
  );
  const hasSpec = ids.length > 0;
  return {
    menuProductId: hasSpec ? 77 : null,
    unitPriceCents: hasSpec ? 1000 : 800,
    costPriceCents: 300,
    profitCents: hasSpec ? 700 : 500,
    categoryName: '酒水饮料',
    specOptionIds: ids,
    specNames: hasSpec ? ['大杯'] : [],
    specOptions: hasSpec ? [{ id: 11, name: '大杯', extraPrice: 200 }] : [],
    specSignature: hasSpec ? `sig-${ids.join('-')}` : null,
    displayName: hasSpec ? '可口可乐（大杯）' : '可口可乐',
  };
};

const priceOneOrReject = (
  input: PricingInput & { storeId?: number },
): Promise<Record<string, unknown>> =>
  input.productId !== 101
    ? Promise.reject(new NotFoundException('商品不存在或已下架'))
    : Promise.resolve(priceOne(input));

/** 构造定价服务桩；返回的 jest.Mock 可供用例覆写单次行为 */
export const buildSpecPricingStub = () => ({
  price: jest.fn((input: PricingInput & { storeId: number }) =>
    priceOneOrReject(input),
  ),
  priceMany: jest.fn((storeId: number, items: PricingInput[]) =>
    Promise.all(items.map((item) => priceOneOrReject({ ...item, storeId }))),
  ),
});

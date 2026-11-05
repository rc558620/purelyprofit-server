// 营销商品 DTO 单测：限时团购标签开关必须严格接受布尔值，避免隐式转换把 "false" 翻成 true
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateMarketingProductDto,
  UpdateMarketingProductDto,
} from './marketing-product.dto';

/** 复刻全局 ValidationPipe 的严格分支配置（含 enableImplicitConversion） */
const VALIDATE_OPTIONS = {
  whitelist: true,
  forbidNonWhitelisted: true,
  transformOptions: { enableImplicitConversion: true },
} as const;

const collectErrorProps = async (dto: object): Promise<string[]> => {
  const errors = await validate(dto, VALIDATE_OPTIONS);
  return errors.map((error) => error.property);
};

const createDto = (
  payload: Record<string, unknown>,
): CreateMarketingProductDto =>
  plainToInstance(CreateMarketingProductDto, payload, {
    enableImplicitConversion: true,
  });

const updateDto = (
  payload: Record<string, unknown>,
): UpdateMarketingProductDto =>
  plainToInstance(UpdateMarketingProductDto, payload, {
    enableImplicitConversion: true,
  });

const CREATE_BASE = {
  name: '双人套餐',
  categoryId: 3,
  price: 98,
  type: 'voucher',
};
const UPDATE_BASE = { name: '双人套餐' };

describe('CreateMarketingProductDto · showGroupBuyTag', () => {
  it('未传时不校验且保持 undefined', async () => {
    const dto = createDto(CREATE_BASE);

    await expect(collectErrorProps(dto)).resolves.toEqual([]);
    expect(dto.showGroupBuyTag).toBeUndefined();
  });

  it.each([true, false])('布尔值 %s 正常通过', async (value) => {
    const dto = createDto({ ...CREATE_BASE, showGroupBuyTag: value });

    await expect(collectErrorProps(dto)).resolves.toEqual([]);
    expect(dto.showGroupBuyTag).toBe(value);
  });

  it('字符串 "false" 被拒绝（不得隐式翻转为 true）', async () => {
    const dto = createDto({ ...CREATE_BASE, showGroupBuyTag: 'false' });

    await expect(collectErrorProps(dto)).resolves.toContain('showGroupBuyTag');
  });

  it('null 被拒绝（避免写入非空列直接 500）', async () => {
    const dto = createDto({ ...CREATE_BASE, showGroupBuyTag: null });

    await expect(collectErrorProps(dto)).resolves.toContain('showGroupBuyTag');
  });
});

describe('UpdateMarketingProductDto · showGroupBuyTag', () => {
  it('未传时保持 undefined（表示不修改）', async () => {
    const dto = updateDto(UPDATE_BASE);

    await expect(collectErrorProps(dto)).resolves.toEqual([]);
    expect(dto.showGroupBuyTag).toBeUndefined();
  });

  it('显式 false 正常通过并保留 false', async () => {
    const dto = updateDto({ ...UPDATE_BASE, showGroupBuyTag: false });

    await expect(collectErrorProps(dto)).resolves.toEqual([]);
    expect(dto.showGroupBuyTag).toBe(false);
  });

  it('字符串 "false" 被拒绝（不得隐式翻转为 true）', async () => {
    const dto = updateDto({ ...UPDATE_BASE, showGroupBuyTag: 'false' });

    await expect(collectErrorProps(dto)).resolves.toContain('showGroupBuyTag');
  });

  it('null 被拒绝（避免写入非空列直接 500）', async () => {
    const dto = updateDto({ ...UPDATE_BASE, showGroupBuyTag: null });

    await expect(collectErrorProps(dto)).resolves.toContain('showGroupBuyTag');
  });
});

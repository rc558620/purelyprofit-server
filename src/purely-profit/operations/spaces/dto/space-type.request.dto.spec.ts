import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateSpaceTypeDto,
  UpdateSpaceTypeDto,
} from './space-type.request.dto';

/**
 * 名称字段必须在隐式转换下仍然只接受字符串。
 *
 * 全局 ValidationPipe 开启了 enableImplicitConversion，若不回读原始值，
 * { name: 123 } 会被转换成 "123" 静默入库。
 */
const buildCreate = (payload: Record<string, unknown>) =>
  plainToInstance(CreateSpaceTypeDto, payload, {
    enableImplicitConversion: true,
  });

const buildUpdate = (payload: Record<string, unknown>) =>
  plainToInstance(UpdateSpaceTypeDto, payload, {
    enableImplicitConversion: true,
  });

const invalidNameProperties = async (
  dto: CreateSpaceTypeDto | UpdateSpaceTypeDto,
): Promise<string[]> => {
  const errors = await validate(dto);
  return errors.map((error) => error.property);
};

describe('空间类型名称校验', () => {
  it('创建：字符串名称会裁剪首尾空格', async () => {
    const dto = buildCreate({ name: '  包间  ' });

    expect(dto.name).toBe('包间');
    expect(await invalidNameProperties(dto)).toEqual([]);
  });

  it('创建：数字名称被拒绝，不会被隐式转成字符串', async () => {
    const dto = buildCreate({ name: 123 });

    expect(await invalidNameProperties(dto)).toContain('name');
  });

  it('创建：对象名称被拒绝，不会变成 [object Object]', async () => {
    const dto = buildCreate({ name: { evil: true } });

    expect(await invalidNameProperties(dto)).toContain('name');
  });

  it('创建：空白名称被拒绝', async () => {
    const dto = buildCreate({ name: '   ' });

    expect(await invalidNameProperties(dto)).toContain('name');
  });

  it('创建：超过 20 个字符被拒绝', async () => {
    const dto = buildCreate({ name: 'A'.repeat(21) });

    expect(await invalidNameProperties(dto)).toContain('name');
  });

  it('更新：数字名称同样被拒绝', async () => {
    const dto = buildUpdate({ name: 456 });

    expect(await invalidNameProperties(dto)).toContain('name');
  });

  it('更新：正常名称通过且被裁剪', async () => {
    const dto = buildUpdate({ name: ' VIP 包间 ' });

    expect(dto.name).toBe('VIP 包间');
    expect(await invalidNameProperties(dto)).toEqual([]);
  });
});

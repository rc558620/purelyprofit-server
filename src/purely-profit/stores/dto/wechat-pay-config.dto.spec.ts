import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateWechatPayConfigDto } from './wechat-pay-config.dto';

describe('UpdateWechatPayConfigDto', () => {
  const parse = (raw: Record<string, unknown>): UpdateWechatPayConfigDto =>
    plainToInstance(UpdateWechatPayConfigDto, raw);

  it('商户名称首尾空格在入口被归一化', async () => {
    const dto = parse({ mchId: '1234567890', mchName: '  纯利小店  ' });

    expect(await validate(dto)).toEqual([]);
    expect(dto.mchName).toBe('纯利小店');
  });

  it('纯空白商户名称被拒绝，不会落库成空格名称', async () => {
    const dto = parse({ mchName: '   ' });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(Object.values(errors[0]?.constraints ?? {}).join('、')).toContain(
      '空白',
    );
  });

  it('商户号必须是 10 位纯数字', async () => {
    const dto = parse({ mchId: '123' });

    expect(await validate(dto)).not.toEqual([]);
  });
});

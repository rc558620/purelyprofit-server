import { ValidationPipe } from '@nestjs/common';
import { GetProfitDetailQueryDto } from './profit-detail-query.dto';

/**
 * 与全局 TelemetryValidationPipe 的严格分支保持同一组选项：
 * enableImplicitConversion 是 `?export=false` 被隐式转成 true 的根因。
 */
const pipe = new ValidationPipe({
  whitelist: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});

const transformQuery = (value: Record<string, unknown>): Promise<unknown> =>
  pipe.transform(value, {
    type: 'query',
    metatype: GetProfitDetailQueryDto,
  }) as Promise<unknown>;

describe('GetProfitDetailQueryDto', () => {
  it('export=false 解析为 false，不能被隐式 Boolean 转换吞成 true', async () => {
    const parsed = (await transformQuery({ export: 'false' })) as {
      export?: boolean;
    };

    expect(parsed.export).toBe(false);
  });

  it('export=true 解析为 true', async () => {
    const parsed = (await transformQuery({ export: 'true' })) as {
      export?: boolean;
    };

    expect(parsed.export).toBe(true);
  });

  it('不传 export 时不产生默认值', async () => {
    const parsed = (await transformQuery({})) as { export?: boolean };

    expect(parsed.export).toBeUndefined();
  });

  it('超出 Date 可表示范围的时间戳被拒绝', async () => {
    await expect(
      transformQuery({ customDate: 8_640_000_000_000_001 }),
    ).rejects.toThrow();
  });

  it('超出上限的年份被拒绝', async () => {
    await expect(transformQuery({ year: 100_000 })).rejects.toThrow();
  });

  it('正常入参可以通过校验', async () => {
    const parsed = (await transformQuery({
      period: 'year',
      year: 2025,
      export: 'false',
    })) as { period?: string; year?: number; export?: boolean };

    expect(parsed).toMatchObject({ period: 'year', year: 2025, export: false });
  });
});

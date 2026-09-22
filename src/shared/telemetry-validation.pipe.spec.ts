import { IsInt, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { TelemetryValidationPipe } from './telemetry-validation.pipe';

class StrictDto {
  @IsString()
  name: string;
}

class TelemetryDto {
  static readonly telemetryReport = true;

  @IsString()
  name: string;

  @IsInt()
  count: number;
}

class NestedTelemetryDto {
  static readonly telemetryReport = true;

  @ValidateNested()
  @Type(() => TelemetryDto)
  item: TelemetryDto;
}

const bodyMetadata = (metatype: unknown) =>
  ({ type: 'body', metatype }) as Parameters<
    TelemetryValidationPipe['transform']
  >[1];

describe('TelemetryValidationPipe', () => {
  const pipe = new TelemetryValidationPipe();

  it('业务 DTO 仍走严格校验：未知字段直接拒绝', async () => {
    await expect(
      pipe.transform({ name: 'a', extra: 1 }, bodyMetadata(StrictDto)),
    ).rejects.toThrow();
  });

  it('遥测 DTO 剥离未知字段但不拒绝', async () => {
    const result = (await pipe.transform(
      { name: 'a', count: '3', extra: 1 },
      bodyMetadata(TelemetryDto),
    )) as TelemetryDto;

    expect(result).toBeInstanceOf(TelemetryDto);
    expect(result.count).toBe(3);
    expect(result).not.toHaveProperty('extra');
  });

  it('遥测 DTO 校验失败时降级接收而不是丢弃上报', async () => {
    // 缺少必填字段：严格分支会 400，遥测分支必须降级
    const result = (await pipe.transform(
      { count: 2 },
      bodyMetadata(TelemetryDto),
    )) as TelemetryDto;

    expect(result).toBeInstanceOf(TelemetryDto);
    expect(result.count).toBe(2);
  });

  it('遥测 DTO 传入非对象时不抛异常', async () => {
    await expect(
      pipe.transform(null, bodyMetadata(TelemetryDto)),
    ).resolves.toEqual({});
    await expect(
      pipe.transform('oops', bodyMetadata(TelemetryDto)),
    ).resolves.toEqual({});
  });

  it('嵌套遥测 DTO 同样走宽松分支', async () => {
    const result = (await pipe.transform(
      { item: { name: 'a', count: 1, extra: true } },
      bodyMetadata(NestedTelemetryDto),
    )) as NestedTelemetryDto;

    expect(result.item.count).toBe(1);
  });
});

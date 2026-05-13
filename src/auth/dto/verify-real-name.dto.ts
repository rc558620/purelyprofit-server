import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Matches, MinLength } from 'class-validator';

const ID_NUMBER_PATTERN =
  /^[1-9]\d{5}(18|19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{3}[\dX]$/;

function trimStringValue(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function normalizeIdNumberValue(value: unknown): unknown {
  return typeof value === 'string'
    ? value.replace(/\s+/g, '').toUpperCase()
    : value;
}

export class VerifyRealNameDto {
  @ApiProperty({ example: '张三', description: '真实姓名' })
  @Transform(({ value }: { value: unknown }) => trimStringValue(value))
  @IsString({ message: '真实姓名必须是字符串' })
  @MinLength(1, { message: '请输入真实姓名' })
  realName: string;

  @ApiProperty({
    example: '110101199001011234',
    description: '18 位身份证号码',
  })
  @Transform(({ value }: { value: unknown }) => normalizeIdNumberValue(value))
  @IsString({ message: '身份证号码必须是字符串' })
  @Matches(ID_NUMBER_PATTERN, { message: '请输入正确的 18 位身份证号码' })
  idNumber: string;
}

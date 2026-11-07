import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

function transformTrimmedString(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  return value.trim();
}

export class RejectWithdrawalDto {
  @ApiProperty({
    example: '账户信息不匹配，请核对后重新提交',
    description: '拒绝原因',
  })
  @Transform(({ value }) => transformTrimmedString(value))
  @IsNotEmpty({ message: '拒绝原因不能为空' })
  @IsString({ message: '拒绝原因必须是字符串' })
  @MaxLength(100, { message: '拒绝原因最多 100 位' })
  reason: string;
}

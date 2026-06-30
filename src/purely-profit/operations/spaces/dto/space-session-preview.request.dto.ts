import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class RenewPreviewRequestDto {
  @ApiProperty({ example: 30, description: '续费金额（元）' })
  @Type(() => Number)
  @IsNumber({}, { message: '续费金额必须是数字' })
  @Min(0.01, { message: '续费金额必须大于 0' })
  amount: number;
}

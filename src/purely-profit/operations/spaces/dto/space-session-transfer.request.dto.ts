import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

export class TransferSpaceSessionDto {
  @ApiProperty({ example: 2, description: '目标空间 ID' })
  @Type(() => Number)
  @IsInt({ message: '目标空间 ID 必须是整数' })
  @Min(1, { message: '目标空间 ID 必须大于等于 1' })
  targetSpaceId: number;
}

import { ApiProperty } from '@nestjs/swagger';
import { IsInt } from 'class-validator';

export class StoreSeatSummaryDto {
  @ApiProperty({ example: 3, description: '门店可用账号席位上限' })
  @IsInt({ message: '门店可用账号席位上限必须是整数' })
  maxAccountSeats: number;

  @ApiProperty({ example: 2, description: '当前已激活账号席位数' })
  @IsInt({ message: '当前已激活账号席位数必须是整数' })
  activeSeatCount: number;

  @ApiProperty({ example: 1, description: '当前剩余可激活账号席位数' })
  @IsInt({ message: '当前剩余可激活账号席位数必须是整数' })
  availableSeatCount: number;
}

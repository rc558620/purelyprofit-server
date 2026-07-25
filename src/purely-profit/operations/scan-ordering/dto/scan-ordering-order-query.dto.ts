import { ApiPropertyOptional } from '@nestjs/swagger';
import { ScanOrderStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

/** 商家扫码点餐订单队列筛选条件。 */
export class ListScanOrderingOrdersDto {
  @ApiPropertyOptional({ enum: ScanOrderStatus })
  @IsOptional()
  @IsEnum(ScanOrderStatus, { message: '订单状态不合法' })
  status?: ScanOrderStatus;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '桌台主键必须是整数' })
  @Min(1, { message: '桌台主键不合法' })
  tableId?: number;

  @ApiPropertyOptional({ example: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '游标必须是整数' })
  @Min(1, { message: '游标不合法' })
  cursor?: number;

  @ApiPropertyOptional({ example: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '分页大小必须是整数' })
  @Min(1, { message: '分页大小至少为 1' })
  @Max(100, { message: '分页大小不能超过 100' })
  limit?: number;
}

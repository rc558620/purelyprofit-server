import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** 商家扫码点餐订单队列筛选条件。 */
export class ListScanOrderingOrdersDto {
  @ApiPropertyOptional({
    description: '接单队列订单状态',
    enum: ['pending_acceptance', 'preparing'],
  })
  @IsOptional()
  @IsIn(['pending_acceptance', 'preparing'], {
    message: '仅支持筛选待接单或制作中订单',
  })
  status?: 'pending_acceptance' | 'preparing';

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '桌台主键必须是整数' })
  @Min(1, { message: '桌台主键不合法' })
  tableId?: number;

  @ApiPropertyOptional({ description: '桌号关键词 (模糊搜索)' })
  @IsOptional()
  @IsString({ message: '桌号关键词必须是字符串' })
  @MaxLength(50, { message: '桌号关键词不能超过 50 个字符' })
  tableKeyword?: string;

  @ApiPropertyOptional({ description: '客人姓名关键词 (模糊搜索)' })
  @IsOptional()
  @IsString({ message: '客人姓名关键词必须是字符串' })
  @MaxLength(50, { message: '客人姓名关键词不能超过 50 个字符' })
  guestKeyword?: string;

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

  @ApiPropertyOptional({ description: '开始时间 ISO8601 格式' })
  @IsOptional()
  @IsString({ message: '开始时间格式不合法' })
  @MaxLength(30, { message: '开始时间格式过长' })
  startTime?: string;

  @ApiPropertyOptional({ description: '结束时间 ISO8601 格式' })
  @IsOptional()
  @IsString({ message: '结束时间格式不合法' })
  @MaxLength(30, { message: '结束时间格式过长' })
  endTime?: string;
}

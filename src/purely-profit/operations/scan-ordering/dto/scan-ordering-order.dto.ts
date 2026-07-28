import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ScanOrderStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** 商家处理订单状态请求。 */
export class ProcessScanOrderingOrderDto {
  @ApiProperty({ example: 1, description: '订单当前乐观锁版本' })
  @IsInt({ message: '订单版本必须是整数' })
  @Min(1, { message: '订单版本必须大于 0' })
  version: number;
}

/** 拒单或取消时的原因与乐观锁版本。 */
export class RejectOrCancelScanOrderingOrderDto extends ProcessScanOrderingOrderDto {
  @ApiProperty({ example: '食材售罄', description: '拒单或取消原因' })
  @IsString({ message: '处理原因必须是字符串' })
  @MaxLength(200, { message: '处理原因不能超过 200 个字符' })
  reason: string;
}

/** 商家确认退款完成请求。 */
export class CompleteScanOrderingRefundDto extends ProcessScanOrderingOrderDto {
  @ApiPropertyOptional({
    example: 'R20260723143000001',
    description: '微信退款单号（如有）',
  })
  @IsOptional()
  @IsString({ message: '退款单号必须是字符串' })
  @MaxLength(64, { message: '退款单号不能超过 64 个字符' })
  providerRefundNo?: string;

  @ApiPropertyOptional({
    example: '4200000000202607230000000001',
    description: '微信退款 ID（如有）',
  })
  @IsOptional()
  @IsString({ message: '退款 ID 必须是字符串' })
  @MaxLength(128, { message: '退款 ID 不能超过 128 个字符' })
  providerRefundId?: string;
}

/** 商家订单队列筛选参数。 */
export class ListScanOrderingOrdersQueryDto {
  @ApiPropertyOptional({ enum: ScanOrderStatus })
  @IsOptional()
  @IsEnum(ScanOrderStatus, { message: '订单状态不合法' })
  status?: ScanOrderStatus;

  @ApiPropertyOptional({ example: 1, description: '桌台主键' })
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

  @ApiPropertyOptional({ example: 100, description: '最后一条订单主键游标' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '游标必须是整数' })
  @Min(1, { message: '游标不合法' })
  cursor?: number;

  @ApiPropertyOptional({ example: 20, description: '每页数量' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '分页数量必须是整数' })
  @Min(1, { message: '分页数量至少为 1' })
  @Max(100, { message: '分页数量不能超过 100' })
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

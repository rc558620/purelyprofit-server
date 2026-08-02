import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ScanOrderServiceCallType } from '@prisma/client';

export class ResolveClubScanQrDto {
  @ApiProperty({ description: '桌台二维码携带的明文 token' })
  @IsString({ message: 'qrToken 必须是字符串' })
  @MaxLength(1024, { message: 'qrToken 不能超过 1024 个字符' })
  qrToken: string;
}

export class CreateClubScanSessionDto {
  @ApiProperty({ description: '桌码解析后获得的短期扫码凭据' })
  @IsString({ message: 'scanToken 必须是字符串' })
  scanToken: string;

  @ApiPropertyOptional({ description: '就餐人数', minimum: 1, maximum: 99 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'guestCount 必须是整数' })
  @Min(1, { message: 'guestCount 最少为 1' })
  @Max(99, { message: 'guestCount 最多为 99' })
  guestCount?: number;
}

export class UpdateClubScanSessionDto {
  @ApiProperty({ description: '就餐人数', minimum: 1, maximum: 99 })
  @Type(() => Number)
  @IsInt({ message: 'guestCount 必须是整数' })
  @Min(1, { message: 'guestCount 最少为 1' })
  @Max(99, { message: 'guestCount 最多为 99' })
  guestCount: number;
}

export class ClubScanSessionQueryDto {
  @ApiProperty({ description: '当前点餐会话 ID' })
  @Type(() => Number)
  @IsInt({ message: 'sessionId 必须是整数' })
  @Min(1, { message: 'sessionId 必须大于 0' })
  sessionId: number;
}

export class QuoteClubScanCartItemDto extends ClubScanSessionQueryDto {
  @ApiProperty({ description: '菜单商品 ID' })
  @Type(() => Number)
  @IsInt({ message: 'productId 必须是整数' })
  @Min(1, { message: 'productId 必须大于 0' })
  productId: number;

  @ApiProperty({ description: '规格项 ID 列表', type: [Number] })
  @IsArray({ message: 'specOptionIds 必须是数组' })
  @ArrayUnique({ message: 'specOptionIds 不能重复' })
  @Type(() => Number)
  @IsInt({ each: true, message: 'specOptionIds 必须均为整数' })
  specOptionIds: number[];
}

export class AddClubScanCartItemDto extends ClubScanSessionQueryDto {
  @ApiProperty({ description: '菜单商品 ID' })
  @Type(() => Number)
  @IsInt({ message: 'productId 必须是整数' })
  @Min(1, { message: 'productId 必须大于 0' })
  productId: number;

  @ApiProperty({ description: '数量', minimum: 1, maximum: 99 })
  @Type(() => Number)
  @IsInt({ message: 'quantity 必须是整数' })
  @Min(1, { message: 'quantity 最少为 1' })
  @Max(99, { message: 'quantity 最多为 99' })
  quantity: number;

  @ApiProperty({ description: '规格项 ID 列表', type: [Number] })
  @IsArray({ message: 'specOptionIds 必须是数组' })
  @ArrayUnique({ message: 'specOptionIds 不能重复' })
  @Type(() => Number)
  @IsInt({ each: true, message: 'specOptionIds 必须均为整数' })
  specOptionIds: number[];
}

export class UpdateClubScanCartItemDto {
  @ApiProperty({ description: '数量', minimum: 1, maximum: 99 })
  @Type(() => Number)
  @IsInt({ message: 'quantity 必须是整数' })
  @Min(1, { message: 'quantity 最少为 1' })
  @Max(99, { message: 'quantity 最多为 99' })
  quantity: number;

  @ApiProperty({ description: '购物车行乐观锁版本' })
  @Type(() => Number)
  @IsInt({ message: 'version 必须是整数' })
  @Min(1, { message: 'version 最少为 1' })
  version: number;
}

export class PreviewClubScanOrderDto extends ClubScanSessionQueryDto {
  @ApiProperty({ description: '购物车版本' })
  @Type(() => Number)
  @IsInt({ message: 'cartVersion 必须是整数' })
  @Min(0, { message: 'cartVersion 不能小于 0' })
  cartVersion: number;

  @ApiProperty({ description: '就餐人数', minimum: 1, maximum: 99 })
  @Type(() => Number)
  @IsInt({ message: 'guestCount 必须是整数' })
  @Min(1, { message: 'guestCount 最少为 1' })
  @Max(99, { message: 'guestCount 最多为 99' })
  guestCount: number;

  @ApiPropertyOptional({ description: '是否使用积分抵扣', default: false })
  @IsOptional()
  @IsBoolean({ message: 'usePoints 必须是布尔值' })
  usePoints?: boolean;

  @ApiPropertyOptional({ description: '用户备注', maxLength: 200 })
  @IsOptional()
  @IsString({ message: 'remark 必须是字符串' })
  @MaxLength(200, { message: 'remark 不能超过 200 个字符' })
  remark?: string;
}

export class CreateClubScanOrderDto extends PreviewClubScanOrderDto {
  @ApiProperty({ description: '服务端预览版本' })
  @IsString({ message: 'pricingVersion 必须是字符串' })
  pricingVersion: string;
}

export class ListClubScanOrdersQueryDto {
  @ApiPropertyOptional({ description: '游标订单 ID' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'cursor 必须是整数' })
  @Min(1, { message: 'cursor 必须大于 0' })
  cursor?: number;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit 必须是整数' })
  @Min(1, { message: 'limit 最少为 1' })
  @Max(50, { message: 'limit 最多为 50' })
  limit?: number;

  @ApiPropertyOptional({ description: '订单状态' })
  @IsOptional()
  @IsIn(
    [
      'pending_payment',
      'pending_acceptance',
      'preparing',
      'served',
      'completed',
      'cancelled',
      'rejected',
      'refunding',
    ],
    { message: 'status 不合法' },
  )
  status?: string;
}

export class CreateClubScanPaymentDto {
  @ApiProperty({ description: '微信 JSAPI 用户 openid' })
  @IsString({ message: 'openid 必须是字符串' })
  @MaxLength(128, { message: 'openid 不能超过 128 个字符' })
  openid: string;
}

export class CreateClubScanBalancePaymentDto {
  @ApiProperty({ description: '订单乐观锁版本' })
  @Type(() => Number)
  @IsInt({ message: 'version 必须是整数' })
  @Min(0, { message: 'version 不能小于 0' })
  version: number;
}

export class CancelClubScanOrderDto {
  @ApiProperty({ description: '订单乐观锁版本' })
  @Type(() => Number)
  @IsInt({ message: 'version 必须是整数' })
  @Min(0, { message: 'version 不能小于 0' })
  version: number;
}

export class CreateClubScanServiceCallDto extends ClubScanSessionQueryDto {
  @ApiProperty({ enum: ScanOrderServiceCallType, description: '服务呼叫类型' })
  @IsEnum(ScanOrderServiceCallType, { message: 'type 不合法' })
  type: ScanOrderServiceCallType;

  @ApiPropertyOptional({ description: '呼叫备注', maxLength: 200 })
  @IsOptional()
  @IsString({ message: 'remark 必须是字符串' })
  @MaxLength(200, { message: 'remark 不能超过 200 个字符' })
  remark?: string;
}

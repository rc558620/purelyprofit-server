import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

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

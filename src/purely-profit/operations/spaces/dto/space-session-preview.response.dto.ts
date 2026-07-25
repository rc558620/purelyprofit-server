import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LivePreviewResponseDto {
  @ApiProperty({
    example: 1715695200000,
    description: '预览计算基准时间戳（毫秒）',
  })
  asOf: number;

  @ApiProperty({ example: 95, description: '当前计费总分钟数' })
  durationMinutes: number;

  @ApiProperty({ example: '1小时35分钟', description: '时长文案' })
  durationLabel: string;

  @ApiProperty({ example: 108, description: '时间费用（元）' })
  timeCost: number;

  @ApiProperty({ example: 26, description: '商品费用（元）' })
  itemsCost: number;

  @ApiProperty({ example: 30, description: '续费抵扣（元）' })
  renewDeduction: number;

  @ApiProperty({ example: 20, description: '预付款（元）' })
  prepaidDeduction: number;

  @ApiProperty({ example: 84, description: '待付总金额（元）' })
  totalAmount: number;

  @ApiPropertyOptional({ example: 'timed', description: '台位费计费口径' })
  timeFeeMode?: string;

  @ApiPropertyOptional({ example: 'timed', description: '倒计时台位费口径' })
  countdownFeeMode?: string;
}

export class RenewPreviewResponseDto {
  @ApiProperty({ example: 30, description: '续费金额（元）' })
  amount: number;

  @ApiProperty({ example: 26, description: '换算追加分钟数' })
  addedMinutes: number;

  @ApiProperty({ example: '26分钟', description: '时长文案' })
  durationLabel: string;

  @ApiProperty({ example: true, description: '续费是否有效' })
  valid: boolean;

  @ApiPropertyOptional({
    example: '续费金额不足以换算有效时长',
    description: '无效原因',
  })
  reason?: string;
}

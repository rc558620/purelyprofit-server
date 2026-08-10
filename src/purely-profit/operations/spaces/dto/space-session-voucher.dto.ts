// 空间会话-纯利宝团购券读取接口 DTO（商家开台读取券码回填表单）
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsString, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

/** 读取团购券入参 */
export class ReadSpaceSessionVoucherDto {
  @ApiProperty({ example: 18, description: '当前门店 ID（券码归属门店校验）' })
  @Type(() => Number)
  @IsInt({ message: 'storeId 必须是整数' })
  @Min(1, { message: 'storeId 必须大于等于 1' })
  storeId: number;

  @ApiProperty({ example: 'VC20260810143000001', description: '团购券码' })
  @IsString({ message: '团购券码必须是字符串' })
  @MaxLength(50, { message: '团购券码最长 50 个字符' })
  voucherCode: string;
}

/** 开台计费预配置：团购券商品上保存的开台字段，供读取券码后快速回填 */
export class SpaceSessionVoucherBillingConfigDto {
  @ApiProperty({
    example: 'items',
    description:
      '计费方式：items=纯消费 timed=纯计时 mixed=混合 countdown=倒计时',
  })
  billingMode: string;

  @ApiPropertyOptional({
    example: 4000,
    description: '计时单价（分，billingMode=timed/mixed 时有效）',
  })
  hourlyRateFen: number | null;

  @ApiPropertyOptional({
    example: 60,
    description: '预设时长（分钟，billingMode=countdown 时有效）',
  })
  countdownMinutes: number | null;

  @ApiPropertyOptional({
    example: 2000,
    description: '台位费（分，billingMode=countdown 时有效）',
  })
  countdownPriceFen: number | null;

  @ApiProperty({
    example: false,
    description: '到时自动结账（billingMode=countdown 时有效）',
  })
  autoCheckout: boolean;
}

/** 读取团购券响应：开台表单回填信息 */
export class ReadSpaceSessionVoucherResponseDto {
  @ApiProperty({ example: 'chunlibao', description: '团购平台' })
  platform: string;

  @ApiProperty({ example: 'VC20260810143000001', description: '团购券码' })
  voucherCode: string;

  @ApiPropertyOptional({
    example: '张先生',
    description: '顾客姓名（purelyClub 昵称）',
  })
  guestName: string | null;

  @ApiPropertyOptional({ example: '13800138000', description: '客人电话' })
  guestPhone: string | null;

  @ApiPropertyOptional({ example: 2, description: '到店人数' })
  personCount: number | null;

  @ApiProperty({ example: 'member', description: '顾客类型' })
  guestType: string;

  @ApiProperty({ example: 12850, description: '券面金额（分）' })
  faceAmountFen: number;

  @ApiProperty({ example: 20000, description: 'purelyClub 在途余额（分）' })
  balanceFen: number;

  @ApiProperty({ example: '小包套餐', description: '购买商品名称' })
  productName: string;

  @ApiProperty({ example: 1, description: '购买数量' })
  quantity: number;

  @ApiProperty({ example: 'pending', description: '券状态' })
  status: string;

  /** 开台计费预配置（券对应团购券商品；无配置时为空） */
  @ApiPropertyOptional({
    type: SpaceSessionVoucherBillingConfigDto,
    nullable: true,
  })
  billing?: SpaceSessionVoucherBillingConfigDto | null;
}

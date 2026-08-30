import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { CommissionAssignmentDto } from '../../commission/dto/commission-assignment.dto';
import {
  SPACE_BILLING_MODE_VALUES,
  type SpaceBillingModeValue,
} from '../spaces.constants';
import {
  GROUPON_PLATFORM_VALUES,
  SPACE_CUSTOMER_PAYMENT_METHOD_VALUES,
  SPACE_PREPAID_PAYMENT_METHOD_VALUES,
  SPACE_SESSION_CONTACT_PATTERN,
  SPACE_SETTLEMENT_CHANNEL_VALUES,
  type SpaceCustomerPaymentMethodValue,
  type SpacePrepaidPaymentMethodValue,
  type SpaceSettlementChannelValue,
} from './space-session.constants';

export class OpenSpaceSessionDto {
  @ApiPropertyOptional({ example: 1, description: '空间 ID（兼容根路径开台）' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '空间 ID 必须是整数' })
  @Min(1, { message: '空间 ID 必须大于等于 1' })
  spaceId?: number;

  @ApiPropertyOptional({ example: '张先生', description: '顾客姓名' })
  @IsOptional()
  @IsString({ message: '顾客姓名必须是字符串' })
  @MaxLength(20, { message: '顾客姓名最长 20 个字符' })
  guestName?: string;

  @ApiPropertyOptional({ example: '13800138000', description: '顾客电话' })
  @IsOptional()
  @IsString({ message: '顾客电话必须是字符串' })
  @MaxLength(20, { message: '顾客电话最长 20 个字符' })
  @Matches(SPACE_SESSION_CONTACT_PATTERN, {
    message: '顾客电话格式不正确，请输入 6-20 位数字或常见联系电话格式',
  })
  guestPhone?: string;

  @ApiPropertyOptional({ example: 4, description: '顾客人数' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '顾客人数必须是整数' })
  @Min(1, { message: '顾客人数必须大于等于 1' })
  @Max(999, { message: '顾客人数必须小于等于 999' })
  guestCount?: number;

  @ApiProperty({
    example: 'items',
    description: '计费模式',
    enum: SPACE_BILLING_MODE_VALUES,
  })
  @IsIn(SPACE_BILLING_MODE_VALUES, { message: '计费模式不合法' })
  billingMode: SpaceBillingModeValue;

  @ApiPropertyOptional({
    example: 68,
    description: '计时单价/倒计时台位费（元）',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: '计时单价必须是数字' })
  @Min(0.01, { message: '计时单价必须大于 0' })
  hourlyRate?: number;

  @ApiPropertyOptional({ example: 60, description: '倒计时总时长（分钟）' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '倒计时时长必须是整数' })
  @Min(1, { message: '倒计时时长必须大于 0' })
  countdownMinutes?: number;

  @ApiPropertyOptional({ example: true, description: '倒计时到期是否自动结账' })
  @IsOptional()
  @IsBoolean({ message: '自动结账标记必须是布尔值' })
  autoCheckout?: boolean;

  @ApiPropertyOptional({
    example: '12',
    description: '从预约转开台时关联的预约 ID',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '预约 ID 必须是整数' })
  @Min(1, { message: '预约 ID 必须大于等于 1' })
  reservationId?: number;

  @ApiPropertyOptional({
    example: 'cash',
    description: '预付支付方式（自动结账时）',
    enum: SPACE_PREPAID_PAYMENT_METHOD_VALUES,
  })
  @IsOptional()
  @IsIn(SPACE_PREPAID_PAYMENT_METHOD_VALUES, {
    message: '预付支付方式不合法',
  })
  prepaidPaymentMethod?: SpacePrepaidPaymentMethodValue;

  @ApiPropertyOptional({
    example: 'groupon_voucher',
    description: '预付顾客支付方式',
    enum: SPACE_CUSTOMER_PAYMENT_METHOD_VALUES,
  })
  @IsOptional()
  @IsIn(SPACE_CUSTOMER_PAYMENT_METHOD_VALUES, {
    message: '预付顾客支付方式不合法',
  })
  prepaidCustomerPaymentMethod?: SpaceCustomerPaymentMethodValue;

  @ApiPropertyOptional({
    example: 'meituan_groupon',
    description: '预付结算渠道',
    enum: SPACE_SETTLEMENT_CHANNEL_VALUES,
  })
  @IsOptional()
  @IsIn(SPACE_SETTLEMENT_CHANNEL_VALUES, { message: '预付结算渠道不合法' })
  prepaidSettlementChannel?: SpaceSettlementChannelValue;

  @ApiPropertyOptional({ example: 'MT123456', description: '预付团购券码' })
  @IsOptional()
  @IsString({ message: '预付团购券码必须是字符串' })
  @MaxLength(50, { message: '预付团购券码最长 50 个字符' })
  prepaidGrouponCode?: string;

  @ApiPropertyOptional({
    example: 'meituan',
    description: '预付团购平台',
    enum: GROUPON_PLATFORM_VALUES,
  })
  @IsOptional()
  @IsIn(GROUPON_PLATFORM_VALUES, { message: '预付团购平台不合法' })
  prepaidGrouponPlatform?: string;

  @ApiPropertyOptional({ example: 'MT123456', description: '预付券码' })
  @IsOptional()
  @IsString({ message: '预付券码必须是字符串' })
  @MaxLength(50, { message: '预付券码最长 50 个字符' })
  prepaidVoucherCode?: string;

  @ApiPropertyOptional({
    example: 'meituan',
    description: '预付券所属平台',
    enum: GROUPON_PLATFORM_VALUES,
  })
  @IsOptional()
  @IsIn(GROUPON_PLATFORM_VALUES, { message: '预付券所属平台不合法' })
  prepaidVoucherPlatform?: string;

  @ApiPropertyOptional({ example: '美团团购券', description: '预付备注' })
  @IsOptional()
  @IsString({ message: '预付备注必须是字符串' })
  @MaxLength(200, { message: '预付备注最长 200 个字符' })
  prepaidNote?: string;

  @ApiPropertyOptional({ example: 88, description: '预付金额（元）' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: '预付金额必须是数字' })
  @Min(0.01, { message: '预付金额必须大于 0' })
  @Max(100000, { message: '预付金额不能超过 ¥100,000' })
  prepaidAmount?: number;

  @ApiPropertyOptional({ example: 88, description: '预付券面金额（元）' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: '预付券面金额必须是数字' })
  @Min(0.01, { message: '预付券面金额必须大于 0' })
  @Max(100000, { message: '预付券面金额不能超过 ¥100,000' })
  prepaidVoucherFaceAmount?: number;

  @ApiPropertyOptional({
    type: [CommissionAssignmentDto],
    description:
      '技师提成分配（仅非餐饮门店；commission 缺省时后端按配置解析）',
  })
  @IsOptional()
  @IsArray({ message: '提成分配必须是数组' })
  @ValidateNested({ each: true })
  @Type(() => CommissionAssignmentDto)
  commissionAssignments?: CommissionAssignmentDto[];
}

// ─── 营销中心 Query / Body DTOs ─────────────────────────────────────────
//
// 说明：
//  - 所有金额字段以"分"为单位（整数），前端以"元"展示时自行转换
//  - 所有时间戳以"毫秒"为单位（number），与前端 Date.getTime() 对齐
//  - 枚举值使用小写字符串（与前端 types.ts 完全一致）

import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  transformOptionalInt,
  transformOptionalKeyword,
} from '../../stores/dto/store-response.dto';
import {
  MARKETING_CUSTOMER_TIER_VALUES,
  MARKETING_PAY_TYPE_VALUES,
  MARKETING_POINTS_CHANGE_TYPE_VALUES,
  MARKETING_PROMOTION_TYPE_VALUES,
  MARKETING_RECHARGE_TYPE_VALUES,
  type MarketingCustomerStatus,
  type MarketingCustomerTierValue,
  type MarketingPayTypeValue,
  type MarketingPointsChangeTypeValue,
  type MarketingPromotionStatus,
  type MarketingPromotionTypeValue,
  type MarketingRechargeTypeValue,
} from '../marketing.utils';

// ─── 通用分页 ─────────────────────────────────────────────────────────

export class MarketingPageQueryDto {
  @ApiPropertyOptional({ example: 1, description: '页码，从 1 开始' })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '页码必须是整数' })
  @Min(1, { message: '页码必须大于等于 1' })
  page?: number;

  @ApiPropertyOptional({ example: 20, description: '每页数量' })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '每页数量必须是整数' })
  @Min(1, { message: '每页数量必须大于等于 1' })
  pageSize?: number;
}

// ─── 顾客相关 ─────────────────────────────────────────────────────────

const CUSTOMER_STATUS_VALUES = [
  'active',
  'dormant',
  'lost',
] as const satisfies readonly MarketingCustomerStatus[];

export class ListCustomersQueryDto extends MarketingPageQueryDto {
  @ApiPropertyOptional({
    example: 'active',
    enum: CUSTOMER_STATUS_VALUES,
    description: '顾客活跃状态（active=30天内消费 dormant=31-90天 lost=91天+）',
  })
  @IsOptional()
  @IsIn(CUSTOMER_STATUS_VALUES, { message: '无效的顾客状态' })
  status?: MarketingCustomerStatus;

  @ApiPropertyOptional({
    example: 'silver',
    enum: MARKETING_CUSTOMER_TIER_VALUES,
    description: '会员等级筛选',
  })
  @IsOptional()
  @IsIn(MARKETING_CUSTOMER_TIER_VALUES, { message: '无效的会员等级' })
  tier?: MarketingCustomerTierValue;

  @ApiPropertyOptional({ example: '张三', description: '姓名 / 手机号关键字' })
  @IsOptional()
  @Transform(transformOptionalKeyword)
  @IsString({ message: '关键字必须是字符串' })
  @MaxLength(50, { message: '关键字最长 50 个字符' })
  keyword?: string;
}

export class CreateCustomerDto {
  @ApiPropertyOptional({ example: '张三', description: '顾客姓名' })
  @IsString({ message: '姓名必须是字符串' })
  @MinLength(1, { message: '姓名不能为空' })
  @MaxLength(50, { message: '姓名最长 50 个字符' })
  name: string;

  @ApiPropertyOptional({
    example: '13800138000',
    description: '手机号（可选）',
  })
  @IsOptional()
  @IsString({ message: '手机号必须是字符串' })
  @MaxLength(20, { message: '手机号最长 20 个字符' })
  phone?: string;

  @ApiPropertyOptional({
    example: 'https://cdn.example.com/avatar.jpg',
    description: '头像 URL（可选）',
  })
  @IsOptional()
  @IsString({ message: '头像必须是字符串' })
  @MaxLength(500, { message: '头像 URL 最长 500 个字符' })
  avatar?: string;

  @ApiPropertyOptional({ example: 'VIP 老顾客', description: '备注（可选）' })
  @IsOptional()
  @IsString({ message: '备注必须是字符串' })
  @MaxLength(500, { message: '备注最长 500 个字符' })
  remark?: string;
}

export class UpdateCustomerDto {
  @ApiPropertyOptional({ example: '张三', description: '顾客姓名' })
  @IsOptional()
  @IsString({ message: '姓名必须是字符串' })
  @MinLength(1, { message: '姓名不能为空' })
  @MaxLength(50, { message: '姓名最长 50 个字符' })
  name?: string;

  @ApiPropertyOptional({
    example: '13800138000',
    description: '手机号（空字符串表示清除）',
  })
  @IsOptional()
  @IsString({ message: '手机号必须是字符串' })
  @MaxLength(20, { message: '手机号最长 20 个字符' })
  phone?: string;

  @ApiPropertyOptional({
    example: 'https://cdn.example.com/avatar.jpg',
    description: '头像 URL',
  })
  @IsOptional()
  @IsString({ message: '头像必须是字符串' })
  @MaxLength(500, { message: '头像 URL 最长 500 个字符' })
  avatar?: string;

  @ApiPropertyOptional({
    example: 'VIP 老顾客',
    description: '备注（空字符串表示清除）',
  })
  @IsOptional()
  @IsString({ message: '备注必须是字符串' })
  @MaxLength(500, { message: '备注最长 500 个字符' })
  remark?: string;
}

// ─── 储值记录相关 ─────────────────────────────────────────────────────

export class ListRechargesQueryDto extends MarketingPageQueryDto {
  @ApiPropertyOptional({ example: 1, description: '顾客 ID（不传则查全店）' })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '顾客 ID 必须是整数' })
  @Min(1, { message: '顾客 ID 必须大于等于 1' })
  customerId?: number;

  @ApiPropertyOptional({
    example: 1715000000000,
    description: '查询开始时间（毫秒时间戳，包含）',
  })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '开始时间必须是整数' })
  @Min(0)
  startMs?: number;

  @ApiPropertyOptional({
    example: 1715086399999,
    description: '查询结束时间（毫秒时间戳，包含）',
  })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '结束时间必须是整数' })
  @Min(0)
  endMs?: number;
}

export class ListCustomerRechargesQueryDto extends MarketingPageQueryDto {}

export class ListPointsRecordsQueryDto extends MarketingPageQueryDto {
  @ApiPropertyOptional({ example: 1, description: '顾客 ID（不传则查全店）' })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '顾客 ID 必须是整数' })
  @Min(1, { message: '顾客 ID 必须大于等于 1' })
  customerId?: number;

  @ApiPropertyOptional({
    example: 'spend',
    enum: MARKETING_POINTS_CHANGE_TYPE_VALUES,
    description: '积分流水类型筛选',
  })
  @IsOptional()
  @IsIn(MARKETING_POINTS_CHANGE_TYPE_VALUES, { message: '无效的积分流水类型' })
  type?: MarketingPointsChangeTypeValue;

  @ApiPropertyOptional({
    example: 1715000000000,
    description: '查询开始时间（毫秒时间戳，包含）',
  })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '开始时间必须是整数' })
  @Min(0)
  startMs?: number;

  @ApiPropertyOptional({
    example: 1715086399999,
    description: '查询结束时间（毫秒时间戳，包含）',
  })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '结束时间必须是整数' })
  @Min(0)
  endMs?: number;
}

export class ListCustomerPointsRecordsQueryDto extends MarketingPageQueryDto {
  @ApiPropertyOptional({
    example: 'spend',
    enum: MARKETING_POINTS_CHANGE_TYPE_VALUES,
    description: '积分流水类型筛选',
  })
  @IsOptional()
  @IsIn(MARKETING_POINTS_CHANGE_TYPE_VALUES, { message: '无效的积分流水类型' })
  type?: MarketingPointsChangeTypeValue;

  @ApiPropertyOptional({
    example: 1715000000000,
    description: '查询开始时间（毫秒时间戳，包含）',
  })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '开始时间必须是整数' })
  @Min(0)
  startMs?: number;

  @ApiPropertyOptional({
    example: 1715086399999,
    description: '查询结束时间（毫秒时间戳，包含）',
  })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '结束时间必须是整数' })
  @Min(0)
  endMs?: number;
}

export class CreateRechargeDto {
  @ApiPropertyOptional({ example: 1, description: '顾客 ID' })
  @Transform(transformOptionalInt)
  @IsInt({ message: '顾客 ID 必须是整数' })
  @Min(1, { message: '顾客 ID 必须大于等于 1' })
  customerId: number;

  @ApiPropertyOptional({ example: 10000, description: '充值金额（分）' })
  @IsInt({ message: '充值金额必须是整数' })
  @Min(1, { message: '充值金额必须大于 0' })
  amount: number;

  @ApiPropertyOptional({
    example: 1000,
    description: '赠送金额（分），不赠则传 0',
  })
  @IsOptional()
  @IsInt({ message: '赠送金额必须是整数' })
  @Min(0, { message: '赠送金额不能为负' })
  giftAmount?: number;

  @ApiPropertyOptional({
    example: 'recharge',
    enum: MARKETING_RECHARGE_TYPE_VALUES,
    description: '类型（recharge=储值 gift=纯赠送 refund=退款）',
  })
  @IsOptional()
  @IsIn(MARKETING_RECHARGE_TYPE_VALUES, { message: '无效的充值类型' })
  type?: MarketingRechargeTypeValue;

  @ApiPropertyOptional({ example: 3, description: '关联活动 ID（可选）' })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '活动 ID 必须是整数' })
  @Min(1)
  promotionId?: number;

  @ApiPropertyOptional({ example: '半年卡储值', description: '备注（可选）' })
  @IsOptional()
  @IsString({ message: '备注必须是字符串' })
  @MaxLength(200, { message: '备注最长 200 个字符' })
  note?: string;
}

// ─── 消费记录相关 ─────────────────────────────────────────────────────

export class CreateConsumptionDto {
  @ApiPropertyOptional({ example: 1, description: '顾客 ID' })
  @Transform(transformOptionalInt)
  @IsInt({ message: '顾客 ID 必须是整数' })
  @Min(1)
  customerId: number;

  @ApiPropertyOptional({ example: 5800, description: '消费金额（分）' })
  @IsInt({ message: '消费金额必须是整数' })
  @Min(1, { message: '消费金额必须大于 0' })
  amount: number;

  @ApiPropertyOptional({
    example: 2000,
    description: '余额支付金额（分），0 表示全部现金',
  })
  @IsOptional()
  @IsInt({ message: '余额支付金额必须是整数' })
  @Min(0)
  balancePaid?: number;

  @ApiPropertyOptional({ example: 0, description: '积分抵扣金额（分）' })
  @IsOptional()
  @IsInt({ message: '积分抵扣金额必须是整数' })
  @Min(0)
  pointsDeducted?: number;

  @ApiPropertyOptional({
    example: 'cash',
    enum: MARKETING_PAY_TYPE_VALUES,
    description: '支付方式',
  })
  @IsOptional()
  @IsIn(MARKETING_PAY_TYPE_VALUES, { message: '无效的支付方式' })
  payType?: MarketingPayTypeValue;

  @ApiPropertyOptional({ example: '拿铁 × 2', description: '商品简述（可选）' })
  @IsOptional()
  @IsString({ message: '商品简述必须是字符串' })
  @MaxLength(200, { message: '商品简述最长 200 个字符' })
  itemsSummary?: string;

  @ApiPropertyOptional({ example: 3, description: '关联活动 ID（可选）' })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '活动 ID 必须是整数' })
  @Min(1)
  promotionId?: number;
}

// ─── 活动相关 ─────────────────────────────────────────────────────────

const PROMOTION_STATUS_VALUES = [
  'upcoming',
  'active',
  'ended',
] as const satisfies readonly MarketingPromotionStatus[];

export class ListPromotionsQueryDto extends MarketingPageQueryDto {
  @ApiPropertyOptional({
    example: 'active',
    enum: PROMOTION_STATUS_VALUES,
    description: '活动状态（upcoming=未开始 active=进行中 ended=已结束）',
  })
  @IsOptional()
  @IsIn(PROMOTION_STATUS_VALUES, { message: '无效的活动状态' })
  status?: MarketingPromotionStatus;
}

export class CreatePromotionDto {
  @ApiPropertyOptional({ example: '夏日满减活动', description: '活动名称' })
  @IsString({ message: '活动名称必须是字符串' })
  @MinLength(1, { message: '活动名称不能为空' })
  @MaxLength(100, { message: '活动名称最长 100 个字符' })
  name: string;

  @ApiPropertyOptional({
    example: 'reduce',
    enum: MARKETING_PROMOTION_TYPE_VALUES,
    description: '活动类型',
  })
  @IsIn(MARKETING_PROMOTION_TYPE_VALUES, { message: '无效的活动类型' })
  type: MarketingPromotionTypeValue;

  @ApiPropertyOptional({ example: '满 100 减 20 元', description: '活动描述' })
  @IsOptional()
  @IsString({ message: '活动描述必须是字符串' })
  @MaxLength(500, { message: '活动描述最长 500 个字符' })
  description?: string;

  @ApiPropertyOptional({
    example: { threshold: 10000, reduceAmount: 2000 },
    description: '优惠参数 JSON（按 type 不同格式各异）',
  })
  @IsOptional()
  params?: Record<string, unknown>;

  @ApiPropertyOptional({
    example: 1715000000000,
    description: '活动开始时间（毫秒时间戳）',
  })
  @IsInt({ message: '开始时间必须是整数时间戳' })
  @Min(0)
  startAt: number;

  @ApiPropertyOptional({
    example: 1715086399999,
    description: '活动结束时间（毫秒时间戳）',
  })
  @IsInt({ message: '结束时间必须是整数时间戳' })
  @Min(0)
  endAt: number;

  @ApiPropertyOptional({ example: true, description: '是否上架（默认 true）' })
  @IsOptional()
  @IsBoolean({ message: 'enabled 必须是布尔值' })
  enabled?: boolean;
}

export class UpdatePromotionDto {
  @ApiPropertyOptional({ example: '夏日满减活动', description: '活动名称' })
  @IsOptional()
  @IsString({ message: '活动名称必须是字符串' })
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ example: '满 100 减 20 元', description: '活动描述' })
  @IsOptional()
  @IsString({ message: '活动描述必须是字符串' })
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ example: { threshold: 10000, discount: 2000 } })
  @IsOptional()
  params?: Record<string, unknown>;

  @ApiPropertyOptional({
    example: 1715000000000,
    description: '开始时间（毫秒时间戳）',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  startAt?: number;

  @ApiPropertyOptional({
    example: 1715086399999,
    description: '结束时间（毫秒时间戳）',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  endAt?: number;

  @ApiPropertyOptional({ example: false, description: '是否上架' })
  @IsOptional()
  @IsBoolean({ message: 'enabled 必须是布尔值' })
  enabled?: boolean;
}

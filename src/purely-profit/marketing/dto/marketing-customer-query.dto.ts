import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  NotEquals,
} from 'class-validator';
import { transformOptionalKeyword } from '../../stores/dto/store-response.dto';
import {
  MARKETING_CUSTOMER_TIER_VALUES,
  type MarketingCustomerStatus,
  type MarketingCustomerTierValue,
} from '../marketing.utils';
import { MarketingPageQueryDto } from './marketing-pagination-query.dto';

const CUSTOMER_STATUS_VALUES = [
  'new',
  'active',
  'dormant',
  'lost',
] as const satisfies readonly MarketingCustomerStatus[];

/** 筛选允许值：含 'all' 哨兵表示不过滤 */
const STATUS_FILTER_VALUES = [...CUSTOMER_STATUS_VALUES, 'all'] as const;
const TIER_FILTER_VALUES = [...MARKETING_CUSTOMER_TIER_VALUES, 'all'] as const;

export class ListCustomersQueryDto extends MarketingPageQueryDto {
  @ApiPropertyOptional({
    example: 'active',
    enum: STATUS_FILTER_VALUES,
    description:
      '顾客状态筛选（new=加入门店7天内 active=加入超过7天且30天内消费 dormant=31-90天消费 lost=91天以上未消费或无消费 all=不过滤）',
  })
  @IsOptional()
  @IsIn(STATUS_FILTER_VALUES, { message: '无效的顾客状态' })
  status?: MarketingCustomerStatus | 'all';

  @ApiPropertyOptional({
    example: 'gold',
    enum: TIER_FILTER_VALUES,
    description: '会员等级筛选（all=不过滤）',
  })
  @IsOptional()
  @IsIn(TIER_FILTER_VALUES, { message: '无效的会员等级' })
  tier?: MarketingCustomerTierValue | 'all';

  @ApiPropertyOptional({
    example: '张三',
    description: '姓名 / 手机号关键字（兼容旧字段）',
  })
  @IsOptional()
  @Transform(transformOptionalKeyword)
  @IsString({ message: '关键字必须是字符串' })
  @MaxLength(50, { message: '关键字最长 50 个字符' })
  keyword?: string;

  @ApiPropertyOptional({
    example: '张三',
    description: '姓名精确关键字（独立搜索框）',
  })
  @IsOptional()
  @Transform(transformOptionalKeyword)
  @IsString({ message: '姓名关键字必须是字符串' })
  @MaxLength(50, { message: '姓名关键字最长 50 个字符' })
  name?: string;

  @ApiPropertyOptional({
    example: '138',
    description: '手机号关键字（独立搜索框）',
  })
  @IsOptional()
  @Transform(transformOptionalKeyword)
  @IsString({ message: '手机号关键字必须是字符串' })
  @MaxLength(20, { message: '手机号关键字最长 20 个字符' })
  phone?: string;
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

export class AdjustCustomerPointsDto {
  @ApiProperty({
    example: 100,
    description: '积分变动量（正数=增加，负数=扣除，不能为0）',
  })
  @IsInt({ message: '积分变动量必须是整数' })
  @NotEquals(0, { message: '积分变动量不能为0' })
  delta: number;

  @ApiPropertyOptional({
    example: '活动奖励积分',
    description: '调整原因（可选）',
  })
  @IsOptional()
  @IsString({ message: '原因必须是字符串' })
  @MaxLength(500, { message: '原因最长 500 个字符' })
  remark?: string;
}

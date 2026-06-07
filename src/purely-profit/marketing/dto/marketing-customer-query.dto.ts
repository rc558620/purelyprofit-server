import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { transformOptionalKeyword } from '../../stores/dto/store-response.dto';
import {
  MARKETING_CUSTOMER_TIER_VALUES,
  type MarketingCustomerStatus,
  type MarketingCustomerTierValue,
} from '../marketing.utils';
import { MarketingPageQueryDto } from './marketing-pagination-query.dto';

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

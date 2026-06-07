import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  NotEquals,
  ValidateIf,
} from 'class-validator';
import {
  PaginationMetaDto,
  transformOptionalInt,
} from '../../../stores/dto/store-response.dto';
import {
  ADJUSTMENT_DIRECTION_VALUES,
  type AdjustmentDirectionValue,
  MemberAssetIdentityDto,
  MemberAssetLogsQueryDto,
} from './member-asset-shared.dto';
import { MemberResponseDto } from './member-response.dto';

export const MEMBER_BEAN_RECORD_TYPES = ['earn', 'spend', 'withdraw'] as const;
export const MEMBER_BEAN_RECORD_SOURCES = [
  'promo_reward',
  'deduct_payment',
  'withdrawal',
  'admin_adjust',
] as const;

export type MemberBeanRecordTypeValue = (typeof MEMBER_BEAN_RECORD_TYPES)[number];
export type MemberBeanRecordSourceValue =
  (typeof MEMBER_BEAN_RECORD_SOURCES)[number];

export class ListMemberBeansLogsQueryDto extends MemberAssetLogsQueryDto {
  @ApiPropertyOptional({
    enum: MEMBER_BEAN_RECORD_TYPES,
    description: '按纯利豆记录类型筛选',
  })
  @IsOptional()
  @IsIn(MEMBER_BEAN_RECORD_TYPES, { message: '纯利豆记录类型不合法' })
  type?: MemberBeanRecordTypeValue;

  @ApiPropertyOptional({
    enum: MEMBER_BEAN_RECORD_SOURCES,
    description: '按纯利豆来源筛选',
  })
  @IsOptional()
  @IsIn(MEMBER_BEAN_RECORD_SOURCES, { message: '纯利豆来源不合法' })
  source?: MemberBeanRecordSourceValue;
}

export class AdjustMemberBeansDto extends MemberAssetIdentityDto {
  @ApiPropertyOptional({
    example: 100,
    description: '调整纯利豆，正数为增加，负数为减少',
  })
  @ValidateIf((dto: AdjustMemberBeansDto) => dto.amount === undefined)
  @Transform(transformOptionalInt)
  @IsInt({ message: '调整纯利豆必须是整数' })
  @NotEquals(0, { message: '调整纯利豆不能为 0' })
  delta?: number;

  @ApiPropertyOptional({
    example: 100,
    description: '兼容旧请求的调整值字段，需配合 direction 使用',
  })
  @ValidateIf((dto: AdjustMemberBeansDto) => dto.delta === undefined)
  @Transform(transformOptionalInt)
  @IsInt({ message: '调整纯利豆必须是整数' })
  @NotEquals(0, { message: '调整纯利豆不能为 0' })
  amount?: number;

  @ApiPropertyOptional({
    enum: ADJUSTMENT_DIRECTION_VALUES,
    description: '兼容旧请求的调整方向字段',
  })
  @IsOptional()
  @IsIn(ADJUSTMENT_DIRECTION_VALUES, { message: '调整方向不合法' })
  direction?: AdjustmentDirectionValue;

  @ApiProperty({ example: '管理员手动补发纯利豆', description: '调整原因' })
  @IsString({ message: '调整原因必须是字符串' })
  @MaxLength(100, { message: '调整原因最多 100 位' })
  reason: string;
}

export class MemberBeansLogResponseDto {
  @ApiProperty({ example: 'bean-1001', description: '纯利豆记录 ID' })
  @IsString({ message: '纯利豆记录 ID 必须是字符串' })
  id: string;

  @ApiProperty({ example: '1', description: '会员 ID' })
  @IsString({ message: '会员 ID 必须是字符串' })
  userId: string;

  @ApiProperty({ example: '陈建国', description: '会员姓名' })
  @IsString({ message: '会员姓名必须是字符串' })
  userName: string;

  @ApiProperty({ example: '13900139000', description: '会员手机号' })
  @IsString({ message: '会员手机号必须是字符串' })
  userPhone: string;

  @ApiProperty({ example: 100, description: '纯利豆变动值' })
  @IsInt({ message: '纯利豆变动值必须是整数' })
  amount: number;

  @ApiProperty({
    enum: MEMBER_BEAN_RECORD_TYPES,
    description: '纯利豆记录类型',
  })
  @IsIn(MEMBER_BEAN_RECORD_TYPES, { message: '纯利豆记录类型不合法' })
  type: MemberBeanRecordTypeValue;

  @ApiProperty({
    enum: MEMBER_BEAN_RECORD_SOURCES,
    description: '纯利豆来源',
  })
  @IsIn(MEMBER_BEAN_RECORD_SOURCES, { message: '纯利豆来源不合法' })
  source: MemberBeanRecordSourceValue;

  @ApiProperty({ example: '推广奖励（张宇 / 年度会员）', description: '说明' })
  @IsString({ message: '说明必须是字符串' })
  description: string;

  @ApiPropertyOptional({
    example: 'promo-1001',
    description: '关联推广记录 ID',
  })
  @IsOptional()
  @IsString({ message: '关联推广记录 ID 必须是字符串' })
  relatedPromoId?: string;

  @ApiPropertyOptional({ example: '张宇', description: '关联被推广用户' })
  @IsOptional()
  @IsString({ message: '关联被推广用户必须是字符串' })
  relatedUser?: string;

  @ApiProperty({ example: 1747123200000, description: '创建时间戳（ms）' })
  @IsInt({ message: '创建时间必须是整数' })
  createdAt: number;
}

export class PaginatedMemberBeansLogsResponseDto {
  @ApiProperty({
    type: [MemberBeansLogResponseDto],
    description: '当前页纯利豆记录',
  })
  items: MemberBeansLogResponseDto[];

  @ApiProperty({ type: PaginationMetaDto, description: '分页元信息' })
  meta: PaginationMetaDto;
}

export class AdjustMemberBeansResponseDto {
  @ApiProperty({
    type: MemberResponseDto,
    description: '调整后的会员信息',
  })
  user: MemberResponseDto;

  @ApiProperty({
    type: MemberBeansLogResponseDto,
    description: '本次纯利豆调整记录',
  })
  record: MemberBeansLogResponseDto;
}

export class MemberBeansOverviewResponseDto {
  @ApiProperty({ example: 96, description: '纯利豆记录总数' })
  @IsInt({ message: '纯利豆记录总数必须是整数' })
  totalCount: number;

  @ApiProperty({ example: 21, description: '管理员调整记录数' })
  @IsInt({ message: '管理员调整记录数必须是整数' })
  adminAdjustCount: number;

  @ApiProperty({ example: 44, description: '推广奖励记录数' })
  @IsInt({ message: '推广奖励记录数必须是整数' })
  promoRewardCount: number;

  @ApiProperty({ example: 9, description: '提现扣除记录数' })
  @IsInt({ message: '提现扣除记录数必须是整数' })
  withdrawCount: number;
}

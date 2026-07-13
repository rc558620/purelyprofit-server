import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
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

export const MEMBER_POINTS_RECORD_TYPES = ['earn', 'spend', 'expire'] as const;
export const MEMBER_POINTS_RECORD_SOURCES = [
  'purchase_bonus',
  'deduct_payment',
  'admin_adjust',
  'expire',
] as const;

export type MemberPointsRecordTypeValue =
  (typeof MEMBER_POINTS_RECORD_TYPES)[number];
export type MemberPointsRecordSourceValue =
  (typeof MEMBER_POINTS_RECORD_SOURCES)[number];

export class ListMemberPointsLogsQueryDto extends MemberAssetLogsQueryDto {
  @ApiPropertyOptional({
    enum: MEMBER_POINTS_RECORD_TYPES,
    description: '按积分记录类型筛选',
  })
  @IsOptional()
  @IsIn(MEMBER_POINTS_RECORD_TYPES, { message: '积分记录类型不合法' })
  type?: MemberPointsRecordTypeValue;

  @ApiPropertyOptional({
    enum: MEMBER_POINTS_RECORD_SOURCES,
    description: '按积分来源筛选',
  })
  @IsOptional()
  @IsIn(MEMBER_POINTS_RECORD_SOURCES, { message: '积分来源不合法' })
  source?: MemberPointsRecordSourceValue;
}

export class AdjustMemberPointsDto extends MemberAssetIdentityDto {
  @ApiPropertyOptional({
    example: 200,
    description: '调整积分，正数为增加，负数为减少',
  })
  // 仅当本字段存在时才校验；与 amount 互斥由 resolveAdjustmentDelta 处理。
  // 不再以“另一个字段是否缺失”作为跳过校验的条件，避免两者同时传入时
  // 校验被整体绕过的缺陷（delta=0 或非法值直接写入）。与纯利豆 DTO 保持一致。
  @ValidateIf((dto: AdjustMemberPointsDto) => dto.delta !== undefined)
  @Transform(transformOptionalInt)
  @IsInt({ message: '调整积分必须是整数' })
  @NotEquals(0, { message: '调整积分不能为 0' })
  delta?: number;

  @ApiPropertyOptional({
    example: 200,
    description: '兼容旧请求的调整值字段，需配合 direction 使用',
  })
  @ValidateIf((dto: AdjustMemberPointsDto) => dto.amount !== undefined)
  @Transform(transformOptionalInt)
  @IsInt({ message: '调整积分必须是整数' })
  @NotEquals(0, { message: '调整积分不能为 0' })
  amount?: number;

  @ApiPropertyOptional({
    example: 'adj-7f3c-20260712',
    description:
      '客户端幂等键，相同键 60s 内去重；用于避免重复点击误伤合法重复调整',
  })
  @IsOptional()
  @IsString({ message: '幂等键必须是字符串' })
  @MaxLength(64, { message: '幂等键最多 64 位' })
  idempotencyKey?: string;

  @ApiPropertyOptional({
    enum: ADJUSTMENT_DIRECTION_VALUES,
    description: '兼容旧请求的调整方向字段',
  })
  @IsOptional()
  @IsIn(ADJUSTMENT_DIRECTION_VALUES, { message: '调整方向不合法' })
  direction?: AdjustmentDirectionValue;

  @ApiPropertyOptional({
    example: 1749724800000,
    description: '积分过期时间（毫秒时间戳），仅手动调整积分时可选',
  })
  @IsOptional()
  @IsInt({ message: '积分过期时间必须是整数' })
  expireAt?: number;

  @ApiProperty({ example: '管理员手动补发积分', description: '调整原因' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: '调整原因必须是字符串' })
  @IsNotEmpty({ message: '调整原因不能为空' })
  @MaxLength(100, { message: '调整原因最多 100 位' })
  reason: string;
}

export class MemberPointsLogResponseDto {
  @ApiProperty({ example: 'pts-1001', description: '积分记录 ID' })
  @IsString({ message: '积分记录 ID 必须是字符串' })
  id: string;

  @ApiProperty({ example: '1', description: '会员 ID' })
  @IsString({ message: '会员 ID 必须是字符串' })
  userId: string;

  @ApiProperty({ example: '刘梅', description: '会员姓名' })
  @IsString({ message: '会员姓名必须是字符串' })
  userName: string;

  @ApiProperty({ example: '13800138000', description: '会员手机号' })
  @IsString({ message: '会员手机号必须是字符串' })
  userPhone: string;

  @ApiProperty({ example: 300, description: '积分变动值' })
  @IsInt({ message: '积分变动值必须是整数' })
  amount: number;

  @ApiProperty({
    enum: MEMBER_POINTS_RECORD_TYPES,
    description: '积分记录类型',
  })
  @IsIn(MEMBER_POINTS_RECORD_TYPES, { message: '积分记录类型不合法' })
  type: MemberPointsRecordTypeValue;

  @ApiProperty({
    enum: MEMBER_POINTS_RECORD_SOURCES,
    description: '积分来源',
  })
  @IsIn(MEMBER_POINTS_RECORD_SOURCES, { message: '积分来源不合法' })
  source: MemberPointsRecordSourceValue;

  @ApiProperty({ example: '管理员手动补发积分', description: '说明' })
  @IsString({ message: '说明必须是字符串' })
  description: string;

  @ApiProperty({ example: 1747123200000, description: '创建时间戳（ms）' })
  @IsInt({ message: '创建时间必须是整数' })
  createdAt: number;

  @ApiPropertyOptional({
    example: 1749724800000,
    description: '过期时间戳（ms）',
  })
  @IsOptional()
  @IsInt({ message: '过期时间必须是整数' })
  expireAt?: number;
}

export class PaginatedMemberPointsLogsResponseDto {
  @ApiProperty({
    type: [MemberPointsLogResponseDto],
    description: '当前页积分记录',
  })
  items: MemberPointsLogResponseDto[];

  @ApiProperty({ type: PaginationMetaDto, description: '分页元信息' })
  meta: PaginationMetaDto;
}

export class AdjustMemberPointsResponseDto {
  @ApiProperty({
    type: MemberResponseDto,
    description: '调整后的会员信息',
  })
  user: MemberResponseDto;

  @ApiProperty({
    type: MemberPointsLogResponseDto,
    description: '本次积分调整记录',
  })
  record: MemberPointsLogResponseDto;
}

export class MemberPointsOverviewResponseDto {
  @ApiProperty({ example: 128, description: '积分记录总数' })
  @IsInt({ message: '积分记录总数必须是整数' })
  totalCount: number;

  @ApiProperty({ example: 32, description: '管理员调整记录数' })
  @IsInt({ message: '管理员调整记录数必须是整数' })
  adminAdjustCount: number;

  @ApiProperty({ example: 8, description: '今日积分变动记录数' })
  @IsInt({ message: '今日积分变动记录数必须是整数' })
  todayChangeCount: number;
}

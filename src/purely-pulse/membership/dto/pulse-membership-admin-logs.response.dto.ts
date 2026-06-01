import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import {
  PULSE_ADMIN_MEMBER_BEAN_SOURCE_VALUES,
  PULSE_ADMIN_MEMBER_BEAN_TYPE_VALUES,
  PULSE_ADMIN_MEMBER_POINTS_SOURCE_VALUES,
  PULSE_ADMIN_MEMBER_POINTS_TYPE_VALUES,
} from './pulse-membership-admin-logs.shared.dto';
import type {
  PulseAdminMemberBeanSourceValue,
  PulseAdminMemberBeanTypeValue,
  PulseAdminMemberPointsSourceValue,
  PulseAdminMemberPointsTypeValue,
} from './pulse-membership-admin-logs.shared.dto';

export class PulseAdminMemberPointsLogDto {
  @ApiProperty({ example: 'pts-12', description: '积分流水 ID' })
  @IsString()
  id: string;

  @ApiProperty({ example: '1', description: '会员 ID / 门店 ID' })
  @IsString()
  userId: string;

  @ApiProperty({ example: '刘梅', description: '会员展示名' })
  @IsString()
  userName: string;

  @ApiProperty({ example: '138****9021', description: '会员手机号' })
  @IsString()
  userPhone: string;

  @ApiProperty({ example: 300, description: '积分变动值' })
  @IsInt()
  amount: number;

  @ApiProperty({
    enum: PULSE_ADMIN_MEMBER_POINTS_TYPE_VALUES,
    description: '积分流水方向',
  })
  @IsIn(PULSE_ADMIN_MEMBER_POINTS_TYPE_VALUES)
  type: PulseAdminMemberPointsTypeValue;

  @ApiProperty({
    enum: PULSE_ADMIN_MEMBER_POINTS_SOURCE_VALUES,
    description: '积分流水来源',
  })
  @IsIn(PULSE_ADMIN_MEMBER_POINTS_SOURCE_VALUES)
  source: PulseAdminMemberPointsSourceValue;

  @ApiProperty({ example: '管理员调整积分', description: '积分流水说明' })
  @IsString()
  description: string;

  @ApiProperty({ example: 1747123200000, description: '创建时间戳（ms）' })
  @IsInt()
  createdAt: number;

  @ApiPropertyOptional({
    example: 1749724800000,
    description: '过期时间戳（ms）',
  })
  @IsOptional()
  @IsInt()
  expireAt?: number | null;
}

export class PulseAdminMemberPointsLogsResponseDto {
  @ApiProperty({
    type: [PulseAdminMemberPointsLogDto],
    description: '管理员视角会员积分流水列表',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PulseAdminMemberPointsLogDto)
  items: PulseAdminMemberPointsLogDto[];

  @ApiProperty({ example: false, description: '是否还有下一页' })
  hasMore: boolean;

  @ApiPropertyOptional({
    example: '1747123200000_128',
    description: '下一页 cursor；没有更多数据时为 null',
  })
  @IsOptional()
  nextCursor: string | null;
}

export class PulseAdminMemberBeanLogDto {
  @ApiProperty({ example: 'bean-12', description: '纯利豆流水 ID' })
  @IsString()
  id: string;

  @ApiProperty({ example: '1', description: '会员 ID / 门店 ID' })
  @IsString()
  userId: string;

  @ApiProperty({ example: '刘梅', description: '会员展示名' })
  @IsString()
  userName: string;

  @ApiProperty({ example: '138****9021', description: '会员手机号' })
  @IsString()
  userPhone: string;

  @ApiProperty({ example: 22, description: '纯利豆变动值' })
  @IsInt()
  amount: number;

  @ApiProperty({
    enum: PULSE_ADMIN_MEMBER_BEAN_TYPE_VALUES,
    description: '纯利豆流水方向',
  })
  @IsIn(PULSE_ADMIN_MEMBER_BEAN_TYPE_VALUES)
  type: PulseAdminMemberBeanTypeValue;

  @ApiProperty({
    enum: PULSE_ADMIN_MEMBER_BEAN_SOURCE_VALUES,
    description: '纯利豆流水来源',
  })
  @IsIn(PULSE_ADMIN_MEMBER_BEAN_SOURCE_VALUES)
  source: PulseAdminMemberBeanSourceValue;

  @ApiProperty({
    example: '推广奖励 · 张三订阅季度会员',
    description: '纯利豆流水说明',
  })
  @IsString()
  description: string;

  @ApiPropertyOptional({ example: 'promo-21', description: '关联推广记录 ID' })
  @IsOptional()
  @IsString()
  relatedPromoId?: string;

  @ApiPropertyOptional({ example: '张三', description: '关联被推广用户' })
  @IsOptional()
  @IsString()
  relatedUser?: string;

  @ApiProperty({ example: 1747123200000, description: '创建时间戳（ms）' })
  @IsInt()
  createdAt: number;
}

export class PulseAdminMemberBeanLogsResponseDto {
  @ApiProperty({
    type: [PulseAdminMemberBeanLogDto],
    description: '管理员视角会员纯利豆流水列表',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PulseAdminMemberBeanLogDto)
  items: PulseAdminMemberBeanLogDto[];

  @ApiProperty({ example: false, description: '是否还有下一页' })
  hasMore: boolean;

  @ApiPropertyOptional({
    example: '1747123200000_128',
    description: '下一页 cursor；没有更多数据时为 null',
  })
  @IsOptional()
  nextCursor: string | null;
}

import { MemberGender } from '@prisma/client';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  MEMBER_LEVEL_VALUES,
  MEMBER_STATUS_VALUES,
  MemberRechargeRecordDto,
  type MemberLevelValue,
  type MemberStatusValue,
} from './member-response.dto';

export class UpdateMemberDto {
  @ApiPropertyOptional({ example: '王小美', description: '会员姓名' })
  @IsOptional()
  @IsString({ message: '会员姓名必须是字符串' })
  @MinLength(2, { message: '会员姓名至少 2 位' })
  @MaxLength(30, { message: '会员姓名最多 30 位' })
  name?: string;

  @ApiPropertyOptional({ example: '13800138000', description: '会员手机号' })
  @IsOptional()
  @IsString({ message: '会员手机号必须是字符串' })
  @Matches(/^1\d{10}$/, { message: '会员手机号格式不正确' })
  phone?: string;

  @ApiPropertyOptional({ enum: MemberGender, description: '会员性别' })
  @IsOptional()
  @IsEnum(MemberGender, { message: '会员性别不合法' })
  gender?: MemberGender;

  @ApiPropertyOptional({
    example: 'annual',
    enum: MEMBER_LEVEL_VALUES,
    description: '会员等级',
  })
  @IsOptional()
  @IsIn(MEMBER_LEVEL_VALUES, { message: '会员等级不合法' })
  level?: MemberLevelValue;

  @ApiPropertyOptional({
    example: 'active',
    enum: MEMBER_STATUS_VALUES,
    description: '会员状态',
  })
  @IsOptional()
  @IsIn(MEMBER_STATUS_VALUES, { message: '会员状态不合法' })
  status?: MemberStatusValue;

  @ApiPropertyOptional({
    example: '老会员，优先服务',
    description: '会员备注',
  })
  @IsOptional()
  @IsString({ message: '会员备注必须是字符串' })
  @MaxLength(200, { message: '会员备注最多 200 位' })
  remark?: string;

  @ApiPropertyOptional({
    example: '1998-08-08T00:00:00.000Z',
    description: '会员生日',
  })
  @IsOptional()
  @IsDateString({}, { message: '会员生日格式不正确' })
  birthday?: string;

  @ApiPropertyOptional({
    example: '2026-05-13T10:00:00.000Z',
    description: '最近活跃时间',
  })
  @IsOptional()
  @IsDateString({}, { message: '最近活跃时间格式不正确' })
  lastActiveAt?: string;

  @ApiPropertyOptional({ example: 0, description: '当前可用积分' })
  @IsOptional()
  @IsInt({ message: '当前可用积分必须是整数' })
  @Min(0, { message: '当前可用积分不能小于 0' })
  availablePoints?: number;

  @ApiPropertyOptional({ example: 0, description: '累计获得积分' })
  @IsOptional()
  @IsInt({ message: '累计获得积分必须是整数' })
  @Min(0, { message: '累计获得积分不能小于 0' })
  totalPointsEarned?: number;

  @ApiPropertyOptional({ example: 0, description: '纯利豆余额' })
  @IsOptional()
  @IsInt({ message: '纯利豆余额必须是整数' })
  @Min(0, { message: '纯利豆余额不能小于 0' })
  beanBalance?: number;

  @ApiPropertyOptional({ example: false, description: '是否为合伙人' })
  @IsOptional()
  @IsBoolean({ message: '是否为合伙人必须是布尔值' })
  isPartner?: boolean;

  @ApiPropertyOptional({ example: 'P2', description: '合伙人等级' })
  @IsOptional()
  @IsString({ message: '合伙人等级必须是字符串' })
  @MaxLength(20, { message: '合伙人等级最多 20 位' })
  partnerLevel?: string;

  @ApiPropertyOptional({ example: 0, description: '累计充值金额，单位分' })
  @IsOptional()
  @IsInt({ message: '累计充值金额必须是整数' })
  @Min(0, { message: '累计充值金额不能小于 0' })
  totalRecharged?: number;

  @ApiPropertyOptional({ example: 0, description: '充值次数' })
  @IsOptional()
  @IsInt({ message: '充值次数必须是整数' })
  @Min(0, { message: '充值次数不能小于 0' })
  rechargeCount?: number;

  @ApiPropertyOptional({ example: 0, description: '推广新用户数' })
  @IsOptional()
  @IsInt({ message: '推广新用户数必须是整数' })
  @Min(0, { message: '推广新用户数不能小于 0' })
  invitedCount?: number;

  @ApiPropertyOptional({
    type: [MemberRechargeRecordDto],
    description: '会员充值记录',
  })
  @IsOptional()
  @IsArray({ message: '会员充值记录必须是数组' })
  @ValidateNested({ each: true })
  @Type(() => MemberRechargeRecordDto)
  rechargeHistory?: MemberRechargeRecordDto[];

  @ApiPropertyOptional({ example: '违规操作', description: '封禁原因' })
  @IsOptional()
  @IsString({ message: '封禁原因必须是字符串' })
  @MaxLength(200, { message: '封禁原因最多 200 位' })
  bannedReason?: string;
}

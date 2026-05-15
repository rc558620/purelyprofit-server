import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import {
  PaginationMetaDto,
  PaginationQueryDto,
  transformOptionalInt,
  transformOptionalKeyword,
} from '../../stores/dto/store-response.dto';
import {
  MEMBER_LEVEL_VALUES,
  MEMBER_RECHARGE_CHANNEL_VALUES,
  MEMBER_STATUS_VALUES,
  type MemberLevelValue,
  type MemberRechargeChannelValue,
  type MemberStatusValue,
} from '../members.utils';

export {
  MEMBER_LEVEL_VALUES,
  MEMBER_RECHARGE_CHANNEL_VALUES,
  MEMBER_STATUS_VALUES,
} from '../members.utils';
export type {
  MemberLevelValue,
  MemberRechargeChannelValue,
  MemberStatusValue,
} from '../members.utils';

function transformOptionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalizedValue = value.trim().toLowerCase();
    if (normalizedValue === 'true') {
      return true;
    }

    if (normalizedValue === 'false') {
      return false;
    }
  }

  return undefined;
}

export class ListMembersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: 1, description: '按门店 ID 筛选会员' })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '门店 ID 必须是整数' })
  @Min(1, { message: '门店 ID 必须大于等于 1' })
  storeId?: number;

  @ApiPropertyOptional({
    enum: MEMBER_STATUS_VALUES,
    description: '按会员状态筛选',
  })
  @IsOptional()
  @IsIn(MEMBER_STATUS_VALUES, { message: '会员状态不合法' })
  status?: MemberStatusValue;

  @ApiPropertyOptional({
    enum: MEMBER_LEVEL_VALUES,
    description: '按会员等级筛选',
  })
  @IsOptional()
  @Transform(transformOptionalKeyword)
  @IsIn(MEMBER_LEVEL_VALUES, { message: '会员等级不合法' })
  level?: MemberLevelValue;

  @ApiPropertyOptional({
    example: '王小',
    description: '按会员姓名或手机号模糊搜索',
  })
  @IsOptional()
  @Transform(transformOptionalKeyword)
  @IsString({ message: '搜索关键词必须是字符串' })
  keyword?: string;
}

export class ListMemberSnapshotsQueryDto {
  @ApiPropertyOptional({
    example: 1,
    description: '按门店 ID 获取会员快照列表',
  })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '门店 ID 必须是整数' })
  @Min(1, { message: '门店 ID 必须大于等于 1' })
  storeId?: number;

  @ApiPropertyOptional({
    example: '刘梅',
    description: '按会员姓名或手机号搜索会员快照',
  })
  @IsOptional()
  @Transform(transformOptionalKeyword)
  @IsString({ message: '搜索关键词必须是字符串' })
  keyword?: string;

  @ApiPropertyOptional({
    example: true,
    description: '是否仅返回合伙人会员',
  })
  @IsOptional()
  @Transform(({ value }) => transformOptionalBoolean(value))
  @IsBoolean({ message: '仅返回合伙人标记必须是布尔值' })
  onlyPartners?: boolean;
}

export class MemberSnapshotDto {
  @ApiProperty({ example: '1', description: '会员 ID' })
  @IsString({ message: '会员 ID 必须是字符串' })
  id: string;

  @ApiProperty({ example: '王小美', description: '会员姓名' })
  @IsString({ message: '会员姓名必须是字符串' })
  name: string;

  @ApiProperty({ example: '13800138000', description: '会员手机号' })
  @IsString({ message: '会员手机号必须是字符串' })
  phone: string;

  @ApiProperty({ example: 1280, description: '当前可用积分' })
  @IsInt({ message: '当前可用积分必须是整数' })
  availablePoints: number;

  @ApiProperty({ example: 3200, description: '纯利豆余额' })
  @IsInt({ message: '纯利豆余额必须是整数' })
  beanBalance: number;

  @ApiProperty({ example: true, description: '是否为合伙人' })
  @IsBoolean({ message: '是否为合伙人必须是布尔值' })
  isPartner: boolean;
}

export class MemberRechargeRecordDto {
  @ApiProperty({ example: 'rc-1001', description: '充值记录 ID' })
  @IsString({ message: '充值记录 ID 必须是字符串' })
  id: string;

  @ApiProperty({ example: '季度会员', description: '套餐名称' })
  @IsString({ message: '套餐名称必须是字符串' })
  planName: string;

  @ApiProperty({ example: 9900, description: '充值金额，单位分' })
  @IsInt({ message: '充值金额必须是整数' })
  amount: number;

  @ApiProperty({ example: 0, description: '本次奖励积分' })
  @IsInt({ message: '奖励积分必须是整数' })
  pointsAwarded: number;

  @ApiProperty({
    example: 'wechat',
    enum: MEMBER_RECHARGE_CHANNEL_VALUES,
    description: '支付渠道',
  })
  @IsIn(MEMBER_RECHARGE_CHANNEL_VALUES, { message: '支付渠道不合法' })
  channel: MemberRechargeChannelValue;

  @ApiProperty({ example: 1747123200000, description: '创建时间戳（ms）' })
  @IsInt({ message: '创建时间戳必须是整数' })
  createdAt: number;
}

export class MemberResponseDto {
  @ApiProperty({ example: '1', description: '会员 ID' })
  @IsString({ message: '会员 ID 必须是字符串' })
  id: string;

  @ApiProperty({ example: '王小美', description: '会员姓名' })
  @IsString({ message: '会员姓名必须是字符串' })
  name: string;

  @ApiProperty({ example: '13800138000', description: '会员手机号' })
  @IsString({ message: '会员手机号必须是字符串' })
  phone: string;

  @ApiProperty({ example: '王', description: '头像文字' })
  @IsString({ message: '头像文字必须是字符串' })
  avatarChar: string;

  @ApiProperty({ example: 2, description: '头像颜色索引' })
  @IsInt({ message: '头像颜色索引必须是整数' })
  avatarColorIdx: number;

  @ApiProperty({
    enum: MEMBER_STATUS_VALUES,
    description: '会员状态',
  })
  @IsIn(MEMBER_STATUS_VALUES, { message: '会员状态不合法' })
  status: MemberStatusValue;

  @ApiProperty({
    example: 'annual',
    enum: MEMBER_LEVEL_VALUES,
    description: '会员等级',
  })
  @IsIn(MEMBER_LEVEL_VALUES, { message: '会员等级不合法' })
  level: MemberLevelValue;

  @ApiProperty({ example: 1747123200000, description: '注册时间戳（ms）' })
  @IsInt({ message: '注册时间戳必须是整数' })
  registeredAt: number;

  @ApiProperty({ example: 1747209600000, description: '最近活跃时间戳（ms）' })
  @IsInt({ message: '最近活跃时间戳必须是整数' })
  lastActiveAt: number;

  @ApiProperty({ example: 1280, description: '当前可用积分' })
  @IsInt({ message: '当前可用积分必须是整数' })
  availablePoints: number;

  @ApiProperty({ example: 2800, description: '累计获得积分' })
  @IsInt({ message: '累计获得积分必须是整数' })
  totalPointsEarned: number;

  @ApiProperty({ example: 3200, description: '纯利豆余额' })
  @IsInt({ message: '纯利豆余额必须是整数' })
  beanBalance: number;

  @ApiProperty({ example: true, description: '是否为合伙人' })
  @IsBoolean({ message: '是否为合伙人必须是布尔值' })
  isPartner: boolean;

  @ApiPropertyOptional({ example: 'P2', description: '合伙人等级' })
  @IsOptional()
  @IsString({ message: '合伙人等级必须是字符串' })
  partnerLevel?: string;

  @ApiProperty({ example: 59800, description: '累计充值金额，单位分' })
  @IsInt({ message: '累计充值金额必须是整数' })
  totalRecharged: number;

  @ApiProperty({ example: 3, description: '充值次数' })
  @IsInt({ message: '充值次数必须是整数' })
  rechargeCount: number;

  @ApiProperty({ example: 12, description: '推广带来的新用户数' })
  @IsInt({ message: '推广带来的新用户数必须是整数' })
  invitedCount: number;

  @ApiProperty({
    type: [MemberRechargeRecordDto],
    description: '充值记录',
  })
  @IsArray({ message: '充值记录必须是数组' })
  rechargeHistory: MemberRechargeRecordDto[];

  @ApiPropertyOptional({ example: '老会员，优先服务', description: '备注' })
  @IsOptional()
  @IsString({ message: '备注必须是字符串' })
  remark?: string;

  @ApiPropertyOptional({ example: '违规操作', description: '封禁原因' })
  @IsOptional()
  @IsString({ message: '封禁原因必须是字符串' })
  bannedReason?: string;
}

export class PaginatedMembersResponseDto {
  @ApiProperty({ type: [MemberResponseDto], description: '当前页会员列表' })
  items: MemberResponseDto[];

  @ApiProperty({ type: PaginationMetaDto, description: '分页元信息' })
  meta: PaginationMetaDto;
}

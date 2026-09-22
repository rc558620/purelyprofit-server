import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString } from 'class-validator';
import {
  PULSE_MEMBER_LEVEL_VALUES,
  PULSE_MEMBER_STATUS_VALUES,
} from './pulse-membership-admin-members.shared.dto';
import type {
  PulseMemberLevelValue,
  PulseMemberStatusValue,
} from './pulse-membership-admin-members.shared.dto';

/**
 * 管理端会员公共字段基类
 * 列表项与详情共用，对齐前端 MemberListItem / MemberDetail 的同名字段（memberList.types.ts）
 */
export class PulseMemberBaseDto {
  @ApiProperty({ example: 'm001', description: '会员 ID' })
  @IsString()
  id: string;

  @ApiProperty({ example: '刘梅', description: '会员姓名' })
  @IsString()
  name: string;

  @ApiProperty({ example: '13800138000', description: '会员手机号' })
  @IsString()
  phone: string;

  @ApiProperty({
    example: '刘',
    description: '头像文字（姓名首字，对齐前端 avatarChar）',
  })
  @IsString()
  avatarChar: string;

  @ApiProperty({
    example: 0,
    description: '头像颜色索引 0-5（对齐前端 avatarColorIdx）',
  })
  @IsInt()
  avatarColorIdx: number;

  @ApiPropertyOptional({
    example: 'https://cdn.example.com/avatar/user.png',
    description: '用户头像 URL，未设置时为空串（对齐前端 avatarUrl）',
  })
  @IsOptional()
  @IsString()
  avatarUrl?: string;

  @ApiProperty({
    enum: PULSE_MEMBER_STATUS_VALUES,
    example: 'active',
    description: '会员状态：active=正常 / inactive=未活跃 / banned=已封禁',
  })
  @IsIn(PULSE_MEMBER_STATUS_VALUES)
  status: PulseMemberStatusValue;

  @ApiProperty({
    enum: PULSE_MEMBER_LEVEL_VALUES,
    example: 'annual',
    description:
      '会员等级：free=免费 / monthly=月卡 / quarterly=季卡 / annual=年卡 / lifetime=永久',
  })
  @IsIn(PULSE_MEMBER_LEVEL_VALUES)
  level: PulseMemberLevelValue;

  @ApiProperty({ example: 1747123200000, description: '注册时间戳（ms）' })
  @IsInt()
  registeredAt: number;

  @ApiProperty({ example: 1747209600000, description: '最近活跃时间戳（ms）' })
  @IsInt()
  lastActiveAt: number;

  @ApiProperty({ example: 1280, description: '当前积分余额' })
  @IsInt()
  availablePoints: number;

  @ApiProperty({ example: 0, description: '纯利豆余额' })
  @IsInt()
  beanBalance: number;

  @ApiProperty({ example: false, description: '是否是合伙人' })
  @IsBoolean()
  isPartner: boolean;

  @ApiProperty({ example: 59800, description: '累计充值金额（分）' })
  @IsInt()
  totalRecharged: number;

  @ApiProperty({
    example: '598',
    description: '累计充值金额展示值（元，字符串），后端直接计算，前端仅展示',
  })
  @IsString()
  totalRechargedDisplay: string;

  @ApiProperty({ example: true, description: '是否具备配置子账号资格' })
  @IsBoolean()
  subAccountEligible: boolean;

  @ApiProperty({ example: 2, description: '当前子账号额度' })
  @IsInt()
  subAccountQuota: number;

  @ApiProperty({ example: true, description: '是否已启用子账号能力' })
  @IsBoolean()
  subAccountCapabilityEnabled: boolean;

  @ApiPropertyOptional({
    example: 1747209600000,
    description:
      '会员到期时间戳（ms），永久会员为 null（对齐前端 membershipExpiry）',
  })
  @IsOptional()
  @IsInt()
  membershipExpiry?: number | null;

  @ApiProperty({
    example: true,
    description:
      '是否在线（该账号最近 10 分钟内有经过鉴权的请求；口径见 MEMBER_ONLINE_WINDOW_MS）',
  })
  @IsBoolean()
  isOnline: boolean;
}

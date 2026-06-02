import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import {
  PLATFORM_PARTNER_INTENTIONS,
  PLATFORM_PARTNER_PAYMENT_METHODS,
} from './platform-membership-query.dto';
import {
  PLATFORM_PARTNER_LEVEL_VALUES,
  PLATFORM_PARTNER_STATUS,
  PlatformMembershipApprovedPartnerDto,
} from './platform-membership-shared.response.dto';

export class PlatformMembershipPartnerFollowUpNoteDto {
  @ApiProperty({ example: 'note_1', description: '备注 ID' })
  @IsString({ message: '备注 ID 必须是字符串' })
  id: string;

  @ApiProperty({ example: '已电话沟通，待补材料', description: '备注内容' })
  @IsString({ message: '备注内容必须是字符串' })
  content: string;

  @ApiProperty({ example: 1747123200000, description: '备注创建时间戳（ms）' })
  @IsInt({ message: '备注创建时间必须是整数' })
  createdAt: number;
}

export class PlatformMembershipPartnerApplicationDto {
  @ApiProperty({ example: '11', description: '申请记录 ID' })
  @IsString({ message: '申请记录 ID 必须是字符串' })
  id: string;

  @ApiProperty({ example: '王建国', description: '申请人姓名' })
  @IsString({ message: '申请人姓名必须是字符串' })
  name: string;

  @ApiProperty({ example: '13800138000', description: '申请人手机号' })
  @IsString({ message: '申请人手机号必须是字符串' })
  phone: string;

  @ApiProperty({ example: '44030119900101123X', description: '身份证号' })
  @IsString({ message: '身份证号必须是字符串' })
  idCard: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['广东省', '深圳市', '南山区'],
    description: '所在地区级联值',
  })
  @IsOptional()
  @IsArray({ message: '所在地区必须是数组' })
  @IsString({ each: true, message: '所在地区值必须是字符串' })
  region?: string[];

  @ApiProperty({
    enum: PLATFORM_PARTNER_PAYMENT_METHODS,
    example: 'wechat',
    description: '打款方式',
  })
  @IsString({ message: '打款方式必须是字符串' })
  paymentMethod: (typeof PLATFORM_PARTNER_PAYMENT_METHODS)[number];

  @ApiProperty({ example: 'wx_test_001', description: '打款账号' })
  @IsString({ message: '打款账号必须是字符串' })
  paymentAccount: string;

  @ApiProperty({
    enum: PLATFORM_PARTNER_INTENTIONS,
    example: 'resource',
    description: '合作意向',
  })
  @IsString({ message: '合作意向必须是字符串' })
  intention: (typeof PLATFORM_PARTNER_INTENTIONS)[number];

  @ApiProperty({
    enum: PLATFORM_PARTNER_STATUS,
    example: 'pending',
    description: '申请状态',
  })
  @IsString({ message: '申请状态必须是字符串' })
  status: (typeof PLATFORM_PARTNER_STATUS)[number];

  @ApiProperty({ example: 1747123200000, description: '申请时间戳（ms）' })
  @IsInt({ message: '申请时间必须是整数' })
  createdAt: number;

  @ApiPropertyOptional({
    example: 1747209600000,
    description: '审核时间戳（ms）',
  })
  @IsOptional()
  @IsInt({ message: '审核时间必须是整数' })
  reviewedAt?: number;

  @ApiPropertyOptional({
    example: 1747219600000,
    description: '成为正式合伙人的时间戳（ms）',
  })
  @IsOptional()
  @IsInt({ message: '成为正式合伙人的时间必须是整数' })
  joinedAt?: number;

  @ApiPropertyOptional({
    example: '有行业资源，希望合作推广',
    description: '申请理由 / 自我介绍',
  })
  @IsOptional()
  @IsString({ message: '申请理由必须是字符串' })
  applyReason?: string;

  @ApiProperty({
    type: [PlatformMembershipPartnerFollowUpNoteDto],
    description: '跟进备注列表',
  })
  @IsArray({ message: '跟进备注列表必须是数组' })
  @ValidateNested({ each: true })
  @Type(() => PlatformMembershipPartnerFollowUpNoteDto)
  followUpNotes: PlatformMembershipPartnerFollowUpNoteDto[];

  @ApiProperty({ example: 0, description: '当前纯利豆余额' })
  @IsInt({ message: '纯利豆余额必须是整数' })
  beanBalance: number;

  @ApiProperty({ example: 0, description: '累计获得纯利豆数量' })
  @IsInt({ message: '累计获得纯利豆数量必须是整数' })
  totalEarnedBeans: number;

  @ApiProperty({ example: 0, description: '累计提现纯利豆数量' })
  @IsInt({ message: '累计提现纯利豆数量必须是整数' })
  totalWithdrawnBeans: number;
}

export class PlatformMembershipPartnerLevelDto {
  @ApiPropertyOptional({
    enum: PLATFORM_PARTNER_LEVEL_VALUES,
    example: 'elite',
    description: '当前合伙人等级，非正式合伙人时为空',
  })
  @IsOptional()
  @IsString({ message: '合伙人等级必须是字符串' })
  partnerLevel: (typeof PLATFORM_PARTNER_LEVEL_VALUES)[number] | null;

  @ApiProperty({ example: 12, description: '本月已充值推广人数' })
  @IsInt({ message: '本月已充值推广人数必须是整数' })
  monthChargedCount: number;

  @ApiPropertyOptional({
    example: 18,
    description: '距离下一等级还差人数，最高等级时为空',
  })
  @IsOptional()
  @IsInt({ message: '升级剩余人数必须是整数' })
  monthCountToNextLevel: number | null;
}

export class PlatformMembershipPartnerProfileResponseDto {
  @ApiProperty({ example: true, description: '当前是否为正式合伙人' })
  @IsBoolean({ message: '是否为正式合伙人必须是布尔值' })
  isPartner: boolean;

  @ApiPropertyOptional({
    type: PlatformMembershipPartnerApplicationDto,
    description: '当前门店最近一次申请记录',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => PlatformMembershipPartnerApplicationDto)
  currentApplication: PlatformMembershipPartnerApplicationDto | null;

  @ApiProperty({
    type: [PlatformMembershipPartnerApplicationDto],
    description: '申请记录列表，按申请时间倒序返回',
  })
  @IsArray({ message: '申请记录列表必须是数组' })
  @ValidateNested({ each: true })
  @Type(() => PlatformMembershipPartnerApplicationDto)
  applications: PlatformMembershipPartnerApplicationDto[];

  @ApiPropertyOptional({
    type: PlatformMembershipApprovedPartnerDto,
    description: '兼容旧前端的主合伙人摘要',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => PlatformMembershipApprovedPartnerDto)
  approvedPartner: PlatformMembershipApprovedPartnerDto | null;

  @ApiProperty({
    type: [PlatformMembershipApprovedPartnerDto],
    description: '当前门店全部正式合伙人列表',
  })
  @IsArray({ message: '正式合伙人列表必须是数组' })
  @ValidateNested({ each: true })
  @Type(() => PlatformMembershipApprovedPartnerDto)
  approvedPartners: PlatformMembershipApprovedPartnerDto[];

  @ApiProperty({
    type: PlatformMembershipPartnerLevelDto,
    description: '合伙人等级信息',
  })
  @ValidateNested()
  @Type(() => PlatformMembershipPartnerLevelDto)
  level: PlatformMembershipPartnerLevelDto;
}

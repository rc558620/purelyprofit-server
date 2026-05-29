import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsOptional, IsString, ValidateNested } from 'class-validator';
import {
  PlatformMembershipApprovedPartnerDto,
} from '../../platform-membership/dto/platform-membership-response.dto';
import {
  PARTNER_WITHDRAWAL_STATUS_VALUES,
  WITHDRAWAL_ACCOUNT_TYPE_VALUES,
  type PartnerWithdrawalStatusValue,
  type WithdrawalAccountTypeValue,
} from './apply-withdrawal.dto';

export class WithdrawalOverviewResponseDto {
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

  @ApiProperty({ example: 1200, description: '当前可提现纯利豆余额（聚合）' })
  @IsInt({ message: '可提现纯利豆余额必须是整数' })
  beanBalance: number;

  @ApiProperty({ example: 800, description: '累计提现纯利豆数量' })
  @IsInt({ message: '累计提现纯利豆数量必须是整数' })
  totalWithdrawnBeans: number;

  @ApiProperty({ example: 2, description: '处理中申请数，含审核中和待打款' })
  @IsInt({ message: '处理中申请数必须是整数' })
  pendingCount: number;
}

export class WithdrawalRecordResponseDto {
  @ApiProperty({ example: '12', description: '提现记录 ID' })
  @IsString({ message: '提现记录 ID 必须是字符串' })
  id: string;

  @ApiProperty({ example: 500, description: '提现纯利豆数量' })
  @IsInt({ message: '提现纯利豆数量必须是整数' })
  beanAmount: number;

  @ApiProperty({ example: 50000, description: '对应人民币金额，单位分' })
  @IsInt({ message: '人民币金额必须是整数' })
  rmbAmount: number;

  @ApiProperty({
    enum: WITHDRAWAL_ACCOUNT_TYPE_VALUES,
    example: 'wechat',
    description: '收款方式',
  })
  @IsIn(WITHDRAWAL_ACCOUNT_TYPE_VALUES, { message: '收款方式不合法' })
  accountType: WithdrawalAccountTypeValue;

  @ApiProperty({ example: 'wxid_abc123', description: '收款账号' })
  @IsString({ message: '收款账号必须是字符串' })
  accountNo: string;

  @ApiProperty({ example: '张三', description: '真实姓名' })
  @IsString({ message: '真实姓名必须是字符串' })
  accountName: string;

  @ApiProperty({
    enum: PARTNER_WITHDRAWAL_STATUS_VALUES,
    example: 'pending',
    description: '提现状态',
  })
  @IsIn(PARTNER_WITHDRAWAL_STATUS_VALUES, { message: '提现状态不合法' })
  status: PartnerWithdrawalStatusValue;

  @ApiProperty({ example: 1747123200000, description: '申请时间戳（ms）' })
  @IsInt({ message: '申请时间戳必须是整数' })
  appliedAt: number;

  @ApiPropertyOptional({
    example: 1747209600000,
    description: '审核时间戳（ms）',
  })
  @IsOptional()
  @IsInt({ message: '审核时间戳必须是整数' })
  reviewedAt?: number;

  @ApiPropertyOptional({
    example: 1747296000000,
    description: '打款时间戳（ms）',
  })
  @IsOptional()
  @IsInt({ message: '打款时间戳必须是整数' })
  paidAt?: number;

  @ApiPropertyOptional({
    example: '账户信息不匹配，请核对后重新提交',
    description: '拒绝原因',
  })
  @IsOptional()
  @IsString({ message: '拒绝原因必须是字符串' })
  rejectReason?: string;
}

export class ApplyWithdrawalResponseDto {
  @ApiProperty({
    type: WithdrawalRecordResponseDto,
    description: '本次提交成功的提现记录',
  })
  record: WithdrawalRecordResponseDto;

  @ApiProperty({
    type: WithdrawalOverviewResponseDto,
    description: '提交后的提现概览数据',
  })
  overview: WithdrawalOverviewResponseDto;
}

export class ReviewWithdrawalResponseDto extends ApplyWithdrawalResponseDto {}

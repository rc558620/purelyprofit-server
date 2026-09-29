import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { PulseMemberBaseDto } from './pulse-membership-admin-member-base.dto';
import {
  PulseAdminMemberLockedPriceDto,
  PulseRechargeRecordDto,
  PulseRenewalPriceAdjustRecordDto,
  PulseSubAccountCapabilityDto,
  PulseSubAccountQuotaRecordDto,
  PulseSubAccountRoleSummaryDto,
  PulseSubAccountSlotDto,
} from './pulse-membership-admin-members.shared.dto';

/**
 * 管理员视角的会员详情（对齐前端 MemberDetail，memberList.types.ts）
 * 公共字段继承自 PulseMemberBaseDto，这里只声明详情独有字段
 */
export class PulseMemberDetailDto extends PulseMemberBaseDto {
  @ApiProperty({
    example: 2800,
    description: '历史累计积分（对齐前端 MemberDetail.totalPointsEarned）',
  })
  @IsInt()
  totalPointsEarned: number;

  @ApiPropertyOptional({
    example: 'P2',
    description: '合伙人等级，非合伙人时为空',
  })
  @IsOptional()
  @IsString()
  partnerLevel?: string;

  @ApiProperty({
    example: 3,
    description: '充值次数（对齐前端 MemberDetail.rechargeCount）',
  })
  @IsInt()
  rechargeCount: number;

  @ApiProperty({
    example: 2,
    description: '推广带来的新用户数（对齐前端 MemberDetail.invitedCount）',
  })
  @IsInt()
  invitedCount: number;

  @ApiProperty({
    type: [PulseRechargeRecordDto],
    description:
      '充值记录列表（商家端微信充值，对齐前端 MemberDetail.rechargeHistory）',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PulseRechargeRecordDto)
  rechargeHistory: PulseRechargeRecordDto[];

  @ApiProperty({
    example: 2,
    description:
      '管理端设置会员等级次数（对齐前端 MemberDetail.adminGrantCount）',
  })
  @IsInt()
  adminGrantCount: number;

  @ApiProperty({
    type: [PulseRechargeRecordDto],
    description:
      '设置会员等级记录列表（对齐前端 MemberDetail.adminGrantHistory）。' +
      'channel=admin 为勾选了计入收入，channel=gift 为按赠送处理（金额显示「赠送」）',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PulseRechargeRecordDto)
  adminGrantHistory: PulseRechargeRecordDto[];

  @ApiProperty({
    example: 2,
    description:
      '调整续费价格次数（对齐前端 MemberDetail.renewalPriceAdjustCount）',
  })
  @IsInt()
  renewalPriceAdjustCount: number;

  @ApiProperty({
    type: [PulseRenewalPriceAdjustRecordDto],
    description:
      '调整续费价格记录列表（对齐前端 MemberDetail.renewalPriceAdjustHistory）。' +
      '记录的是运营议定的基础价覆盖：newPriceDisplay 为 null 表示已清除覆盖、恢复配置价',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PulseRenewalPriceAdjustRecordDto)
  renewalPriceAdjustHistory: PulseRenewalPriceAdjustRecordDto[];

  @ApiProperty({
    example: 2,
    description:
      '子账号额度调整次数（对齐前端 MemberDetail.subAccountQuotaRecordCount）',
  })
  @IsInt()
  subAccountQuotaRecordCount: number;

  @ApiProperty({
    type: [PulseSubAccountQuotaRecordDto],
    description:
      '子账号设置记录列表（对齐前端 MemberDetail.subAccountQuotaRecordHistory）。' +
      '只覆盖额度数值变更：槽位的角色 / 状态 / 分配员工变更没有留痕',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PulseSubAccountQuotaRecordDto)
  subAccountQuotaRecordHistory: PulseSubAccountQuotaRecordDto[];

  @ApiPropertyOptional({
    example: '老会员，优先服务',
    description: '备注（对齐前端 MemberDetail.remark）',
  })
  @IsOptional()
  @IsString()
  remark?: string;

  @ApiProperty({
    type: [PulseAdminMemberLockedPriceDto],
    description:
      '首购锁定价快照（已开通子账号功能的门店按此价续费；空数组表示未锁价）',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PulseAdminMemberLockedPriceDto)
  lockedPrices: PulseAdminMemberLockedPriceDto[];

  @ApiProperty({ example: 10, description: '当前会员允许配置的子账号上限' })
  @IsInt()
  subAccountQuotaMax: number;

  @ApiProperty({ example: 2, description: '已使用子账号数量' })
  @IsInt()
  subAccountsUsedCount: number;

  @ApiProperty({ example: 8, description: '剩余可分配子账号数量' })
  @IsInt()
  subAccountsAvailableCount: number;

  @ApiProperty({
    type: [PulseSubAccountRoleSummaryDto],
    description: '当前门店子账号角色分布摘要',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PulseSubAccountRoleSummaryDto)
  subAccountRoleSummary: PulseSubAccountRoleSummaryDto[];

  @ApiProperty({
    type: [PulseSubAccountSlotDto],
    description: '当前门店子账号槽位列表',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PulseSubAccountSlotDto)
  subAccountSlots: PulseSubAccountSlotDto[];

  @ApiProperty({
    type: PulseSubAccountCapabilityDto,
    description:
      '对齐 purelyPulse 前端 MemberDetail.subAccountCapability 的嵌套结构',
  })
  @ValidateNested()
  @Type(() => PulseSubAccountCapabilityDto)
  subAccountCapability: PulseSubAccountCapabilityDto;
}

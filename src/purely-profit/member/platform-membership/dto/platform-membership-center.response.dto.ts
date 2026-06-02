import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsInt, IsOptional, ValidateNested } from 'class-validator';
import { PlatformMembershipPartnerApplicationDto } from './platform-membership-partner.response.dto';
import {
  PlatformMembershipApprovedPartnerDto,
  PlatformMembershipCenterStatsDto,
  PlatformMembershipInfoDto,
} from './platform-membership-shared.response.dto';

export class PlatformMembershipCenterResponseDto {
  @ApiProperty({
    type: PlatformMembershipInfoDto,
    description: '会员中心基础信息',
  })
  @ValidateNested()
  @Type(() => PlatformMembershipInfoDto)
  memberInfo: PlatformMembershipInfoDto;

  @ApiProperty({ example: 26, description: '剩余会员天数' })
  @IsInt({ message: '剩余会员天数必须是整数' })
  remainingDays: number;

  @ApiProperty({
    type: PlatformMembershipCenterStatsDto,
    description: '会员中心首页权益统计',
  })
  @ValidateNested()
  @Type(() => PlatformMembershipCenterStatsDto)
  stats: PlatformMembershipCenterStatsDto;

  @ApiProperty({ example: 2, description: '已支付的充值订单数' })
  @IsInt({ message: '充值订单数必须是整数' })
  paidOrderCount: number;

  @ApiPropertyOptional({
    type: PlatformMembershipPartnerApplicationDto,
    description: '当前门店最近一次合伙人申请摘要',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => PlatformMembershipPartnerApplicationDto)
  myPartnerApplication: PlatformMembershipPartnerApplicationDto | null;

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
}

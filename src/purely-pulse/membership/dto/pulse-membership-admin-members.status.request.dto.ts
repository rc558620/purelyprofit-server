// Pulse / 管理端会员状态请求 DTO
//
// 只改会员的启用 / 停用 / 封禁状态，不动等级与价格快照。
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PulseAdminMemberIdentityFieldsDto } from './pulse-membership-admin-members.base.dto';
import { PULSE_MEMBER_STATUS_VALUES } from './pulse-membership-admin-members.constants';
import type { PulseMemberStatusValue } from '../membership.types';

/** 修改会员状态 */
export class PulseAdminMemberStatusDto extends PulseAdminMemberIdentityFieldsDto {
  @ApiPropertyOptional({
    enum: PULSE_MEMBER_STATUS_VALUES,
    description: '目标会员状态',
  })
  @IsOptional()
  @IsIn(PULSE_MEMBER_STATUS_VALUES, { message: '会员状态不合法' })
  status?: PulseMemberStatusValue;

  @ApiPropertyOptional({
    enum: PULSE_MEMBER_STATUS_VALUES,
    description: '兼容旧请求的会员状态字段',
  })
  @IsOptional()
  @IsIn(PULSE_MEMBER_STATUS_VALUES, { message: '会员状态不合法' })
  memberStatus?: PulseMemberStatusValue;

  @ApiPropertyOptional({ example: '涉嫌异常操作', description: '操作原因' })
  @IsOptional()
  @IsString({ message: '操作原因必须是字符串' })
  @MaxLength(100, { message: '操作原因最多 100 位' })
  reason?: string;

  @ApiPropertyOptional({
    example: '涉嫌异常操作',
    description: '兼容旧请求的备注字段',
  })
  @IsOptional()
  @IsString({ message: '备注必须是字符串' })
  @MaxLength(100, { message: '备注最多 100 位' })
  remark?: string;
}

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
  PULSE_ADMIN_MEMBER_RECORD_CHANNEL_VALUES,
  PULSE_ADMIN_MEMBER_RECORD_TYPE_VALUES,
} from './pulse-membership-admin-member-records.shared.dto';
import type {
  PulseAdminMemberRecordChannelValue,
  PulseAdminMemberRecordTypeValue,
} from './pulse-membership-admin-member-records.shared.dto';

/**
 * 会员记录时间轴上的一行。
 *
 * 四类记录字段口径不同，这里拍平成统一行结构：金额 / 积分语义只有充值与等级设置两类有，
 * 改价与子账号是「旧值 → 新值」的留痕，用 oldValueDisplay / newValueDisplay 承载。
 */
export class PulseAdminMemberRecordItemDto {
  /** 记录 id：四类表各自自增，因此只有「type + id」才是全局唯一的。 */
  @ApiProperty({ example: '128', description: '记录 ID' })
  @IsString()
  id: string;

  @ApiProperty({
    enum: PULSE_ADMIN_MEMBER_RECORD_TYPE_VALUES,
    description: '记录类型',
  })
  @IsIn(PULSE_ADMIN_MEMBER_RECORD_TYPE_VALUES)
  type: PulseAdminMemberRecordTypeValue;

  @ApiProperty({ example: '12', description: '会员 ID / 门店 ID' })
  @IsString()
  memberId: string;

  @ApiProperty({ example: '张小明', description: '会员展示名' })
  @IsString()
  memberName: string;

  @ApiProperty({ example: '13619654040', description: '会员手机号' })
  @IsString()
  memberPhone: string;

  @ApiProperty({
    example: '年卡',
    description: '套餐 / 档位展示名；子账号设置记录无档位语义，为空串',
  })
  @IsString()
  planName: string;

  @ApiPropertyOptional({
    example: '369',
    description: '金额展示值（元）；赠送类为「赠送」，无金额语义时为 null',
  })
  @IsOptional()
  @IsString()
  amountDisplay: string | null;

  @ApiProperty({
    example: 1500,
    description: '本次充值赠送的积分；等级设置与留痕类记录为 0',
  })
  @IsInt()
  pointsAwarded: number;

  @ApiPropertyOptional({
    enum: PULSE_ADMIN_MEMBER_RECORD_CHANNEL_VALUES,
    description: '支付渠道；非充值 / 等级设置类记录为 null',
  })
  @IsOptional()
  @IsIn(PULSE_ADMIN_MEMBER_RECORD_CHANNEL_VALUES)
  channel: PulseAdminMemberRecordChannelValue | null;

  @ApiPropertyOptional({
    example: '王运营',
    description: '操作人名称；订单类无操作人字段、历史数据缺失时为 null',
  })
  @IsOptional()
  @IsString()
  operatorName: string | null;

  @ApiPropertyOptional({
    example: '369',
    description: '变更前展示值（改价前的议定价 / 变更前的子账号额度）',
  })
  @IsOptional()
  @IsString()
  oldValueDisplay: string | null;

  @ApiPropertyOptional({
    example: '299',
    description:
      '变更后展示值（新的议定价 / 变更后的子账号额度，0 即关闭子账号）',
  })
  @IsOptional()
  @IsString()
  newValueDisplay: string | null;

  @ApiPropertyOptional({
    example: '门店扩编',
    description: '变更原因；未填写时为 null',
  })
  @IsOptional()
  @IsString()
  reason: string | null;

  @ApiProperty({ example: 1759084800000, description: '记录时间戳（ms）' })
  @IsInt()
  createdAt: number;
}

export class PulseAdminMemberRecordsResponseDto {
  @ApiProperty({
    type: [PulseAdminMemberRecordItemDto],
    description: '会员记录列表，按记录时间倒序（跨类型合并后的时间轴）',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PulseAdminMemberRecordItemDto)
  items: PulseAdminMemberRecordItemDto[];

  @ApiProperty({ example: true, description: '是否还有下一页' })
  hasMore: boolean;

  @ApiPropertyOptional({
    example: '1759084800000_adminGrant_128',
    description: '下一页 cursor；没有更多数据时为 null',
  })
  @IsOptional()
  nextCursor: string | null;
}

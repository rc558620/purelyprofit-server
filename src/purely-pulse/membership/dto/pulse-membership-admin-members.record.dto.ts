// Pulse / 管理端会员「记录设置」相关的记录项 DTO
//
// 会员详情页各记录 Tab 的列表项：充值 / 等级设置、子账号额度变更、续费价调整。
// 三类记录来自三张表，运营每改一次留一条痕。

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsIn, IsOptional, IsString } from 'class-validator';
import { PULSE_RECHARGE_CHANNEL_VALUES } from './pulse-membership-admin-members.constants';
import type { PulseRechargeChannelValue } from '../membership.types';

/**
 * 充值记录（对齐前端 RechargeRecord）
 */
export class PulseRechargeRecordDto {
  @ApiProperty({ example: 'rc-001', description: '充值记录 ID' })
  @IsString()
  id: string;

  @ApiProperty({ example: '年卡会员', description: '套餐名称' })
  @IsString()
  planName: string;

  @ApiProperty({ example: 29800, description: '充值金额（分）' })
  @IsInt()
  amount: number;

  @ApiProperty({
    example: '298',
    description: '充值金额展示值（元，字符串），后端直接计算，前端仅展示',
  })
  @IsString()
  amountDisplay: string;

  @ApiProperty({
    example: 500,
    description: '积分奖励（对齐前端 RechargeRecord.pointsAwarded）',
  })
  @IsInt()
  pointsAwarded: number;

  @ApiProperty({
    enum: PULSE_RECHARGE_CHANNEL_VALUES,
    example: 'wechat',
    description:
      '支付渠道：wechat=微信充值 / alipay=支付宝 / card=银行卡 / ' +
      'admin=管理端设置会员等级且计入收入 / gift=管理端设置会员等级按赠送（对齐前端 RechargeRecord.channel）',
  })
  @IsIn(PULSE_RECHARGE_CHANNEL_VALUES)
  channel: PulseRechargeChannelValue;

  @ApiProperty({ example: 1747123200000, description: '充值时间戳（ms）' })
  @IsInt()
  createdAt: number;
}

/**
 * 子账号设置记录（对齐前端 MemberSubAccountQuotaRecord）
 *
 * 数据源为 `store_sub_account_quota_audits`：运营每改一次子账号额度留一条痕。
 * newQuota 为 0 表示这次把子账号功能关掉了。
 */
export class PulseSubAccountQuotaRecordDto {
  @ApiProperty({ example: '11', description: '记录 ID' })
  @IsString()
  id: string;

  @ApiProperty({ example: 2, description: '变更前的子账号额度' })
  @IsInt()
  oldQuota: number;

  @ApiProperty({ example: 5, description: '变更后的子账号额度（0 = 关闭）' })
  @IsInt()
  newQuota: number;

  @ApiPropertyOptional({
    example: '张三',
    description: '操作人名称；用户已注销或历史数据缺失时为空',
  })
  @IsOptional()
  @IsString()
  operatorName: string | null;

  @ApiPropertyOptional({
    example: '门店扩张，新增收银员',
    description: '变更原因；未填写时为 null',
  })
  @IsOptional()
  @IsString()
  reason: string | null;

  @ApiProperty({ example: 1747123200000, description: '变更时间戳（ms）' })
  @IsInt()
  createdAt: number;
}

/**
 * 调整续费价格记录（对齐前端 MemberRenewalPriceAdjustRecord）
 *
 * 数据源为 `store_membership_price_override_audits`：运营每改一次续费价留一条痕。
 * 记录的是**议定基础价**的覆盖（不含子账号加价），因此这里展示的是运营填的价。
 */
export class PulseRenewalPriceAdjustRecordDto {
  @ApiProperty({ example: '7', description: '记录 ID' })
  @IsString()
  id: string;

  @ApiProperty({ example: 'yearly', description: '套餐档位标识' })
  @IsString()
  planId: string;

  @ApiProperty({ example: '年度会员', description: '档位展示名' })
  @IsString()
  planName: string;

  @ApiPropertyOptional({
    example: '398',
    description: '调整前的议定价展示值（元，字符串）；null = 此前未议定',
  })
  @IsOptional()
  @IsString()
  oldPriceDisplay: string | null;

  @ApiPropertyOptional({
    example: '498',
    description:
      '调整后的议定价展示值（元，字符串）；null = 已清除覆盖、恢复默认配置价',
  })
  @IsOptional()
  @IsString()
  newPriceDisplay: string | null;

  @ApiPropertyOptional({
    example: '张三',
    description: '操作人名称；历史数据缺失时为空',
  })
  @IsOptional()
  @IsString()
  operatorName: string | null;

  @ApiProperty({ example: 1747123200000, description: '调整时间戳（ms）' })
  @IsInt()
  createdAt: number;
}

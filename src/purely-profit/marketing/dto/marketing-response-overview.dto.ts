// ─── 营销中心 Response DTOs · 概览数据 ─────────────────────────────────
//
// 约定：
//  - 金额字段单位：元（number，由 Money 类在 mapper 层完成 分→元 转换）
//  - 时间戳字段单位：毫秒（number）

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ─── 概览数据 ─────────────────────────────────────────────────────────

export class MarketingOverviewTrendPointDto {
  @ApiProperty({ example: '5/1' })
  date: string;

  @ApiProperty({ example: 128, description: '当天储值金额，单位：元' })
  amount: number;
}

export class MarketingOverviewMonthlyTrendPointDto {
  @ApiProperty({ example: '5月' })
  label: string;

  @ApiPropertyOptional({
    example: 1280,
    nullable: true,
    description: '当月储值金额，单位：元；无数据时为 null',
  })
  amount: number | null;
}

export class MarketingWechatPayConfigDto {
  @ApiProperty({
    example: true,
    description: '是否已配置微信收款（mchId + apiV3Key 均存在时为 true）',
  })
  configured: boolean;

  @ApiPropertyOptional({
    example: '1234567890',
    description: '微信商户号；未配置时不返回',
  })
  mchId?: string;

  @ApiPropertyOptional({
    example: '纯利优选昆明店',
    description: '微信商户名称；未配置时不返回',
  })
  mchName?: string;

  @ApiPropertyOptional({
    example: '2026-06-13T12:00:00.000Z',
    description: '最近一次配置时间；未配置时不返回',
  })
  configuredAt?: string;
}

export class MarketingOverviewDto {
  /** 储值总额（元）= 全部未消费余额之和 */
  @ApiProperty({ example: 50000, description: '储值余额总计，单位：元' })
  totalBalance: number;

  /** 累计储值金额（元）= 全部充值记录到账金额汇总 */
  @ApiProperty({ example: 16800, description: '累计储值金额，单位：元' })
  totalRecharge: number;

  /** 今日储值金额（元） */
  @ApiProperty({ example: 320, description: '今日储值金额，单位：元' })
  todayRecharge: number;

  /** 本月储值金额（元） */
  @ApiProperty({ example: 1200, description: '本月储值金额，单位：元' })
  thisMonthRecharge: number;

  /** 储值记录总数 */
  @ApiProperty({ example: 156 })
  rechargeCount: number;

  /** 有过消费记录的会员人数（visitCount > 0） */
  @ApiProperty({ example: 87 })
  activeMemberCount: number;

  /** 门店邀请码，purely-club 可通过该邀请码加入门店；门店尚未创建邀请码时为 null */
  @ApiProperty({ example: 'ABCD23', description: '门店邀请码', nullable: true })
  inviteCode: string | null;

  /** 门店邀请码二维码图片 URL，前端扫码页可直接展示；门店尚未创建邀请码时为 null */
  @ApiProperty({
    example:
      'https://api.qrserver.com/v1/create-qr-code/?size=240x240&format=png&margin=0&data=ABCD23',
    description: '门店邀请码二维码图片地址',
    nullable: true,
  })
  inviteCodeQrCodeImageUrl: string | null;

  /** 近 30 天储值趋势 */
  @ApiProperty({ type: [MarketingOverviewTrendPointDto] })
  last30Days: MarketingOverviewTrendPointDto[];

  /** 当前年份，用于"今年 / 去年"趋势切换 */
  @ApiProperty({ example: 2026 })
  currentYear: number;

  /** 今年每月储值趋势（仅含 recharge/gift） */
  @ApiProperty({ type: [MarketingOverviewMonthlyTrendPointDto] })
  thisYearMonthlyTrend: MarketingOverviewMonthlyTrendPointDto[];

  /** 去年每月储值趋势（仅含 recharge/gift） */
  @ApiProperty({ type: [MarketingOverviewMonthlyTrendPointDto] })
  lastYearMonthlyTrend: MarketingOverviewMonthlyTrendPointDto[];

  /** 微信收款配置状态 */
  @ApiProperty({ type: MarketingWechatPayConfigDto })
  wechatPayConfig: MarketingWechatPayConfigDto;
}

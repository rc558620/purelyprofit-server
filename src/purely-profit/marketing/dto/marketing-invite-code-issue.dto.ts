import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/** 渠道二维码渠道类型白名单。 */
export const MARKETING_INVITE_QR_CHANNELS = [
  'poster',
  'tablecard',
  'staff',
  'other',
] as const;

export type MarketingInviteQrChannel = (typeof MARKETING_INVITE_QR_CHANNELS)[number];

/** 创建渠道二维码请求 DTO。 */
export class CreateMarketingInviteQrIssueDto {
  @ApiProperty({
    enum: MARKETING_INVITE_QR_CHANNELS,
    example: 'poster',
    description: '渠道类型：poster=海报 / tablecard=桌牌 / staff=员工 / other=其他',
  })
  @IsIn(MARKETING_INVITE_QR_CHANNELS, {
    message: '渠道类型不合法，仅支持海报/桌牌/员工/其他',
  })
  channel: MarketingInviteQrChannel;

  @ApiProperty({
    example: '开业海报 A 版',
    description: '用途备注（可选），用于运营区分同渠道下的多张二维码',
    required: false,
  })
  @IsOptional()
  @IsString({ message: '备注必须是字符串' })
  @IsNotEmpty({ message: '备注不能为空' })
  @MaxLength(64, { message: '备注最多 64 个字符' })
  name?: string;
}

/** 邀请二维码发行记录响应 DTO。 */
export class MarketingInviteQrIssueDto {
  @ApiProperty({ example: 1, description: '发行记录 ID' })
  id: number;

  @ApiProperty({ example: 'poster', description: '渠道类型' })
  channel: string;

  @ApiProperty({ example: '开业海报 A 版', nullable: true, description: '用途备注' })
  name: string | null;

  @ApiProperty({ example: 'active', enum: ['active', 'revoked'], description: '状态' })
  status: 'active' | 'revoked';

  @ApiProperty({ example: 12, description: '累计扫码解析次数' })
  scanCount: number;

  @ApiProperty({ example: 3, description: '累计成功加入门店次数' })
  joinedCount: number;

  @ApiProperty({ description: '发行时间' })
  issuedAt: Date;

  @ApiProperty({ nullable: true, description: '撤销时间' })
  revokedAt: Date | null;

  @ApiProperty({ example: 'AB23CD45', description: '绑定的门店邀请码' })
  inviteCode: string;

  @ApiProperty({
    example: 'https://club.purelyprofit.com/i/v1/AB23CD45?t=xxx',
    nullable: true,
    description: '可复制的稳定入口 URL（未配置公共域名时为 null）',
  })
  entryUrl: string | null;

  @ApiProperty({ nullable: true, description: '二维码图片 Data URL' })
  qrCodeImageUrl: string | null;
}

/** 渠道二维码列表查询参数。 */
export class ListMarketingInviteQrIssuesQueryDto {
  @ApiProperty({
    enum: MARKETING_INVITE_QR_CHANNELS,
    required: false,
    description: '按渠道筛选',
  })
  @IsOptional()
  @IsIn(MARKETING_INVITE_QR_CHANNELS, { message: '渠道类型不合法' })
  channel?: MarketingInviteQrChannel;

  @ApiProperty({
    enum: ['active', 'revoked'],
    required: false,
    description: '按状态筛选',
  })
  @IsOptional()
  @IsIn(['active', 'revoked'], { message: '状态不合法' })
  status?: 'active' | 'revoked';

  @ApiProperty({ example: 1, required: false, description: '页码（从 1 开始）' })
  @IsOptional()
  page?: number;

  @ApiProperty({ example: 20, required: false, description: '每页条数' })
  @IsOptional()
  pageSize?: number;
}

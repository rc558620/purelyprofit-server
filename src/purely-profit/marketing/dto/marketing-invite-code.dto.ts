import { ApiProperty } from '@nestjs/swagger';

/** 营销中心邀请码二维码响应 DTO。 */
export class MarketingInviteCodeDto {
  /** 门店当前启用的邀请码；未启用时为 null */
  @ApiProperty({
    example: 'AB23CD45',
    description: '门店邀请码，purely-club 可通过该邀请码加入门店',
    nullable: true,
  })
  inviteCode: string | null;

  /** 邀请码二维码图片 Data URL（base64 PNG），可直接用于 <img> 展示 */
  @ApiProperty({
    description: '门店邀请码二维码图片 Data URL',
    nullable: true,
  })
  inviteCodeQrCodeImageUrl: string | null;

  /** 门店当前是否存在有效邀请码 */
  @ApiProperty({ example: true, description: '门店当前是否存在有效邀请码' })
  isActive: boolean;

  /**
   * 二维码载荷协议版本：
   * - v1：稳定 URL 格式（已配置公共域名）；
   * - legacy：裸邀请码格式（未配置公共域名，或线上历史物料）；
   * - null：无有效邀请码。
   */
  @ApiProperty({
    enum: ['v1', 'legacy'],
    nullable: true,
    description: '二维码载荷协议版本',
  })
  inviteQrPayloadVersion: 'v1' | 'legacy' | null;

  /**
   * 可复制的稳定邀请入口 URL（复制链接 / 下载 / 打印时使用）。
   * 未配置公共域名时为 null（此时二维码载荷为裸邀请码，无独立 URL）。
   */
  @ApiProperty({
    example: 'https://club.purelyprofit.com/i/v1/AB23CD45',
    nullable: true,
    description: '可复制的稳定邀请入口 URL',
  })
  inviteQrEntryUrl: string | null;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';

// ─── Request DTOs ──────────────────────────────────────────────────────────────

export class UpdateWechatPayConfigDto {
  @ApiPropertyOptional({
    example: '1234567890',
    description:
      '收款商户号（10 位纯数字）。服务商模式下即**子商户号（sub_mchid）**，' +
      '决定资金结算去向；留空则仅更新其他字段',
  })
  @IsOptional()
  @IsString({ message: 'mchId 必须是字符串' })
  @Matches(/^\d{10}$/, { message: '商户号必须是 10 位纯数字' })
  mchId?: string;

  @ApiPropertyOptional({
    example: '纯利优选昆明店',
    description: '微信商户名称，用于收款页展示',
  })
  @IsOptional()
  @IsString({ message: 'mchName 必须是字符串' })
  @Length(1, 64, { message: '商户名称长度应在 1~64 个字符之间' })
  mchName?: string;

  /**
   * @deprecated 服务商模式下**不需要、也不应提供**：子商户（特约商户）在微信侧
   * 不存在也不支持设置 APIv3 密钥，回调统一由服务商密钥加密。
   * 仅旧直连链路（partner.enabled=false）保留使用，灰度结束后删除。
   */
  @ApiPropertyOptional({
    example: 'abcdefg1234567890ABCDEFG1234567890123456',
    description:
      'APIv3 密钥（32 位字符串）；仅在旧直连模式下需要，服务商模式下无需填写',
  })
  @IsOptional()
  @IsString({ message: 'apiV3Key 必须是字符串' })
  @Length(32, 32, { message: 'APIv3 密钥必须是 32 位字符串' })
  apiV3Key?: string;
}

// ─── Response DTOs ─────────────────────────────────────────────────────────────

export class WechatPayConfigResponseDto {
  @ApiProperty({
    example: true,
    description:
      '是否已完成收款配置。服务商模式下 = 已保存子商户号 **且** 绑定校验通过（verified）；' +
      '直连模式下 = mchId + apiV3Key 均存在',
  })
  @IsBoolean()
  configured: boolean;

  @ApiPropertyOptional({
    example: 'verified',
    description:
      '子商户绑定校验状态：pending=待校验 / verified=已生效 / failed=校验失败；未配置收款时不返回',
  })
  @IsOptional()
  @IsString()
  bindStatus?: string;

  @ApiPropertyOptional({
    example: '2026-10-29T12:00:00.000Z',
    description: '最近一次绑定校验时间；从未校验过时不返回',
  })
  @IsOptional()
  @IsString()
  bindCheckedAt?: string;

  @ApiPropertyOptional({
    example: '该子商户号尚未与本平台服务商绑定或未授权',
    description: '最近一次校验失败的原因（中文，可直接展示给商家）',
  })
  @IsOptional()
  @IsString()
  bindFailReason?: string;

  @ApiPropertyOptional({
    example: '1234567890',
    description: '微信商户号；未配置时不返回',
  })
  @IsOptional()
  @IsString()
  mchId?: string;

  @ApiPropertyOptional({
    example: '纯利优选昆明店',
    description: '微信商户名称；未配置时不返回',
  })
  @IsOptional()
  @IsString()
  mchName?: string;

  @ApiPropertyOptional({
    example: '2026-06-13T12:00:00.000Z',
    description: '最近一次配置时间；未配置时不返回',
  })
  @IsOptional()
  @IsString()
  configuredAt?: string;
}

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
    description: '微信商户号（10 位纯数字），留空则仅更新其他字段',
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

  @ApiPropertyOptional({
    example: 'abcdefg1234567890ABCDEFG1234567890123456',
    description: 'APIv3 密钥（32 位字符串），用于签名和加解密；不传则不修改',
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
    description: '是否已配置微信收款（mchId + apiV3Key 均存在时为 true）',
  })
  @IsBoolean()
  configured: boolean;

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

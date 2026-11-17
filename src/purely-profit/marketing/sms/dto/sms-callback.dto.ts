// ─── 短信钱包微信支付回调 DTO ───────────────────────────────────────────────
//
// 微信回调报文（复用 club 侧结构，独立定义避免反向依赖 club 模块）。

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class SmsWechatCallbackAckDto {
  @ApiProperty({ example: true, description: '是否成功接收并处理回调' })
  success!: boolean;

  @ApiProperty({
    example: 'SM202610152030001234AB',
    description: '业务订单号',
  })
  orderNo!: string;

  @ApiProperty({ example: 'paid', description: '订单处理后状态' })
  status!: string;

  @ApiPropertyOptional({
    example: '订单已入账',
    description: '处理说明（重复回调会返回 already_processed 一类提示）',
  })
  message?: string;
}

export class SmsWechatCallbackResourceDto {
  @ApiProperty({
    example: 'AEAD_AES_256_GCM',
    description: '加密算法，微信固定为 AEAD_AES_256_GCM',
  })
  @IsString()
  algorithm!: string;

  @ApiProperty({ example: 'BxBoAEWAt...', description: 'Base64 密文' })
  @IsString()
  ciphertext!: string;

  @ApiProperty({ example: 'fdasflkjas', description: '加密随机串（12 字节）' })
  @IsString()
  nonce!: string;

  @ApiPropertyOptional({ example: 'transaction', description: '附加数据' })
  @IsOptional()
  @IsString()
  associated_data?: string;
}

export class SmsWechatCallbackDto {
  @ApiProperty({ example: '5d6bb6c0-f7e3-11ed-a05b-0242ac120003' })
  @IsString()
  id!: string;

  @ApiProperty({ example: '2026-10-15T12:31:00+08:00' })
  @IsString()
  create_time!: string;

  @ApiProperty({ example: 'TRANSACTION.SUCCESS' })
  @IsString()
  event_type!: string;

  @ApiPropertyOptional({ example: 'encrypt-resource' })
  @IsOptional()
  @IsString()
  resource_type?: string;

  @ApiPropertyOptional({ example: '支付成功' })
  @IsOptional()
  @IsString()
  summary?: string;

  @ApiProperty({ type: SmsWechatCallbackResourceDto })
  resource!: SmsWechatCallbackResourceDto;
}

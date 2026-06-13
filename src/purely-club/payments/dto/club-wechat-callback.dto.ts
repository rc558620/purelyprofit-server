/**
 * 微信支付回调 DTO（v3 真实格式）
 *
 * 微信推送的回调报文结构：
 * {
 *   "id": "...",
 *   "create_time": "...",
 *   "event_type": "TRANSACTION.SUCCESS",
 *   "resource_type": "encrypt-resource",
 *   "summary": "支付成功",
 *   "resource": {
 *     "algorithm": "AEAD_AES_256_GCM",
 *     "ciphertext": "<base64>",
 *     "nonce": "<12字节随机串>",
 *     "associated_data": "transaction"
 *   }
 * }
 *
 * 解密后的 resource.ciphertext 包含完整交易信息（out_trade_no、transaction_id 等）。
 * 参考：https://pay.weixin.qq.com/docs/merchant/development/interface-rules/callback-notification.html
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import {
  CLUB_ORDER_STATUS_VALUES,
  CLUB_ORDER_TYPE_VALUES,
  type ClubOrderStatusValue,
  type ClubOrderTypeValue,
} from '../../orders/club-order.types';

// ─── 回调加密资源体 ─────────────────────────────────────────────────────────────

export class ClubWechatCallbackResourceDto {
  @ApiProperty({
    example: 'AEAD_AES_256_GCM',
    description: '加密算法，微信固定为 AEAD_AES_256_GCM',
  })
  @IsString()
  algorithm: string;

  @ApiProperty({
    example: 'BxBoAEWAt...',
    description: 'Base64 编码的密文，由 APIv3Key 解密后得到交易详情 JSON',
  })
  @IsString()
  ciphertext: string;

  @ApiProperty({
    example: 'fdasflkjas',
    description: '加密使用的随机串（nonce），12 字节',
  })
  @IsString()
  nonce: string;

  @ApiPropertyOptional({
    example: 'transaction',
    description: '附加数据',
  })
  @IsOptional()
  @IsString()
  associated_data?: string;
}

// ─── 微信真实回调报文 ──────────────────────────────────────────────────────────

export class ClubWechatPaymentCallbackDto {
  @ApiProperty({
    example: '5d6bb6c0-f7e3-11ed-a05b-0242ac120003',
    description: '微信通知 ID',
  })
  @IsString()
  id: string;

  @ApiProperty({
    example: '2026-06-10T12:31:00+08:00',
    description: '通知创建时间（RFC3339 格式）',
  })
  @IsString()
  create_time: string;

  @ApiProperty({
    example: 'TRANSACTION.SUCCESS',
    description: '通知事件类型',
  })
  @IsString()
  event_type: string;

  @ApiPropertyOptional({
    example: 'encrypt-resource',
    description: '通知数据类型',
  })
  @IsOptional()
  @IsString()
  resource_type?: string;

  @ApiPropertyOptional({
    example: '支付成功',
    description: '通知摘要',
  })
  @IsOptional()
  @IsString()
  summary?: string;

  @ApiProperty({
    type: ClubWechatCallbackResourceDto,
    description: '加密的通知资源体',
  })
  @IsObject()
  @ValidateNested()
  @Type(() => ClubWechatCallbackResourceDto)
  resource: ClubWechatCallbackResourceDto;
}

// ─── 回调应答 ──────────────────────────────────────────────────────────────────

export class ClubWechatPaymentCallbackAckDto {
  @ApiProperty({ example: true, description: '是否成功接收并处理回调' })
  success: true;

  @ApiProperty({ example: 'RC202606101230001234', description: '业务订单号' })
  orderNo: string;

  @ApiProperty({
    enum: CLUB_ORDER_TYPE_VALUES,
    description: '订单类型',
  })
  orderType: ClubOrderTypeValue;

  @ApiProperty({
    enum: CLUB_ORDER_STATUS_VALUES,
    description: '当前订单状态',
  })
  status: ClubOrderStatusValue;
}

// ─── 解密后的微信交易资源（内部使用，不对外暴露） ─────────────────────────────

/**
 * 解密 resource.ciphertext 后得到的交易详情结构（微信官方字段）
 *
 * 文档：https://pay.weixin.qq.com/docs/merchant/apis/jsapi-payment/payment-notice.html
 */
export interface WechatDecryptedTransaction {
  /** 业务订单号（即 out_trade_no） */
  out_trade_no: string;
  /** 微信支付流水号 */
  transaction_id: string;
  /** 交易状态，成功时为 SUCCESS */
  trade_state: string;
  /** 支付完成时间（RFC3339） */
  success_time?: string;
  /** 商户号 */
  mchid: string;
  /** 应用 ID */
  appid: string;
  /** 订单金额信息 */
  amount?: {
    /** 用户实际支付金额，单位分 */
    payer_total?: number;
    /** 订单总金额，单位分 */
    total?: number;
  };
}

import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsNumber, IsString } from 'class-validator';
import type { ProfitPaymentMode } from '../profit-payment-mode.constants';

/** 商家端支付模式响应（仅非生产环境可用的调试接口）。 */
export class ProfitPaymentModeResponseDto {
  @ApiProperty({
    example: 'test',
    description:
      '当前支付模式：test=测试模式（跳过微信扣款、订单直接生效）/ live=真实模式（必须扫码真实付款）',
  })
  @IsString({ message: '支付模式必须是字符串' })
  mode: ProfitPaymentMode;

  @ApiProperty({
    example: true,
    description: '当前环境是否允许运行期切换支付模式（生产环境恒为 false）',
  })
  @IsBoolean({ message: 'switchEnabled 必须是布尔值' })
  switchEnabled: boolean;

  @ApiProperty({
    example: true,
    description: '服务端是否已配置切换访问令牌；未配置时切换请求一律拒绝',
  })
  @IsBoolean({ message: 'devTokenConfigured 必须是布尔值' })
  devTokenConfigured: boolean;

  @ApiProperty({
    example: true,
    description:
      '当前是否允许跳过真实扣款把订单直接置为已生效；生产环境恒为 false',
  })
  @IsBoolean({ message: 'skipPaymentAllowed 必须是布尔值' })
  skipPaymentAllowed: boolean;

  @ApiProperty({
    example: 43200,
    description: '运行期模式状态的 TTL（秒），到期后自动回落为配置默认模式',
  })
  @IsNumber({}, { message: 'ttlSeconds 必须是数字' })
  ttlSeconds: number;
}

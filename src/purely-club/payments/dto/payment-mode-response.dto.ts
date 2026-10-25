import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsNumber, IsString } from 'class-validator';
import {
  CLUB_PAYMENT_MODES,
  type ClubPaymentMode,
} from '../club-payment-mode.constants';

/** 支付模式响应（仅非生产环境可用的调试接口）。 */
export class PaymentModeResponseDto {
  @ApiProperty({
    example: 'test',
    description:
      '当前支付模式：test=测试模式（跳过微信扣款、可直接确认支付）/ live=真实模式（必须走微信支付）',
  })
  @IsString({ message: '支付模式必须是字符串' })
  @IsIn(CLUB_PAYMENT_MODES, { message: '支付模式只能是 test 或 live' })
  mode: ClubPaymentMode;

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
      '当前是否允许手动确认支付（跳过微信回调直接置已支付）；生产环境恒为 false',
  })
  @IsBoolean({ message: 'manualConfirmPaidAllowed 必须是布尔值' })
  manualConfirmPaidAllowed: boolean;

  @ApiProperty({
    example: 43200,
    description: '运行期模式状态剩余生效秒数；到期后按安全侧回落为配置默认模式',
  })
  @IsNumber({}, { message: 'ttlSeconds 必须是数字' })
  ttlSeconds: number;
}

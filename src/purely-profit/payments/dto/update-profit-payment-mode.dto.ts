import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString } from 'class-validator';
import {
  PROFIT_PAYMENT_MODES,
  type ProfitPaymentMode,
} from '../profit-payment-mode.constants';

/** 切换商家端支付模式请求（仅非生产环境可用的调试接口）。 */
export class UpdateProfitPaymentModeDto {
  @ApiProperty({
    example: 'live',
    description:
      '目标支付模式：test=测试模式（跳过微信扣款）/ live=真实模式（真实扫码付款）',
  })
  @IsString({ message: '支付模式必须是字符串' })
  @IsIn(PROFIT_PAYMENT_MODES, { message: '支付模式只能是 test 或 live' })
  mode: ProfitPaymentMode;
}

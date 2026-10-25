import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString } from 'class-validator';
import {
  CLUB_PAYMENT_MODES,
  type ClubPaymentMode,
} from '../club-payment-mode.constants';

/** 切换支付模式请求（仅非生产环境可用的调试接口）。 */
export class UpdatePaymentModeDto {
  @ApiProperty({
    example: 'live',
    description:
      '目标支付模式：test=测试模式（跳过微信扣款）/ live=真实模式（真实拉起微信支付）',
  })
  @IsString({ message: '支付模式必须是字符串' })
  @IsIn(CLUB_PAYMENT_MODES, { message: '支付模式只能是 test 或 live' })
  mode: ClubPaymentMode;
}

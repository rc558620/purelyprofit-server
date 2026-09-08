import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateSelfOrderWechatPaymentDto {
  @ApiPropertyOptional({
    description:
      '微信 openid；不传表示不调起真实微信支付（商户号/营业执照未就绪），paymentParams 返回空',
    maxLength: 64,
  })
  @IsOptional()
  @IsString({ message: 'openid 必须是字符串' })
  @MaxLength(64, { message: 'openid 不合法' })
  openid?: string;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsString } from 'class-validator';

/** 微信 JSAPI 拉起参数 */
export class ClubWechatPaymentParamsDto {
  @ApiProperty({ example: '1773556800', description: '微信支付时间戳（秒）' })
  @IsString({ message: 'timeStamp 必须是字符串' })
  timeStamp: string;

  @ApiProperty({ example: '2f9a43758d147637ad1ee19f', description: '随机串' })
  @IsString({ message: 'nonceStr 必须是字符串' })
  nonceStr: string;

  @ApiProperty({
    example: 'prepay_id=club_RC202606101230001234',
    description: '微信预支付包',
  })
  @IsString({ message: 'package 必须是字符串' })
  package: string;

  @ApiProperty({ example: 'RSA', description: '签名算法' })
  @IsString({ message: 'signType 必须是字符串' })
  signType: string;

  @ApiProperty({
    example: 'F2B4977F7F6E9D4A91D3B5B43F3A12F6B7E90B6E96E8B86E9D3B4A7A6A7D15C1',
    description: '支付签名',
  })
  @IsString({ message: 'paySign 必须是字符串' })
  paySign: string;
}

/**
 * 按需取支付参数响应（服务购买单 / 购卡单共用）。
 *
 * 声明在 `ClubWechatPaymentParamsDto` 之后：装饰器元数据在类定义时求值，
 * 提前引用未初始化的类会让 Swagger 在启动阶段拿到 undefined。
 */
export class ClubOrderPaymentParamsResponseDto {
  @ApiProperty({ example: 'SV20261116123000123456', description: '基准订单号' })
  @IsString({ message: 'orderNo 必须是字符串' })
  orderNo: string;

  @ApiProperty({
    example: 'SV20261116123000123456-P01',
    nullable: true,
    description:
      '本次尝试的微信商户单号（out_trade_no）；测试模式或未解析到 openid 时为 null',
  })
  merchantPaymentNo: string | null;

  @ApiPropertyOptional({
    type: ClubWechatPaymentParamsDto,
    nullable: true,
    description: '拉起 wx.requestPayment 所需参数；为 null 表示不应调起收银台',
  })
  paymentParams: ClubWechatPaymentParamsDto | null;

  @ApiProperty({
    example: false,
    description:
      '测试模式：后端不向微信下单（paymentParams 为 null），前端应走 confirm-paid 兜底',
  })
  @IsBoolean({ message: 'testMode 必须是布尔值' })
  testMode: boolean;
}

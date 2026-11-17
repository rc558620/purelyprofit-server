import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { transformOptionalBoolean } from '../../../purely-profit/stores/dto/store-response.dto';

/** 创建服务购买单入参 */
export class CreateClubServiceOrderDto {
  @ApiProperty({ example: 11, description: '当前选中的门店 ID' })
  @Type(() => Number)
  @IsInt({ message: 'storeId 必须是整数' })
  storeId: number;

  @ApiProperty({ example: 18, description: '服务商品 ID' })
  @Type(() => Number)
  @IsInt({ message: 'productId 必须是整数' })
  productId: number;

  @ApiPropertyOptional({
    example: 'oLSdB5A3FRSxSCKrGNGKBhYQ_xyz',
    description:
      '微信用户 openid；前端通过 wx.login 换取后传入，用于 JSAPI 下单',
  })
  @IsOptional()
  @IsString({ message: 'openid 必须是字符串' })
  openid?: string;

  @ApiPropertyOptional({
    example: true,
    description: '是否使用积分抵扣；true 时后端按 1积分=1元汇率计算抵扣金额',
  })
  @IsOptional()
  @IsBoolean({ message: 'usePoints 必须是布尔值' })
  usePoints?: boolean;

  @ApiPropertyOptional({
    example: 1,
    default: 1,
    description: '购买数量；默认 1',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'quantity 必须是整数' })
  @Min(1, { message: 'quantity 最少为 1' })
  quantity?: number;

  @ApiPropertyOptional({
    example: false,
    default: true,
    description:
      '是否在建单时同步向微信预下单：默认 true（与历史行为完全一致，响应带 paymentParams）。' +
      '传 false 时建单不调用微信、响应 paymentParams 为 null，前端需再调' +
      ' `POST /club/orders/service/:orderNo/payment-params` 按需取参（失败可重试，不重复建单）',
  })
  @IsOptional()
  @IsBoolean({ message: 'prepay 必须是布尔值' })
  prepay?: boolean;
}

/** 按需取支付参数入参（服务购买单 / 购卡单共用） */
export class ClubOrderPaymentParamsDto {
  @ApiPropertyOptional({
    example: 'oLSdB5A3FRSxSCKrGNGKBhYQ_xyz',
    description:
      '微信用户 openid；不传时后端按当前登录用户回查。解析不到时不向微信下单，paymentParams 返回 null',
  })
  @IsOptional()
  @IsString({ message: 'openid 必须是字符串' })
  openid?: string;
}

/** 订单状态查询入参 */
export class ClubOrderStatusQueryDto {
  @ApiPropertyOptional({
    example: true,
    description:
      '是否回微信侧核对真实支付结果；拉起支付后结果未知（unknown）时传 true，' +
      '用于判断用户是否已扣款，避免按失败引导重复支付',
  })
  @IsOptional()
  @Transform(transformOptionalBoolean)
  @IsBoolean({ message: 'verify 必须是布尔值' })
  verify?: boolean;
}

/** 服务购买单价格预览入参 */
export class PreviewClubServiceOrderDto {
  @ApiProperty({ example: 11, description: '当前选中的门店 ID' })
  @Type(() => Number)
  @IsInt({ message: 'storeId 必须是整数' })
  storeId: number;

  @ApiProperty({ example: 18, description: '服务商品 ID' })
  @Type(() => Number)
  @IsInt({ message: 'productId 必须是整数' })
  productId: number;

  @ApiPropertyOptional({
    example: true,
    description: '是否使用积分抵扣；true 时后端按积分规则计算抵扣金额',
  })
  @IsOptional()
  @IsBoolean({ message: 'usePoints 必须是布尔值' })
  usePoints?: boolean;

  @ApiPropertyOptional({
    example: 1,
    default: 1,
    description: '购买数量；所有金额字段按此倍数计算',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'quantity 必须是整数' })
  @Min(1, { message: 'quantity 最少为 1' })
  quantity?: number;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import {
  CLUB_ORDER_PAYMENT_CHANNEL_VALUES,
  CLUB_ORDER_PAYMENT_CONFIRMATION_SOURCE_VALUES,
  CLUB_ORDER_STATUS_VALUES,
  CLUB_ORDER_TYPE_VALUES,
  type ClubOrderPaymentChannelValue,
  type ClubOrderPaymentConfirmationSourceValue,
  type ClubOrderStatusValue,
  type ClubOrderTypeValue,
} from '../club-order.types';

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
}

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

export class ClubOrderStatusResponseDto {
  @ApiProperty({ example: 'RC202606101230001234', description: '订单 ID' })
  @IsString({ message: 'id 必须是字符串' })
  id: string;

  @ApiProperty({ example: 'RC202606101230001234', description: '订单号' })
  @IsString({ message: 'orderNo 必须是字符串' })
  orderNo: string;

  @ApiProperty({
    enum: CLUB_ORDER_TYPE_VALUES,
    description: '订单类型：recharge=充值单，service=服务购买单',
  })
  @IsIn(CLUB_ORDER_TYPE_VALUES, { message: 'orderType 不合法' })
  orderType: ClubOrderTypeValue;

  @ApiProperty({ example: '会员充值', description: '订单标题' })
  @IsString({ message: 'title 必须是字符串' })
  title: string;

  @ApiProperty({ example: 500, description: '订单应付金额，单位元' })
  amount: number;

  @ApiProperty({
    enum: CLUB_ORDER_PAYMENT_CHANNEL_VALUES,
    description: '支付渠道',
  })
  @IsIn(CLUB_ORDER_PAYMENT_CHANNEL_VALUES, { message: 'paymentChannel 不合法' })
  paymentChannel: ClubOrderPaymentChannelValue;

  @ApiProperty({
    enum: CLUB_ORDER_STATUS_VALUES,
    description: '订单状态',
  })
  @IsIn(CLUB_ORDER_STATUS_VALUES, { message: 'status 不合法' })
  status: ClubOrderStatusValue;

  @ApiProperty({ example: '2026-06-10T12:30:00.000Z', description: '创建时间' })
  @IsString({ message: 'createdAt 必须是字符串' })
  createdAt: string;

  @ApiProperty({
    example: '2026-06-10T12:45:00.000Z',
    description: '订单过期时间',
  })
  @IsString({ message: 'expiresAt 必须是字符串' })
  expiresAt: string;

  @ApiPropertyOptional({
    example: '2026-06-10T12:31:00.000Z',
    description: '支付完成时间',
  })
  @IsOptional()
  @IsString({ message: 'paidAt 必须是字符串' })
  paidAt: string | null;

  @ApiPropertyOptional({
    example: '4200001234202606101234567890',
    description: '支付流水号；收到微信支付回调后返回',
  })
  @IsOptional()
  @IsString({ message: 'paymentTransactionId 必须是字符串' })
  paymentTransactionId: string | null;

  @ApiPropertyOptional({
    example: '2026-06-10T12:31:03.000Z',
    description: '服务端收到支付回调的时间；未收到回调时为空',
  })
  @IsOptional()
  @IsString({ message: 'callbackReceivedAt 必须是字符串' })
  callbackReceivedAt: string | null;

  @ApiPropertyOptional({
    enum: CLUB_ORDER_PAYMENT_CONFIRMATION_SOURCE_VALUES,
    description: '订单被标记为已支付的确认来源',
  })
  @IsOptional()
  @IsIn(CLUB_ORDER_PAYMENT_CONFIRMATION_SOURCE_VALUES, {
    message: 'paymentConfirmationSource 不合法',
  })
  paymentConfirmationSource: ClubOrderPaymentConfirmationSourceValue | null;

  @ApiProperty({
    example: '微信支付回调已确认并完成落账',
    description: '订单当前状态的人类可读说明，便于前端直接展示联调态信息',
  })
  @IsString({ message: 'statusReason 必须是字符串' })
  statusReason: string;
}

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

export class ClubOrderBreakdownItemDto {
  @ApiProperty({ example: 'member-price', description: '行标识' })
  @IsString({ message: '行标识必须是字符串' })
  id: string;

  @ApiProperty({ example: '会员售价', description: '行标签文案' })
  @IsString({ message: '行标签文案必须是字符串' })
  label: string;

  @ApiProperty({ example: '¥619.2', description: '行金额展示文案' })
  @IsString({ message: '行金额展示文案必须是字符串' })
  value: string;

  @ApiProperty({ example: false, description: '是否为扣减项（展示为负数/绿色）' })
  @IsBoolean({ message: '扣减标识必须是布尔值' })
  isDeduction: boolean;

  @ApiProperty({ example: false, description: '是否为划线项（被更优折扣覆盖）' })
  @IsBoolean({ message: '划线标识必须是布尔值' })
  isStrikethrough: boolean;
}

export class ClubServiceOrderPreviewResponseDto {
  @ApiProperty({ example: 688, description: '服务原价，单位元' })
  originalPrice: number;

  @ApiProperty({ example: 619.2, description: '会员基准价（原价 × 等级折扣率），单位元' })
  memberBaselinePrice: number;

  @ApiProperty({ example: 516, description: '折扣后价格（叠加折扣活动后），单位元' })
  afterDiscountPrice: number;

  @ApiProperty({ example: 50, description: '满减减免金额，单位元' })
  reduceAmount: number;

  @ApiProperty({ example: 466, description: '最终价格（折扣后 - 满减），单位元；不含积分抵扣' })
  finalPrice: number;

  @ApiProperty({ example: 222, description: '总节省金额（原价 - 最终价，不含积分抵扣），单位元' })
  totalSavingAmount: number;

  @ApiPropertyOptional({
    example: 322,
    description:
      '含积分抵扣的总节省金额（原价 - 积分抵扣后实付），单位元；仅当 usePoints=true 且积分抵扣 > 0 时返回',
  })
  @IsOptional()
  totalSavingWithPoints: number | null;

  @ApiPropertyOptional({ example: 100, description: '积分抵扣金额，单位元；0 表示未使用积分' })
  pointsDeductionAmount: number;

  @ApiPropertyOptional({ example: 100, description: '实际消耗的积分数量；0 表示未使用积分' })
  pointsUsed: number;

  @ApiPropertyOptional({ example: 366, description: '积分抵扣后实付金额，单位元' })
  afterPointsPrice: number;

  @ApiPropertyOptional({
    example: '18',
    description: '命中的活动 ID；未命中优惠时为空',
  })
  @IsOptional()
  @IsString({ message: 'promotionId 必须是字符串' })
  promotionId: string | null;

  @ApiPropertyOptional({
    example: 'first_order_discount',
    description: '命中的活动类型',
  })
  @IsOptional()
  @IsString({ message: 'promotionType 必须是字符串' })
  promotionType: string | null;

  @ApiPropertyOptional({
    example: 75,
    description: '命中的折扣率；75 表示 7.5 折',
  })
  @IsOptional()
  discountRate: number | null;

  @ApiPropertyOptional({
    example: '首单 7.5 折',
    description: '活动标签',
  })
  @IsOptional()
  @IsString({ message: 'promotionTag 必须是字符串' })
  promotionTag: string | null;

  @ApiProperty({ example: 1, description: '购买数量；所有金额已按此倍数计算' })
  quantity: number;

  @ApiProperty({
    type: [ClubOrderBreakdownItemDto],
    description: '价格拆解展示行；前端直接渲染，禁止再做金额/折扣推导',
  })
  breakdownItems: ClubOrderBreakdownItemDto[];
}

export class ClubServiceOrderResponseDto extends ClubOrderStatusResponseDto {
  @ApiProperty({ example: '18', description: '服务商品 ID' })
  @IsString({ message: 'productId 必须是字符串' })
  productId: string;

  @ApiProperty({ example: '黄金焕肤疗程', description: '服务商品名称' })
  @IsString({ message: 'productName 必须是字符串' })
  productName: string;

  @ApiProperty({ example: 688, description: '服务原价，单位元' })
  originalAmount: number;

  @ApiProperty({
    example: 189,
    description: '本次优惠金额，单位元；未命中优惠时返回 0',
  })
  discountAmount: number;

  @ApiPropertyOptional({
    example: '18',
    description: '命中的活动 ID；未命中优惠时为空',
  })
  @IsOptional()
  @IsString({ message: 'promotionId 必须是字符串' })
  promotionId: string | null;

  @ApiPropertyOptional({
    example: 'first_order_discount',
    description: '命中的活动类型；未命中优惠时为空',
  })
  @IsOptional()
  @IsString({ message: 'promotionType 必须是字符串' })
  promotionType: string | null;

  @ApiPropertyOptional({
    example: 75,
    description: '命中的折扣率；75 表示 7.5 折，未命中优惠时为空',
  })
  @IsOptional()
  discountRate: number | null;

  @ApiPropertyOptional({
    example: '首单 7.5 折',
    description: '命中的活动标签；未命中优惠时为空',
  })
  @IsOptional()
  @IsString({ message: 'promotionTag 必须是字符串' })
  promotionTag: string | null;

  @ApiPropertyOptional({
    example: 'https://cdn.example.com/products/18.png',
    description: '服务封面图',
  })
  @IsOptional()
  @IsString({ message: 'coverImage 必须是字符串' })
  coverImage?: string;

  @ApiPropertyOptional({
    type: ClubWechatPaymentParamsDto,
    description: '发起微信支付所需参数；未传 openid 时为 null',
  })
  @IsOptional()
  paymentParams: ClubWechatPaymentParamsDto | null;
}

// 纯利宝团购券订单：请求/响应 DTO
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { type ClubVoucherOrderStatusValue } from '../club-voucher-orders.types';

/** 创建团购券订单入参 */
export class CreateClubVoucherOrderDto {
  @ApiProperty({ example: 11, description: '当前选中的门店 ID' })
  @Type(() => Number)
  @IsInt({ message: 'storeId 必须是整数' })
  storeId: number;

  @ApiProperty({ example: 18, description: '团购券商品 ID' })
  @Type(() => Number)
  @IsInt({ message: 'productId 必须是整数' })
  productId: number;

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
    example: 2,
    description: '到店人数（默认取商品配置人数，下单时可调整）',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'personCount 必须是整数' })
  @Min(1, { message: 'personCount 最少为 1' })
  personCount?: number;

  @ApiPropertyOptional({
    example: true,
    description: '是否使用积分抵扣；true 时后端按积分规则计算抵扣金额',
  })
  @IsOptional()
  @IsBoolean({ message: 'usePoints 必须是布尔值' })
  usePoints?: boolean;

  @ApiPropertyOptional({
    example: 'oLSdB5A3FRSxSCKrGNGKBhYQ_xyz',
    description:
      '微信用户 openid；前端通过 wx.login 换取后传入，用于 JSAPI 下单',
  })
  @IsOptional()
  @IsString({ message: 'openid 必须是字符串' })
  @MaxLength(128, { message: 'openid 最长 128 个字符' })
  openid?: string;
}

/** 团购券订单价格预计算入参（字段与创建一致，抽成别名便于 Swagger 区分） */
export class PreviewClubVoucherOrderDto {
  @ApiProperty({ example: 11, description: '当前选中的门店 ID' })
  @Type(() => Number)
  @IsInt({ message: 'storeId 必须是整数' })
  storeId: number;

  @ApiProperty({ example: 18, description: '团购券商品 ID' })
  @Type(() => Number)
  @IsInt({ message: 'productId 必须是整数' })
  productId: number;

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
    example: 2,
    description: '到店人数（默认取商品配置人数）',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'personCount 必须是整数' })
  @Min(1, { message: 'personCount 最少为 1' })
  personCount?: number;

  @ApiPropertyOptional({
    example: true,
    description: '是否使用积分抵扣；true 时后端按积分规则计算抵扣金额',
  })
  @IsOptional()
  @IsBoolean({ message: 'usePoints 必须是布尔值' })
  usePoints?: boolean;
}

/** 团购券订单价格预计算结果 */
export class ClubVoucherOrderPreviewResponseDto {
  @ApiProperty({ example: 17850, description: '应付金额（分，原价口径）' })
  originalAmountFen: number;

  @ApiProperty({ example: 5000, description: '优惠金额（分）' })
  discountAmountFen: number;

  @ApiProperty({ example: 12850, description: '实付金额（分）' })
  paidAmountFen: number;

  @ApiProperty({ example: 0, description: '积分抵扣金额（分）' })
  pointsDeductFen: number;

  @ApiProperty({ example: 0, description: '实际扣减积分个数' })
  pointsUsed: number;

  @ApiProperty({ example: 2, description: '到店人数（下单时落订单快照）' })
  personCount: number;

  @ApiPropertyOptional({
    example: 128,
    description: '当前余额（分），用于前端展示余额不足提示',
  })
  balanceEnough?: boolean;

  @ApiProperty({
    example: 8800,
    description: '会员价小计（分）= 商品会员价 × 数量',
  })
  memberAmountFen: number;

  @ApiProperty({ example: 6600, description: '活动折后小计（分，满减前）' })
  afterDiscountAmountFen: number;

  @ApiProperty({ example: 800, description: '整单满减金额（分）' })
  reduceFen: number;

  @ApiProperty({ example: 2200, description: '活动折扣优惠金额（分）' })
  promotionDiscountFen: number;

  @ApiPropertyOptional({ example: 'discount', description: '命中活动类型' })
  promotionType?: string | null;

  @ApiPropertyOptional({ example: '折扣', description: '命中活动标签' })
  promotionTag?: string | null;

  @ApiPropertyOptional({
    example: 75,
    description: '命中活动折扣率（0-100 整数）',
  })
  discountRate?: number | null;

  @ApiPropertyOptional({
    example: 0.8,
    description: '会员等级折扣率（0-1 小数）',
  })
  memberDiscountRate?: number | null;

  @ApiProperty({
    type: [Object],
    description: '优惠拆解展示行（前端直接渲染）',
  })
  breakdownItems: Array<{
    id: string;
    label: string;
    value: string;
    isDeduction: boolean;
    isStrikethrough: boolean;
  }>;
}

/** 微信支付参数（前端 wx.requestPayment 入参） */
export class ClubVoucherWechatPaymentParamsDto {
  @ApiProperty({ description: '时间戳（秒）' })
  timeStamp: string;

  @ApiProperty({ description: '随机字符串' })
  nonceStr: string;

  @ApiProperty({ description: '订单详情扩展字符串（prepay_id=xxx）' })
  package: string;

  @ApiProperty({ description: '签名方式，固定 RSA' })
  signType: string;

  @ApiProperty({ description: '支付签名' })
  paySign: string;
}

/** 团购券订单条目（列表/详情共用基础字段） */
export class ClubVoucherOrderItemDto {
  @ApiProperty({ example: 'VC20260810143000001', description: '业务订单号' })
  orderNo: string;

  @ApiPropertyOptional({ example: 'VC20260810ABCDEF', description: '团购券码' })
  voucherCode?: string;

  @ApiProperty({ example: 'chunlibao', description: '团购平台' })
  platform: string;

  @ApiProperty({ example: '小包套餐', description: '商品名称' })
  productName: string;

  @ApiProperty({ example: 1, description: '购买数量' })
  quantity: number;

  @ApiProperty({ example: 2, description: '到店人数' })
  personCount?: number;

  @ApiProperty({ example: 17850, description: '应付金额（分）' })
  originalAmountFen: number;

  @ApiProperty({ example: 5000, description: '优惠金额（分）' })
  discountAmountFen: number;

  @ApiProperty({ example: 12850, description: '实付金额（分）' })
  paidAmountFen: number;

  @ApiProperty({ example: 'pending', description: '订单状态' })
  status: ClubVoucherOrderStatusValue;

  @ApiProperty({ example: '待使用', description: '状态展示文案' })
  statusLabel: string;

  @ApiProperty({ example: '测试门店', description: '下单门店名称' })
  storeName: string;

  @ApiPropertyOptional({
    example: 'https://cdn.xxx/1.jpg',
    description: '商品图片 URL',
  })
  image?: string;

  @ApiPropertyOptional({
    example: '2026-07-15',
    description: '有效期至（日期）',
  })
  expireDate?: string;

  @ApiProperty({ example: '2026-08-10 14:30', description: '下单时间' })
  createdAtLabel: string;
}

/** 团购券订单详情 */
export class ClubVoucherOrderDetailDto extends ClubVoucherOrderItemDto {
  @ApiPropertyOptional({ description: '用户端立即核销时间' })
  verifyAt?: string;

  @ApiPropertyOptional({ description: '开台核销时间（used-已开台）' })
  usedAt?: string;

  @ApiPropertyOptional({ description: '核销门店名称' })
  usedStoreName?: string;

  @ApiPropertyOptional({ description: '退款时间' })
  refundAt?: string;

  @ApiPropertyOptional({ description: '退款金额（分）' })
  refundAmountFen?: number;

  @ApiProperty({ example: '微信支付', description: '支付方式文案' })
  paymentMethodLabel: string;

  @ApiProperty({ description: '订单编号（复制用）' })
  orderId: string;

  @ApiProperty({ description: '下单时间文案' })
  orderTimeLabel: string;

  @ApiProperty({
    type: [Object],
    description: '优惠拆解展示行（与服务详情页一致，前端直接渲染）',
  })
  breakdownItems: Array<{
    id: string;
    label: string;
    value: string;
    isDeduction: boolean;
    isStrikethrough: boolean;
  }>;
}

/** 创建订单响应：订单草稿 + 微信支付参数 */
export class ClubVoucherOrderResponseDto {
  @ApiProperty({ description: '业务订单号（草稿态 id）' })
  id: string;

  @ApiProperty({ description: '业务订单号（微信 out_trade_no）' })
  orderNo: string;

  @ApiPropertyOptional({
    example: 'VC20260810143000001',
    description: '团购券码（支付成功后返回）',
  })
  voucherCode?: string;

  @ApiProperty({ example: 'unpaid', description: '订单状态' })
  status: ClubVoucherOrderStatusValue;

  @ApiProperty({ example: 12850, description: '应付金额（分）' })
  amountFen: number;

  @ApiProperty({
    description: '微信支付参数；openid 未传时为 undefined（开发态）',
  })
  paymentParams?: ClubVoucherWechatPaymentParamsDto;
}

/** 团购券订单列表响应（分页） */
export class ClubVoucherOrderListResponseDto {
  @ApiProperty({ type: [ClubVoucherOrderItemDto], description: '订单列表' })
  items: ClubVoucherOrderItemDto[];

  @ApiProperty({ example: false, description: '是否还有下一页' })
  hasMore: boolean;
}

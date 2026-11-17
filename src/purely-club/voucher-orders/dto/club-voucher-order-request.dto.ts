// 纯利宝团购券订单：请求 DTO
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { transformOptionalBoolean } from '../../../purely-profit/stores/dto/store-response.dto';
import {
  CLUB_VOUCHER_MAX_PERSON_COUNT,
  CLUB_VOUCHER_MAX_QUANTITY,
} from '../club-voucher-orders.constants';

/** 团购券订单详情查询入参 */
export class ClubVoucherOrderStatusQueryDto {
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

/** 团购券订单列表筛选入参 */
export class ListClubVoucherOrdersQueryDto {
  @ApiPropertyOptional({
    enum: ['all', 'pending', 'used', 'refunded', 'expired'],
    description: '订单状态筛选；不传表示全部',
  })
  @IsOptional()
  @IsIn(['all', 'pending', 'used', 'refunded', 'expired'], {
    message: 'status 不合法',
  })
  status?: string;

  @ApiPropertyOptional({
    example: 20,
    default: 20,
    maximum: 50,
    description: '每页数量（默认 20，最大 50）',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit 必须是整数' })
  @Min(1, { message: 'limit 最少为 1' })
  @Max(50, { message: 'limit 最大为 50' })
  limit?: number;

  @ApiPropertyOptional({
    example: 'v1:eyJrZXlzIjpbMTc2MTAwMDAwMDAwMF0sImlkIjoxOH0',
    description:
      '分页游标（上一页返回的 nextCursor）；不传表示第一页，需原样回传。' +
      '游标与当前 status 的排序键绑定，切换 Tab 必须丢弃旧游标',
  })
  @IsOptional()
  @IsString({ message: 'cursor 必须是字符串' })
  cursor?: string;
}

/** 创建团购券订单入参 */
export class CreateClubVoucherOrderDto {
  @ApiProperty({ example: 11, description: '当前选中的门店 ID' })
  @Type(() => Number)
  @IsInt({ message: 'storeId 必须是整数' })
  @Min(1, { message: 'storeId 不合法' })
  storeId: number;

  @ApiProperty({ example: 18, description: '团购券商品 ID' })
  @Type(() => Number)
  @IsInt({ message: 'productId 必须是整数' })
  @Min(1, { message: 'productId 不合法' })
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
  @Max(CLUB_VOUCHER_MAX_QUANTITY, {
    message: `quantity 最多为 ${CLUB_VOUCHER_MAX_QUANTITY}`,
  })
  quantity?: number;

  @ApiPropertyOptional({
    example: 2,
    description: '到店人数（默认取商品配置人数，下单时可调整）',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'personCount 必须是整数' })
  @Min(1, { message: 'personCount 最少为 1' })
  @Max(CLUB_VOUCHER_MAX_PERSON_COUNT, {
    message: `personCount 最多为 ${CLUB_VOUCHER_MAX_PERSON_COUNT}`,
  })
  personCount?: number;

  @ApiPropertyOptional({
    example: true,
    description: '是否使用积分抵扣；true 时后端按积分规则计算抵扣金额',
  })
  @IsOptional()
  @IsBoolean({ message: 'usePoints 必须是布尔值' })
  usePoints?: boolean;

  @ApiPropertyOptional({
    example: '2人同行，需要靠窗座位',
    description: '下单备注（选填，商家端新订单通知展示）',
  })
  @IsOptional()
  @IsString({ message: 'remark 必须是字符串' })
  @MaxLength(200, { message: 'remark 最长 200 个字符' })
  remark?: string;

  @ApiPropertyOptional({
    example: 'oLSdB5A3FRSxSCKrGNGKBhYQ_xyz',
    description:
      '微信用户 openid；前端通过 wx.login 换取后传入，用于 JSAPI 下单',
  })
  @IsOptional()
  @IsString({ message: 'openid 必须是字符串' })
  @MaxLength(128, { message: 'openid 最长 128 个字符' })
  openid?: string;

  @ApiPropertyOptional({
    example: 'balance',
    enum: ['wechat', 'balance'],
    default: 'wechat',
    description:
      '支付方式：wechat（微信支付，默认）/ balance（储值余额，下单即扣款并生成券码）',
  })
  @IsOptional()
  @IsIn(['wechat', 'balance'], { message: 'paymentMethod 不合法' })
  paymentMethod?: 'wechat' | 'balance';
}

/** 团购券订单价格预计算入参（字段与创建一致，抽成别名便于 Swagger 区分） */
export class PreviewClubVoucherOrderDto {
  @ApiProperty({ example: 11, description: '当前选中的门店 ID' })
  @Type(() => Number)
  @IsInt({ message: 'storeId 必须是整数' })
  @Min(1, { message: 'storeId 不合法' })
  storeId: number;

  @ApiProperty({ example: 18, description: '团购券商品 ID' })
  @Type(() => Number)
  @IsInt({ message: 'productId 必须是整数' })
  @Min(1, { message: 'productId 不合法' })
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
  @Max(CLUB_VOUCHER_MAX_QUANTITY, {
    message: `quantity 最多为 ${CLUB_VOUCHER_MAX_QUANTITY}`,
  })
  quantity?: number;

  @ApiPropertyOptional({
    example: 2,
    description: '到店人数（默认取商品配置人数）',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'personCount 必须是整数' })
  @Min(1, { message: 'personCount 最少为 1' })
  @Max(CLUB_VOUCHER_MAX_PERSON_COUNT, {
    message: `personCount 最多为 ${CLUB_VOUCHER_MAX_PERSON_COUNT}`,
  })
  personCount?: number;

  @ApiPropertyOptional({
    example: true,
    description: '是否使用积分抵扣；true 时后端按积分规则计算抵扣金额',
  })
  @IsOptional()
  @IsBoolean({ message: 'usePoints 必须是布尔值' })
  usePoints?: boolean;
}

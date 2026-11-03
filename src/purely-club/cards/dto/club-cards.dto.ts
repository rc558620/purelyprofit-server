// 纯利宝 C 端会员卡购买 / 卡包：请求 / 响应 DTO
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { transformOptionalBoolean } from '../../../purely-profit/stores/dto/store-response.dto';
import { ClubWechatPaymentParamsDto } from '../../orders/dto/club-order.dto';
import {
  CLUB_CARD_LIST_DEFAULT_LIMIT,
  CLUB_CARD_LIST_MAX_LIMIT,
} from '../club-cards.constants';
import {
  CLUB_MEMBER_CARD_LIST_STATUS_VALUES,
  type ClubMemberCardListStatusValue,
  type ClubMemberCardOrderStatusValue,
  type ClubMemberCardStatusValue,
  type ClubMemberCardUsageTypeValue,
} from '../club-cards.types';

/** 卡类型（与数据库 MemberCardKind 对齐） */
const CLUB_CARD_KINDS = ['monthly', 'quarterly', 'yearly', 'times'] as const;

/** 可购卡模板查询入参 */
export class ListClubCardPlansQueryDto {
  @ApiPropertyOptional({
    example: 11,
    description: '门店 ID；须与当前门店一致',
  })
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt({ message: 'storeId 必须是整数' })
  @Min(1, { message: 'storeId 不合法' })
  storeId?: number;

  @ApiPropertyOptional({
    enum: CLUB_CARD_KINDS,
    description: '卡类型筛选；不传返回全部上架卡',
  })
  @IsOptional()
  @IsIn(CLUB_CARD_KINDS, { message: 'kind 取值不合法' })
  kind?: (typeof CLUB_CARD_KINDS)[number];
}

/** 创建购卡订单入参 */
export class CreateClubCardOrderDto {
  @ApiProperty({ example: '3', description: '卡模板 ID（字符串形式的主键）' })
  @IsString({ message: 'planId 必须是字符串' })
  @IsNotEmpty({ message: 'planId 不能为空' })
  @Matches(/^\d+$/, { message: 'planId 必须是数字字符串' })
  planId: string;

  @ApiPropertyOptional({
    example: 11,
    description: '门店 ID；须与当前门店一致',
  })
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt({ message: 'storeId 必须是整数' })
  @Min(1, { message: 'storeId 不合法' })
  storeId?: number;
}

/** 我的卡包查询入参 */
export class ListClubCardsQueryDto {
  @ApiPropertyOptional({
    enum: CLUB_MEMBER_CARD_LIST_STATUS_VALUES,
    description:
      '持卡状态筛选；usedUp 对应数据库 exhausted。' +
      'expired / usedUp 由服务端按有效期与剩余次数派生，不依赖数据库惰性翻转',
  })
  @IsOptional()
  @IsIn(CLUB_MEMBER_CARD_LIST_STATUS_VALUES, {
    message: 'status 取值不合法',
  })
  status?: ClubMemberCardListStatusValue;

  @ApiPropertyOptional({
    example: CLUB_CARD_LIST_DEFAULT_LIMIT,
    default: CLUB_CARD_LIST_DEFAULT_LIMIT,
    description: '每页条数',
  })
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt({ message: 'limit 必须是整数' })
  @Min(1, { message: 'limit 最少为 1' })
  @Max(CLUB_CARD_LIST_MAX_LIMIT, {
    message: `limit 最多为 ${CLUB_CARD_LIST_MAX_LIMIT}`,
  })
  limit?: number;

  @ApiPropertyOptional({
    example: '0',
    description: '分页游标（上一页返回的 nextCursor）',
  })
  @IsOptional()
  @IsString({ message: 'cursor 必须是字符串' })
  cursor?: string;
}

/** 购卡订单详情查询入参 */
export class GetClubCardOrderQueryDto {
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

/** 可购卡模板响应 */
export class ClubMemberCardPlanDto {
  @ApiProperty({ example: '3' })
  id: string;

  @ApiProperty({ enum: CLUB_CARD_KINDS, example: 'yearly' })
  kind: (typeof CLUB_CARD_KINDS)[number];

  @ApiProperty({ example: '年度畅练卡' })
  name: string;

  @ApiProperty({ example: 1999, description: '售价（元）' })
  price: number;

  @ApiPropertyOptional({ example: 2599, description: '划线价（元）' })
  originalPrice?: number;

  @ApiProperty({ example: 365, nullable: true, description: '有效天数' })
  validDays: number | null;

  @ApiProperty({
    example: null,
    nullable: true,
    description: '总次数（时长卡为 null）',
  })
  totalTimes: number | null;

  @ApiProperty({ example: '365 天', description: '有效期展示文案' })
  validityText: string;

  @ApiProperty({ example: ['纯利宝 · 望京店'], type: [String] })
  storeNames: string[];
}

/** 可购卡列表响应（前端契约：`{ items }`，不是裸数组） */
export class ClubMemberCardPlanListDto {
  @ApiProperty({ type: [ClubMemberCardPlanDto] })
  items: ClubMemberCardPlanDto[];
}

/** 使用记录响应 */
export class ClubMemberCardUsageRecordDto {
  @ApiProperty({ example: '101' })
  id: string;

  @ApiProperty({
    enum: ['issue', 'consume', 'release', 'adjust', 'expire'],
    example: 'consume',
    description: 'adjust=门店手动调次，expire=到期失效，均与办卡区分展示',
  })
  type: ClubMemberCardUsageTypeValue;

  @ApiProperty({ example: '开台核销 · A 区 3 号台' })
  description: string;

  @ApiProperty({ example: -1, description: '次数变化值' })
  changeTimes: number;

  @ApiProperty({ example: 11, nullable: true })
  remainTimesSnapshot: number | null;

  @ApiProperty({ example: '2026-10-20T12:00:00.000Z' })
  createdAt: string;

  @ApiPropertyOptional({ example: '纯利宝 · 望京店' })
  storeName?: string;
}

/** 持卡响应 */
export class ClubMemberCardDto {
  @ApiProperty({ example: '12' })
  id: string;

  @ApiProperty({ example: 'K20261020120000ABCD1234' })
  cardNo: string;

  @ApiProperty({ example: '3' })
  planId: string;

  @ApiProperty({ example: '年度畅练卡' })
  planName: string;

  @ApiProperty({ enum: CLUB_CARD_KINDS, example: 'yearly' })
  kind: (typeof CLUB_CARD_KINDS)[number];

  @ApiProperty({
    enum: ['active', 'expired', 'usedUp', 'frozen', 'refunded'],
    example: 'active',
  })
  status: ClubMemberCardStatusValue;

  @ApiProperty({ example: '生效中' })
  statusText: string;

  @ApiProperty({ example: '2026-10-20T12:00:00.000Z' })
  startAt: string;

  @ApiProperty({
    example: '2027-10-20T12:00:00.000Z',
    nullable: true,
    description: '到期时间；null 表示不设到期（长期有效）',
  })
  expireAt: string | null;

  @ApiProperty({
    example: 365,
    nullable: true,
    description: '剩余天数（次数卡为 null）',
  })
  remainDays: number | null;

  @ApiProperty({
    example: null,
    nullable: true,
    description: '剩余次数（时长卡为 null）',
  })
  remainTimes: number | null;

  @ApiProperty({ example: null, nullable: true })
  totalTimes: number | null;

  @ApiProperty({ example: ['纯利宝 · 望京店'], type: [String] })
  storeNames: string[];

  @ApiPropertyOptional({
    type: [ClubMemberCardUsageRecordDto],
    description: '仅卡详情返回最近使用记录',
  })
  usageRecords?: ClubMemberCardUsageRecordDto[];
}

/** 我的卡包响应 */
export class ClubMemberCardPageDto {
  @ApiProperty({ type: [ClubMemberCardDto] })
  items: ClubMemberCardDto[];

  @ApiProperty({ example: '20', nullable: true })
  nextCursor: string | null;

  @ApiProperty({ example: 3 })
  total: number;
}

/** 购卡订单响应（对齐 purelyClub CardOrderResult） */
export class ClubMemberCardOrderDto {
  @ApiProperty({
    example: 'MC1760000000000ABCD1234',
    description: '订单标识（与 orderNo 一致）',
  })
  id: string;

  @ApiProperty({ example: 'MC1760000000000ABCD1234' })
  orderNo: string;

  @ApiProperty({ enum: ['card'], example: 'card' })
  orderType: 'card';

  @ApiProperty({ example: '年度畅练卡 · 会员卡购买' })
  title: string;

  @ApiProperty({ example: 1999, description: '应付金额（元）' })
  amount: number;

  @ApiProperty({ example: 'wechat' })
  paymentChannel: string;

  @ApiProperty({
    enum: ['pending', 'paid', 'refunded', 'cancelled', 'expired'],
    example: 'pending',
  })
  status: ClubMemberCardOrderStatusValue;

  @ApiProperty({ example: '2026-10-20T12:00:00.000Z' })
  createdAt: string;

  @ApiProperty({ example: '2026-10-20T12:15:00.000Z' })
  expiresAt: string;

  @ApiProperty({ example: null, nullable: true })
  paidAt: string | null;

  @ApiProperty({ example: '3' })
  planId: string;

  @ApiProperty({
    example: '12',
    nullable: true,
    description: '落账后生成的卡 ID',
  })
  cardId: string | null;

  @ApiPropertyOptional({
    type: ClubWechatPaymentParamsDto,
    description: '微信支付参数；未解析到 openid 或零元卡时不返回',
  })
  paymentParams?: ClubWechatPaymentParamsDto;
}

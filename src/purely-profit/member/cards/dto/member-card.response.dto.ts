// 持卡实例 / 核销流水响应 DTO：金额以「元」出参、时间为毫秒时间戳，
// 与 purelyProfit 前端 memberCardRepository.dto.ts 的字段契约严格对齐
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import {
  MEMBER_CARD_CHANGE_TYPE_VALUES,
  MEMBER_CARD_KIND_VALUES,
  MEMBER_CARD_OPERATOR_TYPE_VALUES,
  MEMBER_CARD_SOURCE_TYPE_VALUES,
  MEMBER_CARD_STATUS_VALUES,
  MEMBER_CARD_TRANSACTION_STATUS_VALUES,
  type MemberCardChangeTypeValue,
  type MemberCardKindValue,
  type MemberCardOperatorTypeValue,
  type MemberCardSourceTypeValue,
  type MemberCardStatusValue,
  type MemberCardTransactionStatusValue,
} from '../member-card.constants';

/**
 * 持卡实例。
 *
 * - `customerName` / `customerPhone` 由持卡记录反查营销顾客得到，
 *   手机号为完整号码（13800000001），前端不再二次处理；
 * - `remainingDays` 为派生字段（按到期时间实时计算），无到期时间时不下发；
 * - 次数：`totalTimes` / `usedTimes` / `remainTimes` 仅次数卡有值，
 *   恒等式 remainTimes + usedTimes + 预扣中次数 = totalTimes。
 */
export class MemberCardDto {
  @ApiProperty({ example: '1', description: '持卡实例 ID' })
  @IsString()
  id: string;

  @ApiProperty({ example: 'MC202611010001', description: '卡号' })
  @IsString()
  cardNo: string;

  @ApiProperty({
    example: 'times',
    enum: MEMBER_CARD_KIND_VALUES,
    description: '卡类型快照',
  })
  @IsIn(MEMBER_CARD_KIND_VALUES)
  kind: MemberCardKindValue;

  @ApiProperty({ example: '10 次卡', description: '卡名称快照' })
  @IsString()
  nameSnapshot: string;

  @ApiProperty({ example: '12', description: '持卡顾客 ID' })
  @IsString()
  customerId: string;

  @ApiPropertyOptional({ example: '张三', description: '持卡顾客姓名' })
  @IsOptional()
  @IsString()
  customerName?: string;

  @ApiPropertyOptional({
    example: '13800000001',
    description: '持卡顾客手机号（完整号码，占位号不下发）',
  })
  @IsOptional()
  @IsString()
  customerPhone?: string;

  @ApiProperty({
    example: 'active',
    enum: MEMBER_CARD_STATUS_VALUES,
    description: '持卡状态',
  })
  @IsIn(MEMBER_CARD_STATUS_VALUES)
  status: MemberCardStatusValue;

  @ApiProperty({
    example: 1715000000000,
    description: '生效时间（毫秒时间戳）',
  })
  @IsInt()
  startsAt: number;

  @ApiPropertyOptional({
    example: 1746534399999,
    description: '到期时间（毫秒时间戳），null 表示不设到期',
  })
  @IsOptional()
  @IsInt()
  expiresAt?: number;

  @ApiPropertyOptional({ example: 10, description: '总次数（仅次数卡）' })
  @IsOptional()
  @IsInt()
  totalTimes?: number;

  @ApiPropertyOptional({
    example: 2,
    description: '已确认使用次数（仅次数卡）',
  })
  @IsOptional()
  @IsInt()
  usedTimes?: number;

  @ApiPropertyOptional({ example: 8, description: '可用剩余次数（仅次数卡）' })
  @IsOptional()
  @IsInt()
  remainTimes?: number;

  @ApiProperty({ example: 299, description: '实付金额（元，赠送卡为 0）' })
  @IsNumber()
  pricePaid: number;

  @ApiProperty({
    example: 'staff_issue',
    enum: MEMBER_CARD_SOURCE_TYPE_VALUES,
    description: '卡来源',
  })
  @IsIn(MEMBER_CARD_SOURCE_TYPE_VALUES)
  sourceType: MemberCardSourceTypeValue;

  @ApiPropertyOptional({
    example: 365,
    description: '剩余天数（按到期时间实时计算，无到期时间时不下发）',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  remainingDays?: number;

  @ApiProperty({
    example: 1715000000000,
    description: '创建时间（毫秒时间戳）',
  })
  @IsInt()
  createdAt: number;
}

/** 核销流水：只读追加记录，`relatedSpaceName` 为台位名称快照 */
export class MemberCardTransactionDto {
  @ApiProperty({ example: '1', description: '流水 ID' })
  @IsString()
  id: string;

  @ApiProperty({ example: '1', description: '所属持卡实例 ID' })
  @IsString()
  cardId: string;

  @ApiProperty({
    example: 'adjust',
    enum: MEMBER_CARD_CHANGE_TYPE_VALUES,
    description: '变更类型',
  })
  @IsIn(MEMBER_CARD_CHANGE_TYPE_VALUES)
  changeType: MemberCardChangeTypeValue;

  @ApiProperty({
    example: 'done',
    enum: MEMBER_CARD_TRANSACTION_STATUS_VALUES,
    description: '流水状态',
  })
  @IsIn(MEMBER_CARD_TRANSACTION_STATUS_VALUES)
  status: MemberCardTransactionStatusValue;

  @ApiProperty({ example: -2, description: '次数变化：正数增加、负数减少' })
  @IsInt()
  deltaTimes: number;

  @ApiPropertyOptional({ example: 10, description: '变更前可用次数' })
  @IsOptional()
  @IsInt()
  beforeTimes?: number;

  @ApiPropertyOptional({ example: 8, description: '变更后可用次数' })
  @IsOptional()
  @IsInt()
  afterTimes?: number;

  @ApiPropertyOptional({ example: '21', description: '关联开台场次 ID' })
  @IsOptional()
  @IsString()
  relatedSessionId?: string;

  @ApiPropertyOptional({ example: 'A05', description: '关联台位名称快照' })
  @IsOptional()
  @IsString()
  relatedSpaceName?: string;

  @ApiPropertyOptional({
    example: 'SO20261101001',
    description: '关联销售单号',
  })
  @IsOptional()
  @IsString()
  relatedSaleOrderNo?: string;

  @ApiProperty({
    example: 'cashier',
    enum: MEMBER_CARD_OPERATOR_TYPE_VALUES,
    description: '操作来源',
  })
  @IsIn(MEMBER_CARD_OPERATOR_TYPE_VALUES)
  operatorType: MemberCardOperatorTypeValue;

  @ApiPropertyOptional({ example: '李四', description: '操作人姓名快照' })
  @IsOptional()
  @IsString()
  operatorName?: string;

  @ApiPropertyOptional({ example: '顾客补差价加 2 次', description: '备注' })
  @IsOptional()
  @IsString()
  remark?: string;

  @ApiProperty({
    example: 1715000000000,
    description: '创建时间（毫秒时间戳）',
  })
  @IsInt()
  createdAt: number;
}

/** 持卡分页列表：分页字段由 buildMarketingPaginationMeta 统一产出 */
export class MemberCardsResponseDto {
  @ApiProperty({ type: () => MemberCardDto })
  @IsArray()
  items: MemberCardDto[];

  @ApiProperty({ example: 3, description: '总数' })
  @IsInt()
  total: number;

  @ApiProperty({ example: 1, description: '当前页码' })
  @IsInt()
  page: number;

  @ApiProperty({ example: 20, description: '每页数量' })
  @IsInt()
  pageSize: number;

  @ApiProperty({ example: 1, description: '总页数，至少为 1' })
  @IsInt()
  totalPages: number;
}

/** 核销流水分页列表 */
export class MemberCardTransactionsResponseDto {
  @ApiProperty({ type: () => MemberCardTransactionDto })
  @IsArray()
  items: MemberCardTransactionDto[];

  @ApiProperty({ example: 3, description: '总数' })
  @IsInt()
  total: number;

  @ApiProperty({ example: 1, description: '当前页码' })
  @IsInt()
  page: number;

  @ApiProperty({ example: 20, description: '每页数量' })
  @IsInt()
  pageSize: number;

  @ApiProperty({ example: 1, description: '总页数，至少为 1' })
  @IsInt()
  totalPages: number;
}

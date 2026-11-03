// 售卡订单响应 DTO：金额以「元」出参、时间为毫秒时间戳、ID 字符串，
// 与 purelyProfit 前端 memberCardRepository.dto.ts 的 MemberCardOrderResponseDTO 严格对齐
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';
import {
  MEMBER_CARD_KIND_VALUES,
  MEMBER_CARD_ORDER_SOURCE_VALUES,
  MEMBER_CARD_ORDER_STATUS_VALUES,
  type MemberCardKindValue,
  type MemberCardOrderSourceValue,
  type MemberCardOrderStatusValue,
} from '../member-card.constants';

/**
 * 售卡订单。
 *
 * - 卡名称 / 卡类型为下单时的快照，模板改名不影响历史单据；
 * - `amount` 为本单实付（元），与 `quantity` 相乘关系不保证（线下折扣 / 赠送）；
 * - `customerPhone` 为完整号码，未留号码时不下发；
 * - `paidAt` 仅已支付单据有值，未支付单据前端回落 `createdAt` 展示。
 */
export class MemberCardOrderDto {
  @ApiProperty({ example: '1', description: '售卡订单 ID' })
  @IsString()
  id: string;

  @ApiProperty({ example: 'MCO202611010001', description: '业务订单号' })
  @IsString()
  orderNo: string;

  @ApiProperty({ example: '年度畅练卡', description: '卡名称快照' })
  @IsString()
  planNameSnapshot: string;

  @ApiProperty({
    example: 'yearly',
    enum: MEMBER_CARD_KIND_VALUES,
    description: '卡类型快照',
  })
  @IsIn(MEMBER_CARD_KIND_VALUES)
  kind: MemberCardKindValue;

  @ApiProperty({ example: 1299, description: '实付金额（元）' })
  @IsNumber()
  amount: number;

  @ApiProperty({ example: 1, description: '购买数量' })
  @IsInt()
  quantity: number;

  @ApiProperty({
    example: 'staff_cash',
    enum: MEMBER_CARD_ORDER_SOURCE_VALUES,
    description: '订单来源渠道',
  })
  @IsIn(MEMBER_CARD_ORDER_SOURCE_VALUES)
  source: MemberCardOrderSourceValue;

  @ApiProperty({
    example: 'paid',
    enum: MEMBER_CARD_ORDER_STATUS_VALUES,
    description: '订单状态',
  })
  @IsIn(MEMBER_CARD_ORDER_STATUS_VALUES)
  status: MemberCardOrderStatusValue;

  @ApiPropertyOptional({ example: '张三', description: '顾客姓名快照' })
  @IsOptional()
  @IsString()
  customerName?: string;

  @ApiPropertyOptional({
    example: '13800000001',
    description: '顾客手机号（完整号码，占位号不下发）',
  })
  @IsOptional()
  @IsString()
  customerPhone?: string;

  @ApiPropertyOptional({ example: '李四', description: '操作员姓名快照' })
  @IsOptional()
  @IsString()
  operatorName?: string;

  @ApiPropertyOptional({
    example: 1715000000000,
    description: '支付完成时间（毫秒时间戳），未支付时不下发',
  })
  @IsOptional()
  @IsInt()
  paidAt?: number;

  @ApiProperty({
    example: 1715000000000,
    description: '创建时间（毫秒时间戳）',
  })
  @IsInt()
  createdAt: number;
}

/** 售卡订单分页列表：分页字段由 buildMarketingPaginationMeta 统一产出 */
export class MemberCardOrdersResponseDto {
  @ApiProperty({ type: () => MemberCardOrderDto })
  @IsArray()
  items: MemberCardOrderDto[];

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

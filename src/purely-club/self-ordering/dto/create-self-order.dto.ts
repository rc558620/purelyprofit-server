import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** 单行购买数量上限：防异常客户端制造超大金额/超长订单 */
export const SELF_ORDER_LINE_QUANTITY_MAX = 999;
/** 单笔订单商品行数上限 */
export const SELF_ORDER_ITEM_LINES_MAX = 100;

/** 购物车单行：只接收商品 ID 与数量，价格与名称一律由服务端重算并落快照 */
export class SelfOrderItemInputDto {
  @ApiProperty({
    description: '商品 ID（弱引用 Product.id，字符串形式）',
    maxLength: 64,
  })
  @IsString({ message: 'productId 必须是字符串' })
  @MaxLength(64, { message: 'productId 不合法' })
  productId: string;

  @ApiProperty({ description: '购买数量', minimum: 1, maximum: 999 })
  @Type(() => Number)
  @IsInt({ message: 'quantity 必须是整数' })
  @Min(1, { message: 'quantity 至少为 1' })
  @Max(SELF_ORDER_LINE_QUANTITY_MAX, {
    message: `单件商品数量不能超过 ${SELF_ORDER_LINE_QUANTITY_MAX}`,
  })
  quantity: number;

  @ApiPropertyOptional({
    type: [Number],
    description:
      '已选规格选项 ID；无规格时不传。服务端据此重算单价并落规格快照',
  })
  @IsOptional()
  @IsArray({ message: 'specOptionIds 必须是数组' })
  @IsInt({ each: true, message: '规格选项 ID 必须是整数' })
  @Type(() => Number)
  specOptionIds?: number[];
}

export class CreateSelfOrderDto {
  @ApiProperty({ description: '空间会话 ID；来自 resolve-space 返回值' })
  @Type(() => Number)
  @IsInt({ message: 'sessionId 必须是整数' })
  @Min(1, { message: 'sessionId 不合法' })
  sessionId: number;

  @ApiProperty({ type: [SelfOrderItemInputDto], description: '已选商品' })
  @ValidateNested({ each: true })
  @Type(() => SelfOrderItemInputDto)
  @ArrayMinSize(1, { message: '请至少选择一件商品' })
  @ArrayMaxSize(SELF_ORDER_ITEM_LINES_MAX, {
    message: `单笔订单商品行数不能超过 ${SELF_ORDER_ITEM_LINES_MAX}`,
  })
  items: SelfOrderItemInputDto[];

  @ApiPropertyOptional({ description: '订单备注', maxLength: 200 })
  @IsOptional()
  @IsString({ message: 'remark 必须是字符串' })
  @MaxLength(200, { message: 'remark 不能超过 200 个字符' })
  remark?: string;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** 自助下单历史默认每页条数（移动端触底加载，20 条一屏足够） */
export const SELF_ORDER_LIST_DEFAULT_LIMIT = 20;
/** 自助下单历史单页上限：沿用改造前 take:50 的量级，不因游标化而放大 */
export const SELF_ORDER_LIST_MAX_LIMIT = 50;

/**
 * 自助下单历史查询（游标分页）。
 *
 * 改造前是 `take: 50` 的硬上限：超过 50 笔就永久看不到更早的订单，
 * 且没有任何「还有更多」的信号。改为 keyset 游标后：
 * - `cursor` 为不透明字符串，原样回传即可；
 * - 是否还有下一页以响应 `hasMore` 为准，不再靠条数猜测。
 */
export class ListSelfOrdersQueryDto {
  @ApiProperty({ example: 12, description: '空间会话 ID（扫码定位后获得）' })
  @Type(() => Number)
  @IsInt({ message: 'sessionId 必须是整数' })
  @Min(1, { message: 'sessionId 不合法' })
  sessionId: number;

  @ApiPropertyOptional({
    example: 'v1:eyJrZXlzIjpbMTc2MTAwMDAwMDAwMF0sImlkIjozNX0',
    description:
      '分页游标（上一页返回的 nextCursor）；不传表示第一页，需原样回传',
  })
  @IsOptional()
  @IsString({ message: 'cursor 必须是字符串' })
  @MaxLength(256, { message: 'cursor 过长' })
  cursor?: string;

  @ApiPropertyOptional({
    example: SELF_ORDER_LIST_DEFAULT_LIMIT,
    default: SELF_ORDER_LIST_DEFAULT_LIMIT,
    description: `每页条数，默认 ${SELF_ORDER_LIST_DEFAULT_LIMIT}，最大 ${SELF_ORDER_LIST_MAX_LIMIT}`,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit 必须是整数' })
  @Min(1, { message: 'limit 最小为 1' })
  @Max(SELF_ORDER_LIST_MAX_LIMIT, {
    message: `limit 最大为 ${SELF_ORDER_LIST_MAX_LIMIT}`,
  })
  limit?: number;
}

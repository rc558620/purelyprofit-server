// 手动增减次数入参：delta 非 0 才是一次真实调整，remark 必填以便对账追溯
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  NotEquals,
} from 'class-validator';
import {
  transformRequiredInt,
  trimString,
} from '../../../marketing/dto/marketing-product-transforms';
import {
  MEMBER_CARD_ADJUST_TIMES_MAX,
  MEMBER_CARD_REMARK_MAX_LENGTH,
} from '../member-card.constants';

/**
 * `delta` 语义：正数增加、负数减少，绝对值不超过单次调整上限。
 * 减少后的剩余次数由 service 用条件更新兜底，禁止扣成负数。
 */
export class AdjustMemberCardTimesDto {
  @ApiProperty({ example: -2, description: '调整次数：正数增加、负数减少' })
  @Transform(transformRequiredInt)
  @IsInt({ message: '调整次数必须是整数' })
  @NotEquals(0, { message: '调整次数不能为 0' })
  @Min(-MEMBER_CARD_ADJUST_TIMES_MAX, {
    message: `单次最多减少 ${MEMBER_CARD_ADJUST_TIMES_MAX} 次`,
  })
  @Max(MEMBER_CARD_ADJUST_TIMES_MAX, {
    message: `单次最多增加 ${MEMBER_CARD_ADJUST_TIMES_MAX} 次`,
  })
  delta: number;

  @ApiProperty({
    example: '顾客补差价加 2 次',
    description: '调整原因（必填，写入流水用于对账）',
  })
  @IsString({ message: '调整原因必须是字符串' })
  @Transform(trimString)
  @MinLength(1, { message: '调整原因不能为空' })
  @MaxLength(MEMBER_CARD_REMARK_MAX_LENGTH, {
    message: `调整原因最长 ${MEMBER_CARD_REMARK_MAX_LENGTH} 个字符`,
  })
  remark: string;

  @ApiPropertyOptional({
    example: 'b2f1c0de-8a4e-4a1e-9f5c-3d2a1b0c9e8f',
    description:
      '调次幂等键（客户端生成）：写成功但响应丢失时，重试必须复用同一个键，服务端按幂等返回',
  })
  @IsOptional()
  @IsString({ message: '幂等键必须是字符串' })
  @Transform(trimString)
  @MaxLength(64, { message: '幂等键最长 64 个字符' })
  requestId?: string;
}

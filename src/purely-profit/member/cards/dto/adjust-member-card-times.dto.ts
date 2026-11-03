// 手动增减次数入参：delta 非 0 才是一次真实调整，remark 必填以便对账追溯
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsInt,
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
}

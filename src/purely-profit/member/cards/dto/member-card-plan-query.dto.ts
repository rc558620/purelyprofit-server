// 卡模板列表查询参数：门店 / 分页口径沿用营销域统一 DTO，避免各端分页字段漂移
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { MarketingPageQueryDto } from '../../../marketing/dto/marketing-pagination-query.dto';
import { transformOptionalBoolean } from '../../../stores/dto/store-response.dto';
import {
  MEMBER_CARD_KIND_VALUES,
  MEMBER_CARD_PLAN_NAME_MAX_LENGTH,
  type MemberCardKindValue,
} from '../member-card-plan.constants';

export class ListMemberCardPlansQueryDto extends MarketingPageQueryDto {
  @ApiPropertyOptional({
    example: 'times',
    enum: MEMBER_CARD_KIND_VALUES,
    description: '卡类型筛选（不传则查全部）',
  })
  @IsOptional()
  @IsIn(MEMBER_CARD_KIND_VALUES, { message: '卡类型不合法' })
  kind?: MemberCardKindValue;

  @ApiPropertyOptional({
    example: true,
    description: '上架状态筛选（不传则查全部）',
  })
  @IsOptional()
  @Transform(transformOptionalBoolean)
  @IsBoolean({ message: '上架状态必须是布尔值' })
  isActive?: boolean;

  @ApiPropertyOptional({
    example: '年卡',
    description: '卡名称关键字（模糊匹配）',
  })
  @IsOptional()
  @IsString({ message: '关键字必须是字符串' })
  @MaxLength(MEMBER_CARD_PLAN_NAME_MAX_LENGTH, {
    message: `关键字最长 ${MEMBER_CARD_PLAN_NAME_MAX_LENGTH} 个字符`,
  })
  keyword?: string;
}

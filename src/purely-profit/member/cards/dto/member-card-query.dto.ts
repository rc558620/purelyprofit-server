// 持卡列表 / 核销流水查询参数：门店与分页口径沿用营销域统一 DTO
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { MarketingPageQueryDto } from '../../../marketing/dto/marketing-pagination-query.dto';
import {
  MEMBER_CARD_KIND_VALUES,
  MEMBER_CARD_KEYWORD_MAX_LENGTH,
  MEMBER_CARD_STATUS_VALUES,
  type MemberCardKindValue,
  type MemberCardStatusValue,
} from '../member-card.constants';

export class ListMemberCardsQueryDto extends MarketingPageQueryDto {
  @ApiPropertyOptional({
    example: 'times',
    enum: MEMBER_CARD_KIND_VALUES,
    description: '卡类型筛选（不传则查全部）',
  })
  @IsOptional()
  @IsIn(MEMBER_CARD_KIND_VALUES, { message: '卡类型不合法' })
  kind?: MemberCardKindValue;

  @ApiPropertyOptional({
    example: 'active',
    enum: MEMBER_CARD_STATUS_VALUES,
    description: '持卡状态筛选（不传则查全部）',
  })
  @IsOptional()
  @IsIn(MEMBER_CARD_STATUS_VALUES, { message: '持卡状态不合法' })
  status?: MemberCardStatusValue;

  @ApiPropertyOptional({
    example: '138',
    description: '关键字：顾客姓名 / 手机号 / 卡号 / 卡名称（模糊匹配）',
  })
  @IsOptional()
  @IsString({ message: '关键字必须是字符串' })
  @MaxLength(MEMBER_CARD_KEYWORD_MAX_LENGTH, {
    message: `关键字最长 ${MEMBER_CARD_KEYWORD_MAX_LENGTH} 个字符`,
  })
  keyword?: string;
}

/** 核销流水只按卡维度分页读取，不支持跨卡聚合，避免越权读到他人流水 */
export class ListMemberCardTransactionsQueryDto extends MarketingPageQueryDto {}

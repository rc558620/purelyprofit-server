// 售卡订单列表查询参数：门店 / 分页沿用营销域统一 DTO，额外支持状态与来源筛选
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { MarketingPageQueryDto } from '../../../marketing/dto/marketing-pagination-query.dto';
import {
  MEMBER_CARD_ORDER_FILTERABLE_SOURCE_VALUES,
  MEMBER_CARD_ORDER_STATUS_VALUES,
  type MemberCardOrderSourceValue,
  type MemberCardOrderStatusValue,
} from '../member-card.constants';

/**
 * 售卡订单列表查询。
 *
 * 只开放前端已实现的筛选维度（状态 / 来源）；顾客、订单号等检索维度
 * 尚未进入前端契约，这里不提前下发参数，避免出现「后端支持但前端不用」的死字段。
 */
export class ListMemberCardOrdersQueryDto extends MarketingPageQueryDto {
  @ApiPropertyOptional({
    example: 'paid',
    enum: MEMBER_CARD_ORDER_STATUS_VALUES,
    description: '订单状态筛选（不传则查全部）',
  })
  @IsOptional()
  @IsIn(MEMBER_CARD_ORDER_STATUS_VALUES, { message: '订单状态不合法' })
  status?: MemberCardOrderStatusValue;

  @ApiPropertyOptional({
    example: 'club_wechat',
    enum: MEMBER_CARD_ORDER_FILTERABLE_SOURCE_VALUES,
    description:
      '订单来源筛选（不传则查全部）；线下办卡已下线，仅支持会员端购卡与门店赠送',
  })
  @IsOptional()
  @IsIn(MEMBER_CARD_ORDER_FILTERABLE_SOURCE_VALUES, {
    message: '订单来源不合法',
  })
  source?: MemberCardOrderSourceValue;
}

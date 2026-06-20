import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ClubMemberAccountDto } from '../../member/dto/club-member-account.dto';
import { ClubProductDto } from '../../products/dto/club-product.dto';
import { ClubPromotionDto } from '../../promotions/dto/club-promotion.dto';
import { ClubStoreSummaryDto } from '../../stores/dto/club-store.dto';

export const CLUB_ACCOUNT_STATUS_VALUES = ['active', 'unavailable'] as const;
export type ClubAccountStatusValue =
  (typeof CLUB_ACCOUNT_STATUS_VALUES)[number];

export class ClubHomeResponseDto {
  @ApiProperty({
    type: ClubStoreSummaryDto,
    description: '当前门店摘要信息',
  })
  currentStore: ClubStoreSummaryDto;

  @ApiPropertyOptional({
    type: ClubMemberAccountDto,
    nullable: true,
    description:
      '当前用户在当前门店的会员账户信息；降级或无会员记录时返回 null',
  })
  account: ClubMemberAccountDto | null;

  @ApiProperty({
    example: 'active',
    enum: CLUB_ACCOUNT_STATUS_VALUES,
    description:
      '会员账户状态：active 表示正常返回，unavailable 表示获取失败或无会员记录',
  })
  accountStatus: ClubAccountStatusValue;

  @ApiProperty({
    type: [ClubPromotionDto],
    description: '首页活动卡片列表',
  })
  promotions: ClubPromotionDto[];

  @ApiProperty({
    type: [ClubProductDto],
    description: '首页精选商品列表',
  })
  featuredProducts: ClubProductDto[];
}

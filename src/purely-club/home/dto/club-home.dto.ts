import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, ValidateNested } from 'class-validator';
import { ClubMemberAccountDto } from '../../member/dto/club-member-account.dto';
import { ClubProductDto } from '../../products/dto/club-product.dto';
import { ClubPromotionDto } from '../../promotions/dto/club-promotion.dto';
import { ClubStoreSummaryDto } from '../../stores/dto/club-store.dto';

export class ClubHomeResponseDto {
  @ApiProperty({
    type: ClubStoreSummaryDto,
    description: '当前门店摘要信息',
  })
  @ValidateNested()
  @Type(() => ClubStoreSummaryDto)
  currentStore: ClubStoreSummaryDto;

  @ApiProperty({
    type: ClubMemberAccountDto,
    description: '当前用户在当前门店的会员账户信息',
  })
  @ValidateNested()
  @Type(() => ClubMemberAccountDto)
  account: ClubMemberAccountDto;

  @ApiProperty({
    type: [ClubPromotionDto],
    description: '首页活动卡片列表',
  })
  @IsArray({ message: '首页活动卡片列表必须是数组' })
  @ValidateNested({ each: true })
  @Type(() => ClubPromotionDto)
  promotions: ClubPromotionDto[];

  @ApiProperty({
    type: [ClubProductDto],
    description: '首页精选商品列表',
  })
  @IsArray({ message: '首页精选商品列表必须是数组' })
  @ValidateNested({ each: true })
  @Type(() => ClubProductDto)
  featuredProducts: ClubProductDto[];
}

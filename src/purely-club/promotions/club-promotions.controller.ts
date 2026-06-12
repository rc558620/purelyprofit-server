import { Controller, Get, UseGuards, UseInterceptors } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ClubJwtAuthGuard } from '../../purely-profit/auth/guards/jwt-auth.guard';
import { ClubCurrentContextInterceptor } from '../stores/club-current-context.interceptor';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import { CurrentClubContext } from '../stores/current-club-context.decorator';
import { ClubPromotionsService } from './club-promotions.service';
import { ClubPromotionsResponseDto } from './dto/club-promotion.dto';

@ApiTags('Club / Promotions')
@ApiBearerAuth()
@UseGuards(ClubJwtAuthGuard)
@UseInterceptors(ClubCurrentContextInterceptor)
@Controller('club/promotions')
export class ClubPromotionsController {
  constructor(private readonly clubPromotionsService: ClubPromotionsService) {}

  @Get()
  @ApiOperation({
    summary: '获取 purely-club 当前门店进行中的优惠活动',
    description:
      '返回当前登录 purely-club 用户当前门店下已上架且进行中的优惠活动列表，供个人端首页展示。',
  })
  @ApiOkResponse({ type: ClubPromotionsResponseDto })
  list(
    @CurrentClubContext() currentContext: ClubCurrentContext,
  ): Promise<ClubPromotionsResponseDto> {
    return this.clubPromotionsService.list(currentContext);
  }
}

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
import { ClubHomeService } from './club-home.service';
import { ClubHomeResponseDto } from './dto/club-home.dto';

@ApiTags('Club / Home')
@ApiBearerAuth()
@UseGuards(ClubJwtAuthGuard)
@UseInterceptors(ClubCurrentContextInterceptor)
@Controller('club/home')
export class ClubHomeController {
  constructor(private readonly clubHomeService: ClubHomeService) {}

  @Get()
  @ApiOperation({
    summary: '获取 purely-club 首页聚合数据',
    description:
      '返回当前登录 purely-club 用户首页所需的当前门店、会员账户、活动卡片与精选商品聚合数据。',
  })
  @ApiOkResponse({ type: ClubHomeResponseDto })
  getHome(
    @CurrentClubContext() currentContext: ClubCurrentContext,
  ): Promise<ClubHomeResponseDto> {
    return this.clubHomeService.getHome(currentContext);
  }
}

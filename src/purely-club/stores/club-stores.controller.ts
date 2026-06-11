import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../purely-profit/auth/current-user.decorator';
import { ClubJwtAuthGuard } from '../../purely-profit/auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { CurrentClubContext } from './current-club-context.decorator';
import { ClubCurrentContextInterceptor } from './club-current-context.interceptor';
import type { ClubCurrentContext } from './club-stores.types';
import {
  ClubStoreSummaryDto,
  ClubStoresResponseDto,
  ClubSwitchCurrentStoreDto,
  ClubSwitchCurrentStoreResponseDto,
} from './dto/club-store.dto';
import { ClubStoresService } from './club-stores.service';

@ApiTags('Club / Stores')
@ApiBearerAuth()
@UseGuards(ClubJwtAuthGuard)
@UseInterceptors(ClubCurrentContextInterceptor)
@Controller('club/stores')
export class ClubStoresController {
  constructor(private readonly clubStoresService: ClubStoresService) {}

  @Get()
  @ApiOperation({
    summary: '获取 purely-club 当前用户可访问门店列表',
    description:
      '仅返回当前登录 purely-club 用户本人可访问的门店列表，并带回当前选中的门店 ID。',
  })
  @ApiOkResponse({ type: ClubStoresResponseDto })
  list(@CurrentUser() user: AuthenticatedUser): Promise<ClubStoresResponseDto> {
    return this.clubStoresService.list(user);
  }

  @Get('current')
  @ApiOperation({
    summary: '获取 purely-club 当前门店',
    description:
      '返回当前登录 purely-club 用户的当前门店；若尚未选择，则自动回落到第一个可访问门店。',
  })
  @ApiOkResponse({ type: ClubStoreSummaryDto })
  getCurrent(
    @CurrentClubContext() currentContext: ClubCurrentContext,
  ): Promise<ClubStoreSummaryDto> {
    return this.clubStoresService.getCurrent(currentContext);
  }

  @Patch('current')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '切换 purely-club 当前门店',
    description:
      '切换当前登录 purely-club 用户的当前门店，仅允许切换到本人可访问的门店。',
  })
  @ApiOkResponse({ type: ClubSwitchCurrentStoreResponseDto })
  switchCurrent(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ClubSwitchCurrentStoreDto,
  ): Promise<ClubSwitchCurrentStoreResponseDto> {
    return this.clubStoresService.switchCurrent(user, dto.storeId);
  }
}

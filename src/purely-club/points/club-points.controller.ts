import {
  Controller,
  Get,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
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
import { ClubPointsService } from './club-points.service';
import {
  ClubPointsRecordsResponseDto,
  ListClubPointsRecordsQueryDto,
} from './dto/club-points-record.dto';

@ApiTags('Club / Points')
@ApiBearerAuth()
@UseGuards(ClubJwtAuthGuard)
@UseInterceptors(ClubCurrentContextInterceptor)
@Controller('club/points')
export class ClubPointsController {
  constructor(private readonly clubPointsService: ClubPointsService) {}

  @Get('records')
  @ApiOperation({
    summary: '获取 purely-club 当前门店积分明细列表',
    description:
      '返回当前登录 purely-club 用户在当前门店的积分获得与消耗明细，支持按类型筛选（all/earn/redeem）。',
  })
  @ApiOkResponse({ type: ClubPointsRecordsResponseDto })
  listRecords(
    @CurrentClubContext() currentContext: ClubCurrentContext,
    @Query() query: ListClubPointsRecordsQueryDto,
  ): Promise<ClubPointsRecordsResponseDto> {
    return this.clubPointsService.listRecords(currentContext, query);
  }
}

import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../purely-profit/auth/current-user.decorator';
import { ClubJwtAuthGuard } from '../../purely-profit/auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { ClubRecordsService } from './club-records.service';
import {
  ClubRecordsResponseDto,
  ListClubRecordsQueryDto,
} from './dto/club-record.dto';

@ApiTags('Club / Records')
@ApiBearerAuth()
@UseGuards(ClubJwtAuthGuard)
@Controller('club/records')
export class ClubRecordsController {
  constructor(private readonly clubRecordsService: ClubRecordsService) {}

  @Get()
  @ApiOperation({
    summary: '获取 purely-club 当前门店统一流水列表',
    description:
      '聚合当前登录 purely-club 用户在当前门店下的充值、赠送、消费、退款流水，返回 records 页面展示所需结构。',
  })
  @ApiOkResponse({ type: ClubRecordsResponseDto })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListClubRecordsQueryDto,
  ): Promise<ClubRecordsResponseDto> {
    return this.clubRecordsService.list(user, query);
  }
}

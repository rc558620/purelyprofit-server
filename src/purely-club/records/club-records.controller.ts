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
import { ClubRecordsService } from './club-records.service';
import {
  ClubRecordsResponseDto,
  ListClubRecordsQueryDto,
} from './dto/club-record.dto';

@ApiTags('Club / Records')
@ApiBearerAuth()
@UseGuards(ClubJwtAuthGuard)
@UseInterceptors(ClubCurrentContextInterceptor)
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
    @CurrentClubContext() currentContext: ClubCurrentContext,
    @Query() query: ListClubRecordsQueryDto,
  ): Promise<ClubRecordsResponseDto> {
    return this.clubRecordsService.list(currentContext, query);
  }
}

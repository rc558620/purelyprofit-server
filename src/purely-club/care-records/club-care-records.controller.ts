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
import { ClubCareRecordsService } from './club-care-records.service';
import {
  ClubCareRecordsResponseDto,
  ListClubCareRecordsQueryDto,
} from './dto/club-care-record.dto';

/**
 * 会员护理档案（C 端只读）。
 *
 * 路由固定为 `/club/care-records`（前端 endpoints.ts 硬编码），禁止改名。
 * 身份由 ClubJwtAuthGuard + ClubCurrentContextInterceptor 注入，
 * service 内部再做顾客档案的两层锚定，杜绝按手机号直接认领。
 */
@ApiTags('Club / CareRecords')
@ApiBearerAuth()
@UseGuards(ClubJwtAuthGuard)
@UseInterceptors(ClubCurrentContextInterceptor)
@Controller('club/care-records')
export class ClubCareRecordsController {
  constructor(
    private readonly clubCareRecordsService: ClubCareRecordsService,
  ) {}

  @Get()
  @ApiOperation({
    summary: '分页获取当前会员在本店的护理档案',
    description:
      '只读返回会员本人的护理记录（项目、金额、说明、照片、护理师），真分页：第 1 页即最近一次，翻页向更早回溯；第 1 页额外返回效果对比的首尾记录（最早 / 最近一次有照片的护理）。不含任何商家内部字段。',
  })
  @ApiOkResponse({ type: ClubCareRecordsResponseDto })
  list(
    @CurrentClubContext() currentContext: ClubCurrentContext,
    @Query() query: ListClubCareRecordsQueryDto,
  ): Promise<ClubCareRecordsResponseDto> {
    return this.clubCareRecordsService.list(currentContext, query);
  }
}

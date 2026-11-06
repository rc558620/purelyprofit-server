import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';
import { ClubJwtAuthGuard } from '../../purely-profit/auth/guards/jwt-auth.guard';
import { ClubCurrentContextInterceptor } from '../stores/club-current-context.interceptor';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import { CurrentClubContext } from '../stores/current-club-context.decorator';
import { ClubCheckInService } from './club-check-in.service';
import {
  CheckInResultDto,
  CheckInStatusResponseDto,
} from './dto/club-check-in.dto';

@ApiTags('Club / Check-in')
@ApiBearerAuth()
@UseGuards(ClubJwtAuthGuard)
@UseInterceptors(ClubCurrentContextInterceptor)
@Controller('club/check-in')
export class ClubCheckInController {
  constructor(private readonly clubCheckInService: ClubCheckInService) {}

  @Get('status')
  @ApiOperation({
    summary: '获取 purely-club 当前门店每日签到状态',
    description:
      '按后端上海时区自然日返回活动状态、近期签到日期、连续天数与积分余额；活动不可用时返回 activityEnabled=false 的合法空态。',
  })
  @ApiOkResponse({ type: CheckInStatusResponseDto })
  getStatus(
    @CurrentClubContext() currentContext: ClubCurrentContext,
  ): Promise<CheckInStatusResponseDto> {
    return this.clubCheckInService.getStatus(currentContext);
  }

  @Post()
  // 幂等提交返回 200（而非 Nest 默认 201），与 @ApiOkResponse 和前端成功口径一致
  @HttpCode(HttpStatus.OK)
  // 积分发放是写操作：收紧到 60 秒 10 次（ttl 单位毫秒）
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @ApiOperation({
    summary: '提交 purely-club 每日签到',
    description:
      '空 body 提交；门店、用户、发放积分全部由服务端上下文与商家活动配置权威派生，不接受任何业务入参。',
  })
  @ApiOkResponse({ type: CheckInResultDto })
  submit(
    @CurrentClubContext() currentContext: ClubCurrentContext,
    @Req() request: FastifyRequest,
  ): Promise<CheckInResultDto> {
    // 仅取链路级 requestId 用于结构化日志，不读取任何业务参数
    return this.clubCheckInService.submit(
      currentContext,
      String(request.id ?? 'unknown'),
    );
  }
}

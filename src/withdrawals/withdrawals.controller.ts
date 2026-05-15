import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RequirePermissions } from '../access-control/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../access-control/guards/permissions.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import {
  ApplyWithdrawalDto,
  ListWithdrawalsQueryDto,
} from './dto/apply-withdrawal.dto';
import { RejectWithdrawalDto } from './dto/review-withdrawal.dto';
import {
  ApplyWithdrawalResponseDto,
  ReviewWithdrawalResponseDto,
  WithdrawalOverviewResponseDto,
  WithdrawalRecordResponseDto,
} from './dto/withdrawal-response.dto';
import { WithdrawalsService } from './withdrawals.service';

@ApiTags('Withdrawals')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('withdrawals')
export class WithdrawalsController {
  constructor(private readonly withdrawalsService: WithdrawalsService) {}

  @Get('overview')
  @RequirePermissions('partner:view')
  @ApiOperation({ summary: '获取提现页汇总信息' })
  @ApiOkResponse({
    description: '返回提现页汇总信息，包含可用余额、累计提现和处理中数量',
    type: WithdrawalOverviewResponseDto,
  })
  getOverview(
    @Req() request: { user: AuthenticatedUser },
  ): Promise<WithdrawalOverviewResponseDto> {
    return this.withdrawalsService.getOverview(request.user);
  }

  @Get()
  @RequirePermissions('partner:view')
  @ApiOperation({ summary: '获取提现记录列表' })
  @ApiOkResponse({
    description: '返回提现记录列表，默认按申请时间倒序',
    type: [WithdrawalRecordResponseDto],
  })
  list(
    @Req() request: { user: AuthenticatedUser },
    @Query() query: ListWithdrawalsQueryDto,
  ): Promise<WithdrawalRecordResponseDto[]> {
    return this.withdrawalsService.list(request.user, query);
  }

  @Post('apply')
  @RequirePermissions('partner:withdraw')
  @ApiOperation({ summary: '提交提现申请' })
  @ApiCreatedResponse({
    description: '提现申请提交成功并返回最新记录与汇总数据',
    type: ApplyWithdrawalResponseDto,
  })
  apply(
    @Req() request: { user: AuthenticatedUser },
    @Body() dto: ApplyWithdrawalDto,
  ): Promise<ApplyWithdrawalResponseDto> {
    return this.withdrawalsService.apply(request.user, dto);
  }

  @Patch(':id/approve')
  @RequirePermissions('partner:review')
  @ApiOperation({ summary: '审核通过提现申请' })
  @ApiOkResponse({
    description: '审核通过后返回最新提现记录与汇总数据',
    type: ReviewWithdrawalResponseDto,
  })
  approve(
    @Req() request: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) withdrawalId: number,
  ): Promise<ReviewWithdrawalResponseDto> {
    return this.withdrawalsService.approve(request.user, withdrawalId);
  }

  @Patch(':id/reject')
  @RequirePermissions('partner:review')
  @ApiOperation({ summary: '拒绝提现申请并退回纯利豆' })
  @ApiOkResponse({
    description: '拒绝后返回最新提现记录与汇总数据',
    type: ReviewWithdrawalResponseDto,
  })
  reject(
    @Req() request: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) withdrawalId: number,
    @Body() dto: RejectWithdrawalDto,
  ): Promise<ReviewWithdrawalResponseDto> {
    return this.withdrawalsService.reject(request.user, withdrawalId, dto);
  }

  @Patch(':id/pay')
  @RequirePermissions('partner:review')
  @ApiOperation({ summary: '确认提现已打款' })
  @ApiOkResponse({
    description: '确认打款后返回最新提现记录与汇总数据',
    type: ReviewWithdrawalResponseDto,
  })
  pay(
    @Req() request: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) withdrawalId: number,
  ): Promise<ReviewWithdrawalResponseDto> {
    return this.withdrawalsService.pay(request.user, withdrawalId);
  }
}

import { CurrentUser } from '../../auth/current-user.decorator';
import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { BlockSubAccount } from '../../access-control/decorators/block-sub-account.decorator';
import { RequirePermissions } from '../../access-control/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../access-control/guards/permissions.guard';
import { SubAccountBlockGuard } from '../../access-control/guards/sub-account-block.guard';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import {
  ApplyWithdrawalDto,
  ListWithdrawalsQueryDto,
  PreviewWithdrawalDto,
} from './dto/apply-withdrawal.dto';
import { RejectWithdrawalDto } from './dto/review-withdrawal.dto';
import {
  ApplyWithdrawalResponseDto,
  PreviewWithdrawalResponseDto,
  ReviewWithdrawalResponseDto,
  WithdrawalOverviewResponseDto,
  WithdrawalRecordResponseDto,
} from './dto/withdrawal-response.dto';
import { WithdrawalsService } from './withdrawals.service';

@ApiTags('Withdrawals')
@ApiBearerAuth()
@BlockSubAccount('子账号无权操作提现')
@UseGuards(JwtAuthGuard, PermissionsGuard, SubAccountBlockGuard)
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
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<WithdrawalOverviewResponseDto> {
    return this.withdrawalsService.getOverview(user);
  }

  @Get()
  @RequirePermissions('partner:view')
  @ApiOperation({ summary: '获取提现记录列表' })
  @ApiOkResponse({
    description: '返回提现记录列表，默认按申请时间倒序',
    type: [WithdrawalRecordResponseDto],
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListWithdrawalsQueryDto,
  ): Promise<WithdrawalRecordResponseDto[]> {
    return this.withdrawalsService.list(user, query);
  }

  @Post('preview')
  @RequirePermissions('partner:withdraw')
  @ApiOperation({ summary: '预览提现金额（后端权威计算）' })
  @ApiOkResponse({
    description: '返回后端权威计算的提现金额预览，前端仅做展示',
    type: PreviewWithdrawalResponseDto,
  })
  preview(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: PreviewWithdrawalDto,
  ): Promise<PreviewWithdrawalResponseDto> {
    return this.withdrawalsService.preview(
      user,
      dto.beanAmount,
    ) as Promise<PreviewWithdrawalResponseDto>;
  }

  @Post('apply')
  @RequirePermissions('partner:withdraw')
  @ApiOperation({ summary: '提交提现申请' })
  @ApiCreatedResponse({
    description: '提现申请提交成功并返回最新记录与汇总数据',
    type: ApplyWithdrawalResponseDto,
  })
  apply(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ApplyWithdrawalDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<ApplyWithdrawalResponseDto> {
    return this.withdrawalsService.apply(user, dto, idempotencyKey);
  }

  @Patch(':id/approve')
  @RequirePermissions('partner:review')
  @ApiOperation({ summary: '审核通过提现申请' })
  @ApiOkResponse({
    description: '审核通过后返回最新提现记录与汇总数据',
    type: ReviewWithdrawalResponseDto,
  })
  approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) withdrawalId: number,
  ): Promise<ReviewWithdrawalResponseDto> {
    return this.withdrawalsService.approve(user, withdrawalId);
  }

  @Patch(':id/reject')
  @RequirePermissions('partner:review')
  @ApiOperation({ summary: '拒绝提现申请并退回纯利豆' })
  @ApiOkResponse({
    description: '拒绝后返回最新提现记录与汇总数据',
    type: ReviewWithdrawalResponseDto,
  })
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) withdrawalId: number,
    @Body() dto: RejectWithdrawalDto,
  ): Promise<ReviewWithdrawalResponseDto> {
    return this.withdrawalsService.reject(user, withdrawalId, dto);
  }

  @Patch(':id/pay')
  @RequirePermissions('partner:review')
  @ApiOperation({ summary: '确认提现已打款' })
  @ApiOkResponse({
    description: '确认打款后返回最新提现记录与汇总数据',
    type: ReviewWithdrawalResponseDto,
  })
  pay(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) withdrawalId: number,
  ): Promise<ReviewWithdrawalResponseDto> {
    return this.withdrawalsService.pay(user, withdrawalId);
  }
}

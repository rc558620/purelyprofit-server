import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../purely-profit/auth/current-user.decorator';
import { JwtAuthGuard } from '../../purely-profit/auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import type { ApplyWithdrawalResponseDto } from '../../purely-profit/member/withdrawals/dto/withdrawal-response.dto';
import {
  PulseApplyWithdrawalDto,
  UpdatePulseWithdrawalAccountDto,
} from './dto/pulse-growth-withdrawals.dto';
import { PulseWithdrawalAccountResponseDto } from './dto/pulse-growth-earnings.dto';
import { PulseGrowthService } from './growth.service';

@ApiTags('Pulse - Growth')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('pulse/growth/withdrawals')
export class PulseGrowthWithdrawalsController {
  constructor(private readonly growthService: PulseGrowthService) {}

  @Get('account')
  @ApiOperation({ summary: '获取目标商家提现账户的兼容接口' })
  @ApiOkResponse({
    description: '当前仍返回目标商家提现账户的兼容数据',
    type: PulseWithdrawalAccountResponseDto,
  })
  getAccount(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PulseWithdrawalAccountResponseDto> {
    return this.growthService.getWithdrawalAccount(user);
  }

  @Patch('account')
  @ApiOperation({ summary: '更新目标商家提现账户的兼容接口' })
  @ApiOkResponse({
    description: '更新成功，返回最新账户信息',
    type: PulseWithdrawalAccountResponseDto,
  })
  updateAccount(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdatePulseWithdrawalAccountDto,
  ): Promise<PulseWithdrawalAccountResponseDto> {
    return this.growthService.updateWithdrawalAccount(user, dto);
  }

  @Post('apply')
  @ApiOperation({ summary: '目标商家申请提现的兼容接口' })
  @ApiCreatedResponse({
    description: '兼容路由：当前默认拒绝代目标商家发起提现申请',
  })
  apply(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: PulseApplyWithdrawalDto,
  ): Promise<ApplyWithdrawalResponseDto> {
    return this.growthService.applyWithdrawal(
      user,
      dto.beanAmount,
      dto.partnerId,
    );
  }
}

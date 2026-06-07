import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../purely-profit/auth/current-user.decorator';
import { JwtAuthGuard } from '../../purely-profit/auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { OnboardingStatusResponseDto } from './dto/onboarding-status.dto';
import { OnboardingService } from './onboarding.service';

@ApiTags('Pulse / Onboarding')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('pulse/onboarding')
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  /**
   * 查询当前观察对象的基础状态。
   *
   * Step 1 先统一语义：该接口默认按“开发者查看目标商家”理解，当前仍沿用旧字段结构，
   * 用于表达是否已选择目标商家门店，以及该目标商家是否具备基础接入条件。
   */
  @Get('status')
  @ApiOperation({
    summary: '获取目标商家基础状态',
    description:
      '默认按开发者查看目标商家的语义返回状态。当前同时返回新的 targetStatus 字段与旧的 onboarding 兼容字段，' +
      '用于表达目标商家门店是否已选定、主体资料是否完整、以及平台订阅是否生效。isCompleted 与 steps.* 当前仍作为兼容字段（deprecated）保留。',
  })
  @ApiOkResponse({
    description: '返回目标商家基础状态的兼容结构',
    type: OnboardingStatusResponseDto,
  })
  getStatus(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<OnboardingStatusResponseDto> {
    return this.onboardingService.getStatus(user);
  }
}

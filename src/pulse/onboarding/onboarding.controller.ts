import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { OnboardingStatusResponseDto } from './dto/onboarding-status.dto';
import { OnboardingService } from './onboarding.service';

@ApiTags('Pulse / Onboarding')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('pulse/onboarding')
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  /**
   * 查询当前老板的入驻完成状态。
   *
   * 前端在注册/登录后、进入首页前调用，判断是否需要引导用户完成
   * 实名认证 → 创建门店 → 开通会员等步骤。
   */
  @Get('status')
  @ApiOperation({
    summary: '获取入驻完成状态',
    description:
      '返回各入驻步骤的完成情况：是否实名认证、是否创建门店、是否已开通平台会员。' +
      'isCompleted 为 true 表示全部步骤完成。',
  })
  @ApiOkResponse({
    description: '返回入驻步骤完成状态',
    type: OnboardingStatusResponseDto,
  })
  getStatus(
    @Req() request: { user: AuthenticatedUser },
  ): Promise<OnboardingStatusResponseDto> {
    return this.onboardingService.getStatus(request.user);
  }
}

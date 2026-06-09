import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../purely-profit/auth/current-user.decorator';
import { PulseJwtAuthGuard } from '../../purely-profit/auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { ApplyPlatformPartnerDto } from '../../purely-profit/member/platform-membership/dto/platform-membership-query.dto';
import type {
  PlatformMembershipPartnerProfileResponseDto,
  PlatformMembershipPromoCenterResponseDto,
} from '../../purely-profit/member/platform-membership/dto/platform-membership-response.dto';
import { PulseGrowthService } from './growth.service';

@ApiTags('Pulse - Growth')
@ApiBearerAuth()
@UseGuards(PulseJwtAuthGuard)
@Controller('pulse/growth')
export class PulseGrowthController {
  constructor(private readonly growthService: PulseGrowthService) {}

  @Get('promo')
  @ApiOperation({ summary: '获取目标商家推广中心兼容数据' })
  @ApiOkResponse({ description: '当前仍返回目标商家推广中心的兼容数据' })
  getPromoCenter(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PlatformMembershipPromoCenterResponseDto> {
    return this.growthService.getPromoCenter(user);
  }

  @Get('partner/profile')
  @ApiOperation({ summary: '获取目标商家合伙人档案的兼容接口' })
  @ApiOkResponse({ description: '当前仍返回目标商家合伙人档案的兼容数据' })
  getPartnerProfile(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PlatformMembershipPartnerProfileResponseDto> {
    return this.growthService.getPartnerProfile(user);
  }

  @Post('partner/apply')
  @ApiOperation({ summary: '目标商家申请合伙人的兼容接口' })
  @ApiCreatedResponse({
    description: '兼容路由：当前默认拒绝代目标商家提交合伙人申请',
  })
  applyPartner(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ApplyPlatformPartnerDto,
  ): Promise<PlatformMembershipPartnerProfileResponseDto> {
    return this.growthService.applyPartner(user, dto);
  }

  @Patch('partner/applications/:id/cancel')
  @ApiOperation({ summary: '撤销目标商家合伙人申请的兼容接口' })
  @ApiOkResponse({ description: '撤销成功，返回最新合伙人档案' })
  cancelPartnerApplication(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) applicationId: number,
  ): Promise<PlatformMembershipPartnerProfileResponseDto> {
    return this.growthService.cancelPartnerApplication(user, applicationId);
  }
}

import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
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
import { JwtAuthGuard } from '../../purely-profit/auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { ApplyPlatformPartnerDto } from '../../purely-profit/member/platform-membership/dto/platform-membership-query.dto';
import type {
  PlatformMembershipPartnerProfileResponseDto,
  PlatformMembershipPromoCenterResponseDto,
} from '../../purely-profit/member/platform-membership/dto/platform-membership-response.dto';
import { PulseGrowthService } from './growth.service';

@ApiTags('Pulse - Growth')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('pulse/growth')
export class PulseGrowthController {
  constructor(private readonly growthService: PulseGrowthService) {}

  @Get('promo')
  @ApiOperation({ summary: '获取目标商家推广中心兼容数据' })
  @ApiOkResponse({ description: '当前仍返回目标商家推广中心的兼容数据' })
  getPromoCenter(
    @Req() request: { user: AuthenticatedUser },
  ): Promise<PlatformMembershipPromoCenterResponseDto> {
    return this.growthService.getPromoCenter(request.user);
  }

  @Get('partner/profile')
  @ApiOperation({ summary: '获取目标商家合伙人档案的兼容接口' })
  @ApiOkResponse({ description: '当前仍返回目标商家合伙人档案的兼容数据' })
  getPartnerProfile(
    @Req() request: { user: AuthenticatedUser },
  ): Promise<PlatformMembershipPartnerProfileResponseDto> {
    return this.growthService.getPartnerProfile(request.user);
  }

  @Post('partner/apply')
  @ApiOperation({ summary: '目标商家申请合伙人的兼容接口' })
  @ApiCreatedResponse({
    description: '兼容路由：当前默认拒绝代目标商家提交合伙人申请',
  })
  applyPartner(
    @Req() request: { user: AuthenticatedUser },
    @Body() dto: ApplyPlatformPartnerDto,
  ): Promise<PlatformMembershipPartnerProfileResponseDto> {
    return this.growthService.applyPartner(request.user, dto);
  }

  @Patch('partner/applications/:id/cancel')
  @ApiOperation({ summary: '撤销目标商家合伙人申请的兼容接口' })
  @ApiOkResponse({ description: '撤销成功，返回最新合伙人档案' })
  cancelPartnerApplication(
    @Req() request: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) applicationId: number,
  ): Promise<PlatformMembershipPartnerProfileResponseDto> {
    return this.growthService.cancelPartnerApplication(
      request.user,
      applicationId,
    );
  }
}

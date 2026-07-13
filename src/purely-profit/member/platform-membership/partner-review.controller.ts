import { CurrentUser } from '../../auth/current-user.decorator';
import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeController } from '@nestjs/swagger';
import { BlockSubAccount } from '../../access-control/decorators/block-sub-account.decorator';
import { RequirePermissions } from '../../access-control/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../access-control/guards/permissions.guard';
import { SubAccountBlockGuard } from '../../access-control/guards/sub-account-block.guard';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import type { PlatformMembershipPartnerProfileResponseDto } from './dto/platform-membership-response.dto';
import type { RejectPlatformPartnerApplicationDto } from './dto/platform-membership-query.dto';
import {
  buildPartnerReviewResponse,
  type PartnerReviewCompatResponse,
} from './platform-membership-partner-review.compat';
import { PlatformMembershipService } from './platform-membership.service';

@ApiExcludeController()
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, SubAccountBlockGuard)
@BlockSubAccount('子账号无权访问平台会员中心')
@Controller('partner-review')
export class PartnerReviewController {
  constructor(
    private readonly platformMembershipService: PlatformMembershipService,
  ) {}

  @Get()
  @RequirePermissions('partner:review')
  async list(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PartnerReviewCompatResponse> {
    const profile =
      await this.platformMembershipService.getPartnerProfile(user);
    return buildPartnerReviewResponse(profile);
  }

  @Post(':id/approve')
  @RequirePermissions('partner:review')
  approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) applicationId: number,
  ): Promise<PlatformMembershipPartnerProfileResponseDto> {
    return this.platformMembershipService.approvePartnerApplication(
      user,
      applicationId,
    );
  }

  @Post(':id/reject')
  @RequirePermissions('partner:review')
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) applicationId: number,
    @Body() dto: RejectPlatformPartnerApplicationDto,
  ): Promise<PlatformMembershipPartnerProfileResponseDto> {
    return this.platformMembershipService.rejectPartnerApplication(
      user,
      applicationId,
      dto,
    );
  }
}

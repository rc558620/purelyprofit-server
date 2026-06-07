import { CurrentUser } from '../../auth/current-user.decorator';
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeController } from '@nestjs/swagger';
import { BlockSubAccount } from '../../access-control/decorators/block-sub-account.decorator';
import { RequirePermissions } from '../../access-control/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../access-control/guards/permissions.guard';
import { SubAccountBlockGuard } from '../../access-control/guards/sub-account-block.guard';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { PlatformMembershipService } from './platform-membership.service';
import type { PromotionDetailCompatResponse } from './platform-membership.types';

@ApiExcludeController()
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, SubAccountBlockGuard)
@BlockSubAccount('子账号无权访问平台会员中心')
@Controller('promotion-detail')
export class PromotionDetailCompatController {
  constructor(
    private readonly platformMembershipService: PlatformMembershipService,
  ) {}

  @Get()
  @RequirePermissions('members:view')
  getDetail(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: Record<string, unknown>,
  ): Promise<PromotionDetailCompatResponse> {
    return this.platformMembershipService.getPromotionDetailCompat(user, query);
  }
}

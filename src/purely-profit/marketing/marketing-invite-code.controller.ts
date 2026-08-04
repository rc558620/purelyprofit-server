import {
  Controller,
  Get,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  AllowLegacyOwnerAccess,
  RequirePermissions,
} from '../access-control/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../access-control/guards/permissions.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { MarketingInviteCodeDto } from './dto/marketing-invite-code.dto';
import { MarketingInviteCodeService } from './marketing-invite-code.service';

@ApiTags('营销中心')
@ApiBearerAuth()
@AllowLegacyOwnerAccess()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('marketing')
export class MarketingInviteCodeController {
  constructor(
    private readonly marketingInviteCodeService: MarketingInviteCodeService,
  ) {}

  @Get('invite-code')
  @RequirePermissions('marketing:view')
  @ApiOperation({ summary: '查询门店邀请码二维码' })
  @ApiOkResponse({ type: MarketingInviteCodeDto })
  getInviteCode(
    @CurrentUser() user: AuthenticatedUser,
    @Query('storeId', new ParseIntPipe({ optional: true })) storeId?: number,
  ): Promise<MarketingInviteCodeDto> {
    return this.marketingInviteCodeService.getInviteCode(user, storeId);
  }

  @Post('invite-code/rotate')
  @RequirePermissions('marketing:manage')
  @ApiOperation({
    summary: '轮换门店邀请码（旧码立即失效，返回新码及二维码图）',
  })
  @ApiOkResponse({ type: MarketingInviteCodeDto })
  rotateInviteCode(
    @CurrentUser() user: AuthenticatedUser,
    @Query('storeId', new ParseIntPipe({ optional: true })) storeId?: number,
  ): Promise<MarketingInviteCodeDto> {
    return this.marketingInviteCodeService.rotateInviteCode(user, storeId);
  }

  @Post('invite-code/deactivate')
  @RequirePermissions('marketing:manage')
  @ApiOperation({ summary: '停用门店邀请码（二维码不再可扫码入店）' })
  @ApiOkResponse({ type: MarketingInviteCodeDto })
  deactivateInviteCode(
    @CurrentUser() user: AuthenticatedUser,
    @Query('storeId', new ParseIntPipe({ optional: true })) storeId?: number,
  ): Promise<MarketingInviteCodeDto> {
    return this.marketingInviteCodeService.deactivateInviteCode(user, storeId);
  }
}

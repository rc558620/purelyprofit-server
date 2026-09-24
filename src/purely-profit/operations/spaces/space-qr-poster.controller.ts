// 空间二维码海报配置控制器，独立静态路由避免与空间 ID 参数路由耦合。
import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../access-control/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../access-control/guards/permissions.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { RequireBusinessMode } from '../../stores/business-mode.decorator';
import { BusinessModeGuard } from '../../stores/business-mode.guard';
import type { TableQrPosterConfig } from '../../stores/qr-poster-config.utils';
import { UpdateSpaceQrPosterDto } from './dto/space-qr-poster.dto';
import { SpaceQrPosterService } from './space-qr-poster.service';

/** general 业态的空间二维码海报配置接口。 */
@ApiTags('PurelyProfit Spaces - QrPoster')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, BusinessModeGuard)
@RequireBusinessMode('general')
@Controller('spaces/qr-poster')
export class SpaceQrPosterController {
  constructor(private readonly spaceQrPosterService: SpaceQrPosterService) {}

  /** 获取当前门店空间二维码海报配置。 */
  @Get()
  @RequirePermissions('space:view')
  @ApiOperation({ summary: '获取空间二维码海报配置' })
  getConfig(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<TableQrPosterConfig> {
    return this.spaceQrPosterService.getForMerchant(user);
  }

  /** 增量更新当前门店空间二维码海报配置。 */
  @Patch()
  @RequirePermissions('space:update')
  @ApiOperation({ summary: '更新空间二维码海报配置（支持部分更新）' })
  updateConfig(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateSpaceQrPosterDto,
  ): Promise<TableQrPosterConfig> {
    return this.spaceQrPosterService.updateForMerchant(user, dto);
  }
}

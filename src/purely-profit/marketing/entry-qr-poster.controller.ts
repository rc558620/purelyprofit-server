// 进店二维码海报配置控制器，独立静态路由避免与营销业务 ID 参数路由耦合。
import {
  Body,
  Controller,
  Get,
  ParseIntPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AllowLegacyOwnerAccess,
  RequirePermissions,
} from '../access-control/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../access-control/guards/permissions.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import type { TableQrPosterConfig } from '../stores/qr-poster-config.utils';
import { UpdateEntryQrPosterDto } from './dto/entry-qr-poster.dto';
import { EntryQrPosterService } from './entry-qr-poster.service';

/**
 * 营销中心进店二维码海报配置接口。
 *
 * 营销能力跨业态开放，因此不挂 BusinessModeGuard，与营销域其它接口保持一致。
 */
@ApiTags('营销中心')
@ApiBearerAuth()
@AllowLegacyOwnerAccess()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('marketing/qr-poster')
export class EntryQrPosterController {
  constructor(private readonly entryQrPosterService: EntryQrPosterService) {}

  /** 获取当前门店进店二维码海报配置。 */
  @Get()
  @RequirePermissions('marketing:view')
  @ApiOperation({ summary: '获取进店二维码海报配置' })
  getConfig(
    @CurrentUser() user: AuthenticatedUser,
    @Query('storeId', new ParseIntPipe({ optional: true })) storeId?: number,
  ): Promise<TableQrPosterConfig> {
    return this.entryQrPosterService.getForMerchant(user, storeId);
  }

  /** 增量更新当前门店进店二维码海报配置。 */
  @Patch()
  @RequirePermissions('marketing:manage')
  @ApiOperation({ summary: '更新进店二维码海报配置（支持部分更新）' })
  updateConfig(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateEntryQrPosterDto,
    @Query('storeId', new ParseIntPipe({ optional: true })) storeId?: number,
  ): Promise<TableQrPosterConfig> {
    return this.entryQrPosterService.updateForMerchant(user, storeId, dto);
  }
}

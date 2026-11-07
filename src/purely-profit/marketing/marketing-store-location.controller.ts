// 营销中心「设置门店坐标」读写接口：独立于 StoresController 的专用通道。
//
// 为什么不复用 /stores/current：
// - 写（PATCH）挂 store:update 且 StoresController 类级 @BlockSubAccount()，而 UpdateStoreDto
//   同时收门店名称 / 类型 / Logo / 服务人员称呼 / 省市区，直接对子账号放开会让店长连带获得
//   门店设置写权限；
// - 读（GET）同理挂 store:view，子账号一律 403，坐标页首屏拿不到门店数据。
// 这里只收坐标与选点地址，读放开到 marketing:view，权限整体收敛在营销域。
import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
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
import { StoreResponseDto } from '../stores/dto/store-response.dto';
import { StoresService } from '../stores/stores.service';
import { UpdateMarketingStoreLocationDto } from './dto/marketing-store-location.dto';

@ApiTags('营销中心')
@ApiBearerAuth()
@AllowLegacyOwnerAccess()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('marketing')
export class MarketingStoreLocationController {
  constructor(private readonly storesService: StoresService) {}

  /**
   * 读取当前门店信息（坐标设置页首屏）。
   *
   * 门店归属由 StoresService 按当前 membership 解析，不接受 storeId 入参，
   * 因此不存在跨店读取；返回结构与 GET /stores/current 一致，前端复用同一套映射。
   */
  @Get('store-location')
  @RequirePermissions('marketing:view')
  @ApiOperation({ summary: '获取当前门店信息（营销中心坐标设置页）' })
  @ApiOkResponse({ type: StoreResponseDto })
  getStoreLocation(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<StoreResponseDto> {
    return this.storesService.getCurrent(user);
  }

  /**
   * 保存当前门店坐标。
   *
   * 只写坐标与地址，门店名称 / 类型 / Logo 等仍归门店设置（主账号专属）；
   * 返回结构与 GET /stores/current 一致，便于前端复用同一套门店缓存映射。
   */
  @Patch('store-location')
  @RequirePermissions('marketing:manage')
  @ApiOperation({ summary: '保存门店坐标（营销中心坐标设置页）' })
  @ApiOkResponse({ type: StoreResponseDto })
  updateStoreLocation(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateMarketingStoreLocationDto,
  ): Promise<StoreResponseDto> {
    return this.storesService.updateCurrent(user, {
      latitude: dto.latitude,
      longitude: dto.longitude,
      ...(dto.address !== undefined ? { address: dto.address } : {}),
    });
  }
}

import { CurrentUser } from '../auth/current-user.decorator';
import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Put,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  AllowSubAccount,
  BlockSubAccount,
} from '../access-control/decorators/block-sub-account.decorator';
import { RequirePermissions } from '../access-control/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../access-control/guards/permissions.guard';
import { SubAccountBlockGuard } from '../access-control/guards/sub-account-block.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { CreateStoreDto } from './dto/create-store.dto';
import { UpdateStoreDto } from './dto/update-store.dto';
import { StoreResponseDto } from './dto/store-response.dto';
import {
  UpdateWechatPayConfigDto,
  WechatPayConfigResponseDto,
} from './dto/wechat-pay-config.dto';
import {
  STORE_LOGO_CACHE_MAX_AGE_SECONDS,
  StoreLogoProxyService,
} from './store-logo-proxy.service';
import { StoresService } from './stores.service';
import { StoresWechatPayService } from './stores-wechat-pay.service';

@ApiTags('Stores')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, SubAccountBlockGuard)
@BlockSubAccount()
@Controller('stores')
export class StoresController {
  constructor(
    private readonly storesService: StoresService,
    private readonly storesWechatPayService: StoresWechatPayService,
    private readonly storeLogoProxyService: StoreLogoProxyService,
  ) {}

  @Post()
  @RequirePermissions('store:update')
  @ApiOperation({ summary: '创建门店' })
  @ApiCreatedResponse({
    description: '创建成功并返回前端对齐后的门店信息',
    type: StoreResponseDto,
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateStoreDto,
  ): Promise<StoreResponseDto> {
    return this.storesService.create(user, dto);
  }

  @Get('current')
  @RequirePermissions('store:view')
  @ApiOperation({ summary: '获取当前账号门店' })
  @ApiOkResponse({
    description: '返回当前账号唯一绑定的门店信息',
    type: StoreResponseDto,
  })
  getCurrent(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<StoreResponseDto> {
    return this.storesService.getCurrent(user);
  }

  @Patch('current')
  @RequirePermissions('store:update')
  @ApiOperation({ summary: '更新当前账号门店' })
  @ApiOkResponse({
    description: '更新成功并返回前端对齐后的门店信息',
    type: StoreResponseDto,
  })
  updateCurrent(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateStoreDto,
  ): Promise<StoreResponseDto> {
    return this.storesService.updateCurrent(user, dto);
  }

  @Get('current/logo')
  // PermissionsGuard 是「任一命中即通过」（AccessControlService.hasAnyPermission 用 some），
  // 这里追加权限码不会收紧、只会放宽。
  //
  // 为什么不能只留 store:view：本方法是整个 controller 里唯一用 @AllowSubAccount 显式放开
  // 给子账号的接口（class 上是 @BlockSubAccount）—— Logo 同源代理的目的是让前端把 Logo 画进
  // 海报 Canvas，而合成海报的正是店长/收银员这类子账号。但 store:view 不在任何一种子账号
  // 角色权限集里（cashier / manager / finance 全都没有），结果是「放开了子账号却必然 403」。
  //
  // 这里补两个「门店员工通用」的权限码作为子账号通道：三类角色都持有 service-call:view
  // 与 handover:view，任一个在角色权限表里存活，海报取 Logo 就不会被守卫拦住。
  // 反之不能把 store:view 直接加进子账号角色表——notifications、subscriptions 这些
  // controller 没有 @BlockSubAccount，会连带泄漏门店通知与套餐订阅数据。
  @RequirePermissions('store:view', 'service-call:view', 'handover:view')
  @AllowSubAccount()
  @ApiOperation({
    summary: '获取当前门店 Logo（同源代理）',
    description:
      '对象存储未配置 CORS 时前端无法把 Logo 画进 Canvas，经本接口代理为同源资源后即可参与桌码海报合成。' +
      'Logo 为选填项，门店未上传时返回 204 空响应（非 404），由前端回退品牌图标。',
  })
  @ApiNoContentResponse({ description: '门店未上传 Logo' })
  async getStoreLogo(
    @CurrentUser() user: AuthenticatedUser,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const logo = await this.storeLogoProxyService.getStoreLogo(user);
    if (!logo) {
      // Logo 选填：未上传是正常状态，回 204 让前端静默回退品牌图标
      void reply.code(204).header('Cache-Control', 'no-store').send();
      return;
    }
    void reply
      .type(logo.contentType)
      .header(
        'Cache-Control',
        `private, max-age=${STORE_LOGO_CACHE_MAX_AGE_SECONDS}`,
      )
      .send(logo.buffer);
  }

  @Get('current/wechat-pay-config')
  @RequirePermissions('store:view')
  @ApiOperation({ summary: '获取门店微信收款配置' })
  @ApiOkResponse({
    description: '返回门店微信收款配置，apiV3Key 不在响应中返回',
    type: WechatPayConfigResponseDto,
  })
  getWechatPayConfig(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<WechatPayConfigResponseDto> {
    return this.storesWechatPayService.getWechatPayConfig(user);
  }

  @Put('current/wechat-pay-config')
  @RequirePermissions('store:update')
  @ApiOperation({ summary: '更新门店微信收款配置' })
  @ApiOkResponse({
    description: '更新成功，返回最新配置（apiV3Key 不在响应中返回）',
    type: WechatPayConfigResponseDto,
  })
  updateWechatPayConfig(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateWechatPayConfigDto,
  ): Promise<WechatPayConfigResponseDto> {
    return this.storesWechatPayService.updateWechatPayConfig(user, dto);
  }
}

import { CurrentUser } from '../auth/current-user.decorator';
import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { BlockSubAccount } from '../access-control/decorators/block-sub-account.decorator';
import { RequirePermissions } from '../access-control/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../access-control/guards/permissions.guard';
import { SubAccountBlockGuard } from '../access-control/guards/sub-account-block.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { CreateStoreDto } from './dto/create-store.dto';
import { StoreResponseDto } from './dto/store-response.dto';
import {
  UpdateWechatPayConfigDto,
  WechatPayConfigResponseDto,
} from './dto/wechat-pay-config.dto';
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
  ) {}

  @Post()
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

  @Get()
  @RequirePermissions('store:view')
  @ApiOperation({ summary: '获取当前账号绑定门店' })
  @ApiOkResponse({
    description: '返回当前账号唯一绑定的门店信息',
    type: StoreResponseDto,
  })
  getStore(@CurrentUser() user: AuthenticatedUser): Promise<StoreResponseDto> {
    return this.storesService.getStore(user);
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
    @Body() dto: CreateStoreDto,
  ): Promise<StoreResponseDto> {
    return this.storesService.updateCurrent(user, dto);
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

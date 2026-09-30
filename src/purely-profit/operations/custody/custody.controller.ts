// 客存 B 端存单控制器：发起存入 / 列表 / 详情 / 作废，只负责路由、权限与 Swagger 注解
import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RequirePermissions } from '../../access-control/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../access-control/guards/permissions.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CustodyService } from './custody.service';
import {
  ConfirmPickupDto,
  CreateCustodyOrderDto,
  ListCustodyOrdersQueryDto,
  UpdateCustodySettingsDto,
  VerifyPickupCodeDto,
  VoidCustodyOrderDto,
} from './dto/custody-request.dto';
import {
  CreateCustodyOrderResponseDto,
  CustodyOrderActionResponseDto,
  CustodyOrderDetailResponseDto,
  CustodyOrderListResponseDto,
  CustodySettingsDto,
  CustodySettingsResponseDto,
  VerifyPickupCodeResponseDto,
} from './dto/custody-response.dto';

@ApiTags('Custody / Orders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('profit/custody-orders')
export class CustodyController {
  constructor(private readonly custodyService: CustodyService) {}

  @Post()
  @RequirePermissions('custody:create')
  @ApiOperation({
    summary: '发起客存存入',
    description:
      '店员在当前门店为会员发起寄存：落草稿存单并返回 6 位确认码；门店关闭客户确认时存单直接进入在存。支持 idempotencyKey 幂等重放。',
  })
  @ApiCreatedResponse({ type: CreateCustodyOrderResponseDto })
  createOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCustodyOrderDto,
  ): Promise<CreateCustodyOrderResponseDto> {
    return this.custodyService.createOrder(user, dto);
  }

  @Get()
  @RequirePermissions('custody:view')
  @ApiOperation({
    summary: '查询客存存单列表',
    description:
      '游标分页返回当前门店客存台账，附带统计口径（在存/临期/本月取出）。',
  })
  @ApiOkResponse({ type: CustodyOrderListResponseDto })
  listOrders(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListCustodyOrdersQueryDto,
  ): Promise<CustodyOrderListResponseDto> {
    return this.custodyService.listOrders(user, query);
  }

  @Get(':id')
  @RequirePermissions('custody:view')
  @ApiOperation({ summary: '查询客存存单详情与取出流水' })
  @ApiOkResponse({ type: CustodyOrderDetailResponseDto })
  getOrderDetail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) orderId: number,
  ): Promise<CustodyOrderDetailResponseDto> {
    return this.custodyService.getOrderDetail(user, orderId);
  }

  @Post(':id/resend-confirm-code')
  @RequirePermissions('custody:create')
  @ApiOperation({
    summary: '重发存入确认码',
    description:
      '确认码 5 分钟过期或客户错过时重发一枚新码（同存单同时只有一枚有效码）；仅待客户确认的草稿存单可重发。',
  })
  @ApiOkResponse({ type: CreateCustodyOrderResponseDto })
  resendConfirmCode(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) orderId: number,
  ): Promise<CreateCustodyOrderResponseDto> {
    return this.custodyService.resendConfirmCode(user, orderId);
  }

  @Post(':id/void')
  @RequirePermissions('custody:void')
  @ApiOperation({
    summary: '作废客存存单',
    description:
      '仅草稿 / 在存（含惰性过期）存单可作废，必须填写作废原因用于审计追溯。',
  })
  @ApiOkResponse({ type: CustodyOrderActionResponseDto })
  voidOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) orderId: number,
    @Body() dto: VoidCustodyOrderDto,
  ): Promise<CustodyOrderActionResponseDto> {
    return this.custodyService.voidOrder(user, orderId, dto);
  }
}

@ApiTags('Custody / Pickups')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('profit/custody-pickups')
export class CustodyPickupController {
  constructor(private readonly custodyService: CustodyService) {}

  @Post('verify')
  @RequirePermissions('custody:pickup')
  @ApiOperation({
    summary: '校验取件码',
    description:
      '校验客户出示的 6 位取件码并返回待核销预览与一次性核销令牌；此步骤不扣减剩余数量。',
  })
  @ApiOkResponse({ type: VerifyPickupCodeResponseDto })
  verifyPickupCode(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: VerifyPickupCodeDto,
  ): Promise<VerifyPickupCodeResponseDto> {
    return this.custodyService.verifyPickupCode(user, dto);
  }

  @Post('confirm')
  @RequirePermissions('custody:pickup')
  @ApiOperation({
    summary: '确认取出',
    description:
      '凭核销令牌执行原子扣减：写取出流水、必要时置为已取完，冻结口径追加库存解冻日志。',
  })
  @ApiOkResponse({ type: CustodyOrderActionResponseDto })
  confirmPickup(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ConfirmPickupDto,
  ): Promise<CustodyOrderActionResponseDto> {
    return this.custodyService.confirmPickup(user, dto);
  }
}

@ApiTags('Custody / Settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('profit/custody-settings')
export class CustodySettingsController {
  constructor(private readonly custodyService: CustodyService) {}

  @Get()
  @RequirePermissions('custody:manage')
  @ApiOperation({ summary: '查询门店客存配置' })
  @ApiOkResponse({ type: CustodySettingsResponseDto })
  getSettings(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CustodySettingsDto> {
    return this.custodyService.getSettings(user);
  }

  @Patch()
  @RequirePermissions('custody:manage')
  @ApiOperation({
    summary: '更新门店客存配置',
    description: '一期不开放跨店通取，allowCrossStorePickup 始终为 false。',
  })
  @ApiOkResponse({ type: CustodySettingsResponseDto })
  updateSettings(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateCustodySettingsDto,
  ): Promise<CustodySettingsDto> {
    return this.custodyService.updateSettings(user, dto);
  }
}

import {
  UserWithRequestId,
  type UserWithRequestIdValue,
} from '../../auth/user-with-request-id.decorator';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
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
import { PermissionsGuard } from '../../access-control/guards/permissions.guard';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import {
  AddSpaceSessionItemsDto,
  CheckoutSpaceSessionDto,
  CheckoutSpaceSessionPreviewDto,
  CheckoutSpaceSessionPreviewResponseDto,
  CheckoutSpaceSessionResponseDto,
  ListSpaceSessionsQueryDto,
  OpenSpaceSessionDto,
  PaginatedSpaceSessionsResponseDto,
  RenewSpaceSessionDto,
  RenewSpaceSessionResponseDto,
  SpaceSessionResponseDto,
  TransferSpaceSessionDto,
  TransferSpaceSessionResponseDto,
} from './dto/space-session.dto';
import { SpaceSessionsService } from './space-sessions.service';

@ApiTags('SpaceSessions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller()
export class SpaceSessionsController {
  constructor(private readonly spaceSessionsService: SpaceSessionsService) {}

  @Get('spaces/:spaceId/active-session')
  @RequirePermissions('space:view')
  @ApiOperation({ summary: '获取某空间当前使用中的会话' })
  @ApiOkResponse({
    description: '存在时返回当前 active 会话，不存在返回 null',
    type: SpaceSessionResponseDto,
  })
  getActiveSession(
    @UserWithRequestId() ctx: UserWithRequestIdValue,
    @Param('spaceId', ParseIntPipe) spaceId: number,
  ): Promise<SpaceSessionResponseDto | null> {
    return this.spaceSessionsService.getActiveSpaceSession(
      ctx.user,
      spaceId,
      ctx.requestId,
    );
  }

  @Get('spaces/:spaceId/sessions')
  @RequirePermissions('space:view')
  @ApiOperation({ summary: '获取某空间的会话列表（支持分页/筛选/搜索）' })
  @ApiOkResponse({ type: PaginatedSpaceSessionsResponseDto })
  listSessions(
    @UserWithRequestId() ctx: UserWithRequestIdValue,
    @Param('spaceId', ParseIntPipe) spaceId: number,
    @Query() query: ListSpaceSessionsQueryDto,
  ): Promise<PaginatedSpaceSessionsResponseDto> {
    return this.spaceSessionsService.listSpaceSessions(
      ctx.user,
      spaceId,
      query,
      ctx.requestId,
    );
  }

  @Get('space-sessions/active')
  @RequirePermissions('space:view')
  @ApiOperation({
    summary: '获取当前门店 active 空间会话快照',
    description:
      '默认仅返回当前门店 status=active 的空间会话。兼容传入 storeId、keyword、时间区间；如显式传入 status，则按传入值查询。',
  })
  @ApiOkResponse({ type: [SpaceSessionResponseDto] })
  listStoreActiveSessions(
    @UserWithRequestId() ctx: UserWithRequestIdValue,
    @Query() query: ListSpaceSessionsQueryDto,
  ): Promise<SpaceSessionResponseDto[]> {
    return this.spaceSessionsService.listStoreActiveSpaceSessions(
      ctx.user,
      query,
      ctx.requestId,
    );
  }

  @Get('space-sessions')
  @RequirePermissions('space:view')
  @ApiOperation({
    summary: '获取当前门店 active 空间会话快照（兼容前端读取接口）',
    description:
      '未传 status 时，默认只返回当前门店 status=active 的空间会话；如需查看历史已结账会话，请显式传 status=settled。',
  })
  @ApiOkResponse({ type: [SpaceSessionResponseDto] })
  listStoreSessions(
    @UserWithRequestId() ctx: UserWithRequestIdValue,
    @Query() query: ListSpaceSessionsQueryDto,
  ): Promise<SpaceSessionResponseDto[]> {
    return this.spaceSessionsService.listStoreSpaceSessions(
      ctx.user,
      query,
      ctx.requestId,
    );
  }

  @Get('space-sessions/:id')
  @RequirePermissions('space:view')
  @ApiOperation({ summary: '获取空间会话详情' })
  @ApiOkResponse({ type: SpaceSessionResponseDto })
  getSessionDetail(
    @UserWithRequestId() ctx: UserWithRequestIdValue,
    @Param('id', ParseIntPipe) sessionId: number,
  ): Promise<SpaceSessionResponseDto> {
    return this.spaceSessionsService.getSpaceSessionDetail(
      ctx.user,
      sessionId,
      ctx.requestId,
    );
  }

  @Post('spaces/:spaceId/sessions')
  @RequirePermissions('operation-entry:create')
  @ApiOperation({ summary: '空间开台并创建使用会话' })
  @ApiCreatedResponse({ type: SpaceSessionResponseDto })
  openSession(
    @UserWithRequestId() ctx: UserWithRequestIdValue,
    @Param('spaceId', ParseIntPipe) spaceId: number,
    @Body() dto: OpenSpaceSessionDto,
  ): Promise<SpaceSessionResponseDto> {
    return this.spaceSessionsService.openSpaceSession(ctx.user, spaceId, dto);
  }

  @Post('space-sessions')
  @RequirePermissions('operation-entry:create')
  @ApiOperation({ summary: '开台（兼容前端根路径接口）' })
  @ApiCreatedResponse({ type: SpaceSessionResponseDto })
  openSessionByRootPath(
    @UserWithRequestId() ctx: UserWithRequestIdValue,
    @Body() dto: OpenSpaceSessionDto,
  ): Promise<SpaceSessionResponseDto> {
    if (dto.spaceId === undefined) {
      throw new BadRequestException('spaceId 必填');
    }

    return this.spaceSessionsService.openSpaceSession(
      ctx.user,
      dto.spaceId,
      dto,
    );
  }

  @Post('space-sessions/:id/items')
  @RequirePermissions('operation-entry:create')
  @ApiOperation({ summary: '给空间会话追加商品' })
  @ApiOkResponse({ type: SpaceSessionResponseDto })
  addItems(
    @UserWithRequestId() ctx: UserWithRequestIdValue,
    @Param('id', ParseIntPipe) sessionId: number,
    @Body() dto: AddSpaceSessionItemsDto,
  ): Promise<SpaceSessionResponseDto> {
    return this.spaceSessionsService.addItemsToSpaceSession(
      ctx.user,
      sessionId,
      dto,
    );
  }

  @Post('space-sessions/:id/renew')
  @RequirePermissions('operation-entry:create')
  @ApiOperation({ summary: '给倒计时会话续费' })
  @ApiOkResponse({ type: RenewSpaceSessionResponseDto })
  renew(
    @UserWithRequestId() ctx: UserWithRequestIdValue,
    @Param('id', ParseIntPipe) sessionId: number,
    @Body() dto: RenewSpaceSessionDto,
  ): Promise<RenewSpaceSessionResponseDto> {
    return this.spaceSessionsService.renewSpaceSession(
      ctx.user,
      sessionId,
      dto,
    );
  }

  @Post('space-sessions/:id/transfer')
  @RequirePermissions('operation-entry:create')
  @ApiOperation({ summary: '将使用中的会话换到同类型空闲空间' })
  @ApiOkResponse({ type: TransferSpaceSessionResponseDto })
  transfer(
    @UserWithRequestId() ctx: UserWithRequestIdValue,
    @Param('id', ParseIntPipe) sessionId: number,
    @Body() dto: TransferSpaceSessionDto,
  ): Promise<TransferSpaceSessionResponseDto> {
    return this.spaceSessionsService.transferSpaceSession(
      ctx.user,
      sessionId,
      dto,
    );
  }

  @Post('space-sessions/:id/checkout-preview')
  @RequirePermissions('operation-entry:create')
  @ApiOperation({ summary: '创建空间会话的结账预览锁单' })
  @ApiOkResponse({ type: CheckoutSpaceSessionPreviewResponseDto })
  previewCheckout(
    @UserWithRequestId() ctx: UserWithRequestIdValue,
    @Param('id', ParseIntPipe) sessionId: number,
    @Body() dto: CheckoutSpaceSessionPreviewDto,
  ): Promise<CheckoutSpaceSessionPreviewResponseDto> {
    return this.spaceSessionsService.previewSpaceSessionCheckout(
      ctx.user,
      sessionId,
      dto,
    );
  }

  @Post('space-sessions/:id/checkout')
  @RequirePermissions('operation-entry:create')
  @ApiOperation({ summary: '结账并关闭使用会话' })
  @ApiOkResponse({ type: CheckoutSpaceSessionResponseDto })
  checkout(
    @UserWithRequestId() ctx: UserWithRequestIdValue,
    @Param('id', ParseIntPipe) sessionId: number,
    @Body() dto: CheckoutSpaceSessionDto,
  ): Promise<CheckoutSpaceSessionResponseDto> {
    return this.spaceSessionsService.checkoutSpaceSession(
      ctx.user,
      sessionId,
      dto,
    );
  }
}

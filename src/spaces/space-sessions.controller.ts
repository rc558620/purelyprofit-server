import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RequirePermissions } from '../access-control/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../access-control/guards/permissions.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import {
  AddSpaceSessionItemsDto,
  CheckoutSpaceSessionDto,
  CheckoutSpaceSessionPreviewDto,
  CheckoutSpaceSessionPreviewResponseDto,
  ListSpaceSessionsQueryDto,
  OpenSpaceSessionDto,
  PaginatedSpaceSessionsResponseDto,
  RenewSpaceSessionDto,
  RenewSpaceSessionResponseDto,
  SpaceSessionResponseDto,
  TransferSpaceSessionDto,
  TransferSpaceSessionResponseDto,
} from './dto/space-session.dto';
import { SpacesService } from './spaces.service';

@ApiTags('SpaceSessions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller()
export class SpaceSessionsController {
  constructor(private readonly spacesService: SpacesService) {}

  @Get('spaces/:spaceId/active-session')
  @RequirePermissions('space:view')
  @ApiOperation({ summary: '获取某空间当前使用中的会话' })
  @ApiOkResponse({
    description: '存在时返回当前 active 会话，不存在返回 null',
    type: SpaceSessionResponseDto,
  })
  getActiveSession(
    @Req() request: { user: AuthenticatedUser },
    @Param('spaceId', ParseIntPipe) spaceId: number,
  ): Promise<SpaceSessionResponseDto | null> {
    return this.spacesService.getActiveSpaceSession(request.user, spaceId);
  }

  @Get('spaces/:spaceId/sessions')
  @RequirePermissions('space:view')
  @ApiOperation({ summary: '获取某空间的会话列表（支持分页/筛选/搜索）' })
  @ApiOkResponse({ type: PaginatedSpaceSessionsResponseDto })
  listSessions(
    @Req() request: { user: AuthenticatedUser },
    @Param('spaceId', ParseIntPipe) spaceId: number,
    @Query() query: ListSpaceSessionsQueryDto,
  ): Promise<PaginatedSpaceSessionsResponseDto> {
    return this.spacesService.listSpaceSessions(request.user, spaceId, query);
  }

  @Get('space-sessions/:id')
  @RequirePermissions('space:view')
  @ApiOperation({ summary: '获取空间会话详情' })
  @ApiOkResponse({ type: SpaceSessionResponseDto })
  getSessionDetail(
    @Req() request: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) sessionId: number,
  ): Promise<SpaceSessionResponseDto> {
    return this.spacesService.getSpaceSessionDetail(request.user, sessionId);
  }

  @Post('spaces/:spaceId/sessions')
  @RequirePermissions('sales:create')
  @ApiOperation({ summary: '空间开台并创建使用会话' })
  @ApiCreatedResponse({ type: SpaceSessionResponseDto })
  openSession(
    @Req() request: { user: AuthenticatedUser },
    @Param('spaceId', ParseIntPipe) spaceId: number,
    @Body() dto: OpenSpaceSessionDto,
  ): Promise<SpaceSessionResponseDto> {
    return this.spacesService.openSpaceSession(request.user, spaceId, dto);
  }

  @Post('space-sessions/:id/items')
  @RequirePermissions('sales:create')
  @ApiOperation({ summary: '给空间会话追加商品' })
  @ApiOkResponse({ type: SpaceSessionResponseDto })
  addItems(
    @Req() request: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) sessionId: number,
    @Body() dto: AddSpaceSessionItemsDto,
  ): Promise<SpaceSessionResponseDto> {
    return this.spacesService.addItemsToSpaceSession(
      request.user,
      sessionId,
      dto,
    );
  }

  @Post('space-sessions/:id/renew')
  @RequirePermissions('sales:create')
  @ApiOperation({ summary: '给倒计时会话续费' })
  @ApiOkResponse({ type: RenewSpaceSessionResponseDto })
  renew(
    @Req() request: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) sessionId: number,
    @Body() dto: RenewSpaceSessionDto,
  ): Promise<RenewSpaceSessionResponseDto> {
    return this.spacesService.renewSpaceSession(request.user, sessionId, dto);
  }

  @Post('space-sessions/:id/transfer')
  @RequirePermissions('sales:create')
  @ApiOperation({ summary: '将使用中的会话换到同类型空闲空间' })
  @ApiOkResponse({ type: TransferSpaceSessionResponseDto })
  transfer(
    @Req() request: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) sessionId: number,
    @Body() dto: TransferSpaceSessionDto,
  ): Promise<TransferSpaceSessionResponseDto> {
    return this.spacesService.transferSpaceSession(
      request.user,
      sessionId,
      dto,
    );
  }

  @Post('space-sessions/:id/checkout-preview')
  @RequirePermissions('sales:create')
  @ApiOperation({ summary: '创建空间会话的结账预览锁单' })
  @ApiOkResponse({ type: CheckoutSpaceSessionPreviewResponseDto })
  previewCheckout(
    @Req() request: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) sessionId: number,
    @Body() dto: CheckoutSpaceSessionPreviewDto,
  ): Promise<CheckoutSpaceSessionPreviewResponseDto> {
    return this.spacesService.previewSpaceSessionCheckout(
      request.user,
      sessionId,
      dto,
    );
  }

  @Post('space-sessions/:id/checkout')
  @RequirePermissions('sales:create')
  @ApiOperation({ summary: '结账并关闭使用会话' })
  @ApiOkResponse({ type: SpaceSessionResponseDto })
  checkout(
    @Req() request: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) sessionId: number,
    @Body() dto: CheckoutSpaceSessionDto,
  ): Promise<SpaceSessionResponseDto> {
    return this.spacesService.checkoutSpaceSession(
      request.user,
      sessionId,
      dto,
    );
  }
}

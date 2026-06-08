import {
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RequirePermissions } from '../access-control/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../access-control/guards/permissions.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import {
  ListNotificationsQueryDto,
  MarkAllNotificationsReadResponseDto,
  MarkNotificationReadResponseDto,
  NotificationsListResponseDto,
  NotificationsStoreQueryDto,
  NotificationsUnreadSummaryResponseDto,
} from './dto/notifications.dto';
import { NotificationsService } from './notifications.service';

@ApiTags('Notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get('unread-summary')
  @RequirePermissions('store:view')
  @ApiOperation({ summary: '获取当前门店未读通知摘要' })
  @ApiOkResponse({
    description: '返回未读数量和最新未读通知摘要',
    type: NotificationsUnreadSummaryResponseDto,
  })
  getUnreadSummary(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: NotificationsStoreQueryDto,
  ): Promise<NotificationsUnreadSummaryResponseDto> {
    return this.notificationsService.getUnreadSummary(user, query);
  }

  @Get()
  @RequirePermissions('store:view')
  @ApiOperation({ summary: '获取通知列表' })
  @ApiOkResponse({
    description: '返回当前门店通知列表、未读数量和分页信息',
    type: NotificationsListResponseDto,
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListNotificationsQueryDto,
  ): Promise<NotificationsListResponseDto> {
    return this.notificationsService.list(user, query);
  }

  @Patch('read-all')
  @RequirePermissions('store:view')
  @ApiOperation({ summary: '将当前门店所有当前通知标记为已读' })
  @ApiOkResponse({
    description: '返回全部标记结果和最新未读数量',
    type: MarkAllNotificationsReadResponseDto,
  })
  markAllRead(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: NotificationsStoreQueryDto,
  ): Promise<MarkAllNotificationsReadResponseDto> {
    return this.notificationsService.markAllRead(user, query);
  }

  @Patch(':id/read')
  @RequirePermissions('store:view')
  @ApiOperation({ summary: '将单条通知标记为已读' })
  @ApiOkResponse({
    description: '返回单条通知标记结果和最新未读数量',
    type: MarkNotificationReadResponseDto,
  })
  markRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') notificationId: string,
    @Query() query: NotificationsStoreQueryDto,
  ): Promise<MarkNotificationReadResponseDto> {
    return this.notificationsService.markRead(user, notificationId, query);
  }
}

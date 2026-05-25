import { Injectable, NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import type {
  ListNotificationsQueryDto,
  MarkAllNotificationsReadResponseDto,
  MarkNotificationReadResponseDto,
  NotificationsListResponseDto,
  NotificationsStoreQueryDto,
  NotificationsUnreadSummaryResponseDto,
} from './dto/notifications.dto';
import { SUMMARY_LIMIT } from './notifications.constants';
import { NotificationsContextService } from './notifications-context.service';
import { NotificationsReadStateService } from './notifications-read-state.service';
import {
  toNotificationItemDto,
  toNotificationSummaryItems,
} from './notifications.mapper';
import {
  queryNotificationItems,
  toListNotificationsQueryInput,
  toNotificationsStoreQueryInput,
} from './notifications.query';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly notificationsContextService: NotificationsContextService,
    private readonly notificationsReadStateService: NotificationsReadStateService,
  ) {}

  async getUnreadSummary(
    user: AuthenticatedUser,
    queryDto: NotificationsStoreQueryDto,
  ): Promise<NotificationsUnreadSummaryResponseDto> {
    const query = toNotificationsStoreQueryInput(queryDto);
    const { storeId, items } =
      await this.notificationsContextService.loadContext(user, query);
    const unreadItems =
      await this.notificationsReadStateService.filterUnreadItems(
        storeId,
        items,
      );

    return {
      unreadCount: unreadItems.length,
      latestItems: toNotificationSummaryItems(unreadItems, SUMMARY_LIMIT),
    };
  }

  async list(
    user: AuthenticatedUser,
    queryDto: ListNotificationsQueryDto,
  ): Promise<NotificationsListResponseDto> {
    const query = toListNotificationsQueryInput(queryDto);
    const { storeId, items } =
      await this.notificationsContextService.loadContext(user, query);
    const unreadMap = await this.notificationsReadStateService.getUnreadMap(
      storeId,
      items,
    );
    const unreadCount = this.notificationsReadStateService.countUnreadItems(
      items,
      unreadMap,
    );
    const pagedResult = queryNotificationItems(items, unreadMap, query);

    return {
      items: pagedResult.items.map((item) =>
        toNotificationItemDto(item, unreadMap.get(item.id)),
      ),
      unreadCount,
      meta: pagedResult.meta,
    };
  }

  async markRead(
    user: AuthenticatedUser,
    notificationId: string,
    queryDto: NotificationsStoreQueryDto,
  ): Promise<MarkNotificationReadResponseDto> {
    const query = toNotificationsStoreQueryInput(queryDto);
    const { storeId, items } =
      await this.notificationsContextService.loadContext(user, query);
    const target = items.find((item) => item.id === notificationId);

    if (!target) {
      throw new NotFoundException('通知不存在或已失效');
    }

    const readAt = await this.notificationsReadStateService.markRead(
      storeId,
      notificationId,
    );
    const unreadMap = await this.notificationsReadStateService.getUnreadMap(
      storeId,
      items,
    );
    unreadMap.set(notificationId, readAt);
    const unreadCount = this.notificationsReadStateService.countUnreadItems(
      items,
      unreadMap,
    );

    return {
      success: true,
      id: notificationId,
      readAt,
      unreadCount,
    };
  }

  async markAllRead(
    user: AuthenticatedUser,
    queryDto: NotificationsStoreQueryDto,
  ): Promise<MarkAllNotificationsReadResponseDto> {
    const query = toNotificationsStoreQueryInput(queryDto);
    const { storeId, items } =
      await this.notificationsContextService.loadContext(user, query);
    const readAt = await this.notificationsReadStateService.markAllRead(
      storeId,
      items.map((item) => item.id),
    );

    return {
      success: true,
      readAt,
      unreadCount: 0,
    };
  }
}

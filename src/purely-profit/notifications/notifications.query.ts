import type {
  ListNotificationsQueryDto,
  NotificationsStoreQueryDto,
} from './dto/notifications.dto';
import type {
  ListNotificationsQueryInput,
  NotificationDraft,
  NotificationListPageResult,
  NotificationReadMap,
  NotificationsStoreQueryInput,
} from './notifications.types';
import { normalizePage, normalizePageSize } from './notifications.utils';

export function toNotificationsStoreQueryInput(
  queryDto: NotificationsStoreQueryDto,
): NotificationsStoreQueryInput {
  return {
    storeId: queryDto.storeId,
  };
}

export function toListNotificationsQueryInput(
  queryDto: ListNotificationsQueryDto,
): ListNotificationsQueryInput {
  return {
    storeId: queryDto.storeId,
    page: queryDto.page,
    pageSize: queryDto.pageSize,
    type: queryDto.type,
    unreadOnly: queryDto.unreadOnly,
  };
}

export function queryNotificationItems(
  items: NotificationDraft[],
  unreadMap: NotificationReadMap,
  query: ListNotificationsQueryInput,
): NotificationListPageResult {
  let filteredItems = items;

  if (query.type) {
    filteredItems = filteredItems.filter((item) => item.type === query.type);
  }

  if (query.unreadOnly) {
    filteredItems = filteredItems.filter(
      (item) => unreadMap.get(item.id) === undefined,
    );
  }

  const page = normalizePage(query.page);
  const pageSize = normalizePageSize(query.pageSize);
  const total = filteredItems.length;
  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
  const startIndex = (page - 1) * pageSize;

  return {
    items: filteredItems.slice(startIndex, startIndex + pageSize),
    meta: {
      page,
      pageSize,
      total,
      totalPages,
    },
  };
}

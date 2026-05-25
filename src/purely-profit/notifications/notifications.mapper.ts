import type {
  NotificationItemDto,
  NotificationSummaryItemDto,
} from './dto/notifications.dto';
import type { NotificationDraft } from './notifications.types';

export function toNotificationSummaryItemDto(
  item: NotificationDraft,
): NotificationSummaryItemDto {
  return {
    id: item.id,
    type: item.type,
    title: item.title,
    createdAt: item.createdAt,
    ...(item.actionUrl ? { actionUrl: item.actionUrl } : {}),
  };
}

export function toNotificationSummaryItems(
  items: NotificationDraft[],
  limit: number,
): NotificationSummaryItemDto[] {
  return items.slice(0, limit).map(toNotificationSummaryItemDto);
}

export function toNotificationItemDto(
  item: NotificationDraft,
  readAt: number | undefined,
): NotificationItemDto {
  return {
    id: item.id,
    type: item.type,
    title: item.title,
    content: item.content,
    ...(item.bizType ? { bizType: item.bizType } : {}),
    ...(item.bizId ? { bizId: item.bizId } : {}),
    ...(item.actionUrl ? { actionUrl: item.actionUrl } : {}),
    createdAt: item.createdAt,
    ...(readAt !== undefined ? { readAt } : {}),
  };
}

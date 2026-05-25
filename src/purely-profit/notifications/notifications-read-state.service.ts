import { Injectable } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';
import { NOTIFICATIONS_READ_KEY_PREFIX } from './notifications.constants';
import type {
  NotificationDraft,
  NotificationReadMap,
} from './notifications.types';

@Injectable()
export class NotificationsReadStateService {
  constructor(private readonly redisService: RedisService) {}

  async filterUnreadItems(
    storeId: number,
    items: NotificationDraft[],
  ): Promise<NotificationDraft[]> {
    const unreadMap = await this.getUnreadMap(storeId, items);
    return items.filter((item) => unreadMap.get(item.id) === undefined);
  }

  async getUnreadMap(
    storeId: number,
    items: NotificationDraft[],
  ): Promise<NotificationReadMap> {
    const entries = await Promise.all(
      items.map(async (item) => {
        const rawReadAt = await this.redisService.get(
          this.buildNotificationReadKey(storeId, item.id),
        );
        const parsedReadAt = rawReadAt
          ? Number.parseInt(rawReadAt, 10)
          : Number.NaN;
        return [
          item.id,
          Number.isNaN(parsedReadAt) ? undefined : parsedReadAt,
        ] as const;
      }),
    );

    return new Map(entries);
  }

  countUnreadItems(
    items: NotificationDraft[],
    unreadMap: NotificationReadMap,
  ): number {
    return items.filter((item) => unreadMap.get(item.id) === undefined).length;
  }

  async markRead(storeId: number, notificationId: string): Promise<number> {
    const readAt = Date.now();
    await this.redisService.set(
      this.buildNotificationReadKey(storeId, notificationId),
      String(readAt),
    );
    return readAt;
  }

  async markAllRead(
    storeId: number,
    notificationIds: string[],
  ): Promise<number> {
    const readAt = Date.now();

    await Promise.all(
      notificationIds.map((notificationId) =>
        this.redisService.set(
          this.buildNotificationReadKey(storeId, notificationId),
          String(readAt),
        ),
      ),
    );

    return readAt;
  }

  private buildNotificationReadKey(
    storeId: number,
    notificationId: string,
  ): string {
    return `${NOTIFICATIONS_READ_KEY_PREFIX}${storeId}:${notificationId}`;
  }
}

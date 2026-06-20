import { Injectable } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';
import {
  NOTIFICATIONS_READ_KEY_PREFIX,
  NOTIFICATIONS_READ_TTL_SECONDS,
} from './notifications.constants';
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
    if (items.length === 0) {
      return new Map();
    }

    const keys = items.map((item) =>
      this.buildNotificationReadKey(storeId, item.id),
    );

    // 使用 Pipeline 批量读取，避免逐条网络请求
    const client = this.redisService.getClient();
    const pipeline = client.pipeline();
    for (const key of keys) {
      pipeline.get(key);
    }
    const results = await pipeline.exec();

    const entries: Array<readonly [string, number | undefined]> = [];
    for (let index = 0; index < items.length; index++) {
      const rawReadAt = results?.[index]?.[1] as string | null;
      const parsedReadAt = rawReadAt
        ? Number.parseInt(rawReadAt, 10)
        : Number.NaN;
      entries.push([
        items[index].id,
        Number.isNaN(parsedReadAt) ? undefined : parsedReadAt,
      ]);
    }

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
      NOTIFICATIONS_READ_TTL_SECONDS,
    );
    return readAt;
  }

  async markAllRead(
    storeId: number,
    notificationIds: string[],
  ): Promise<number> {
    const readAt = Date.now();

    // 使用 Pipeline 批量写入，并统一设置 TTL
    const client = this.redisService.getClient();
    const pipeline = client.pipeline();
    for (const notificationId of notificationIds) {
      const key = this.buildNotificationReadKey(storeId, notificationId);
      pipeline.set(key, String(readAt), 'EX', NOTIFICATIONS_READ_TTL_SECONDS);
    }
    await pipeline.exec();

    return readAt;
  }

  private buildNotificationReadKey(
    storeId: number,
    notificationId: string,
  ): string {
    return `${NOTIFICATIONS_READ_KEY_PREFIX}${storeId}:${notificationId}`;
  }
}

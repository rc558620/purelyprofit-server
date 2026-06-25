import { Injectable, Logger } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../commerce/commerce-access.service';
import { RedisService } from '../../redis/redis.service';
import { NotificationsBuildService } from './notifications-build.service';
import {
  NOTIFICATIONS_ITEMS_CACHE_TTL_SECONDS,
  NOTIFICATIONS_READ_KEY_PREFIX,
} from './notifications.constants';
import type {
  NotificationDraft,
  NotificationsContext,
  NotificationsStoreQueryInput,
} from './notifications.types';

@Injectable()
export class NotificationsContextService {
  private readonly logger = new Logger(NotificationsContextService.name);

  constructor(
    private readonly commerceAccessService: CommerceAccessService,
    private readonly notificationsBuildService: NotificationsBuildService,
    private readonly redisService: RedisService,
  ) {}

  async loadContext(
    user: AuthenticatedUser,
    query: NotificationsStoreQueryInput,
  ): Promise<NotificationsContext> {
    const storeId = await this.resolveStoreId(user, query.storeId);
    const items = await this.loadItems(storeId);

    return {
      storeId,
      items,
    };
  }

  private async resolveStoreId(
    user: AuthenticatedUser,
    requestedStoreId: number | undefined,
  ): Promise<number> {
    return this.commerceAccessService.resolveSingleStoreId(
      user,
      requestedStoreId,
      'store:view',
      '无权查看该门店通知',
    );
  }

  private async loadItems(storeId: number): Promise<NotificationDraft[]> {
    const cacheKey = `${NOTIFICATIONS_READ_KEY_PREFIX}items:${storeId}`;
    const cached = await this.redisService.get(cacheKey);

    if (cached) {
      try {
        return JSON.parse(cached) as NotificationDraft[];
      } catch (error: unknown) {
        // 缓存内容异常，回退到查库
        this.logger.warn(
          `[NotificationsContextService] 解析门店 ${storeId} 通知缓存失败: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    const items =
      await this.notificationsBuildService.buildNotificationItems(storeId);

    // 短期缓存，减少重复查库
    await this.redisService.set(
      cacheKey,
      JSON.stringify(items),
      NOTIFICATIONS_ITEMS_CACHE_TTL_SECONDS,
    );

    return items;
  }
}

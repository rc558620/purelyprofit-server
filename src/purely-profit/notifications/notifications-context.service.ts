import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../commerce/commerce-access.service';
import { NotificationsBuildService } from './notifications-build.service';
import type {
  NotificationDraft,
  NotificationsContext,
  NotificationsStoreQueryInput,
} from './notifications.types';

@Injectable()
export class NotificationsContextService {
  constructor(
    private readonly commerceAccessService: CommerceAccessService,
    private readonly notificationsBuildService: NotificationsBuildService,
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

  private loadItems(storeId: number): Promise<NotificationDraft[]> {
    return this.notificationsBuildService.buildNotificationItems(storeId);
  }
}

import { Injectable, NotFoundException } from '@nestjs/common';
import {
  FinanceAccountStatus,
  PartnerWithdrawalStatus,
  StoreSubscriptionStatus,
} from '@prisma/client';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../commerce/commerce-access.service';
import { toDecimalNumber } from '../commerce/commerce.utils';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import type {
  ListNotificationsQueryDto,
  MarkAllNotificationsReadResponseDto,
  MarkNotificationReadResponseDto,
  NotificationItemDto,
  NotificationsListResponseDto,
  NotificationsStoreQueryDto,
  NotificationsUnreadSummaryResponseDto,
} from './dto/notifications.dto';
import type { NotificationTypeValue } from './notifications.types';

const DAY_MS = 86_400_000;
const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const SUMMARY_LIMIT = 5;
const NOTIFICATIONS_READ_KEY_PREFIX = 'notifications:read:';
const LOW_STOCK_SOURCE_LIMIT = 50;
const SOURCE_LIMIT = 20;

interface NotificationsStoreQueryInput {
  storeId?: number;
}

interface ListNotificationsQueryInput {
  storeId?: number;
  page?: number;
  pageSize?: number;
  type?: NotificationTypeValue;
  unreadOnly?: boolean;
}

interface ProductAlertRow {
  id: number;
  name: string;
  stock: number;
  alertThreshold: number;
  updatedAt: Date;
}

interface OverdueAccountRow {
  id: number;
  counterpart: string;
  remaining: { toString(): string };
  dueDate: Date | null;
  updatedAt: Date;
}

interface StoreSubscriptionRow {
  id: number;
  planName: string;
  status: StoreSubscriptionStatus;
  expiresAt: Date | null;
  updatedAt: Date;
}

interface ActivePromotionRow {
  id: number;
  name: string;
  endAt: Date;
  updatedAt: Date;
}

interface PendingWithdrawalRow {
  id: number;
  beanAmount: number;
  appliedAt: Date;
}

interface UpcomingLeaveRow {
  id: number;
  employeeName: string;
  startDate: Date;
  createdAt: Date;
}

interface NotificationDraft {
  id: string;
  type: NotificationTypeValue;
  title: string;
  content: string;
  bizType?: string;
  bizId?: string;
  actionUrl?: string;
  createdAt: number;
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly redisService: RedisService,
  ) {}

  async getUnreadSummary(
    user: AuthenticatedUser,
    queryDto: NotificationsStoreQueryDto,
  ): Promise<NotificationsUnreadSummaryResponseDto> {
    const query: NotificationsStoreQueryInput = {
      storeId: queryDto.storeId,
    };
    const storeId = await this.resolveStoreId(user, query.storeId);
    const items = await this.buildNotificationItems(storeId);
    const unreadItems = await this.filterUnreadItems(storeId, items);

    return {
      unreadCount: unreadItems.length,
      latestItems: unreadItems.slice(0, SUMMARY_LIMIT).map((item) => ({
        id: item.id,
        type: item.type,
        title: item.title,
        createdAt: item.createdAt,
        ...(item.actionUrl ? { actionUrl: item.actionUrl } : {}),
      })),
    };
  }

  async list(
    user: AuthenticatedUser,
    queryDto: ListNotificationsQueryDto,
  ): Promise<NotificationsListResponseDto> {
    const query: ListNotificationsQueryInput = {
      storeId: queryDto.storeId,
      page: queryDto.page,
      pageSize: queryDto.pageSize,
      type: queryDto.type,
      unreadOnly: queryDto.unreadOnly,
    };
    const storeId = await this.resolveStoreId(user, query.storeId);
    const items = await this.buildNotificationItems(storeId);
    const unreadMap = await this.getUnreadMap(storeId, items);
    const unreadCount = items.filter(
      (item) => unreadMap.get(item.id) === undefined,
    ).length;

    let filteredItems = items;
    if (query.type) {
      filteredItems = filteredItems.filter((item) => item.type === query.type);
    }
    if (query.unreadOnly) {
      filteredItems = filteredItems.filter(
        (item) => unreadMap.get(item.id) === undefined,
      );
    }

    const page = this.normalizePage(query.page);
    const pageSize = this.normalizePageSize(query.pageSize);
    const total = filteredItems.length;
    const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
    const startIndex = (page - 1) * pageSize;
    const pagedItems = filteredItems.slice(startIndex, startIndex + pageSize);

    return {
      items: pagedItems.map((item) =>
        this.toNotificationItemDto(item, unreadMap.get(item.id)),
      ),
      unreadCount,
      meta: {
        page,
        pageSize,
        total,
        totalPages,
      },
    };
  }

  async markRead(
    user: AuthenticatedUser,
    notificationId: string,
    queryDto: NotificationsStoreQueryDto,
  ): Promise<MarkNotificationReadResponseDto> {
    const query: NotificationsStoreQueryInput = {
      storeId: queryDto.storeId,
    };
    const storeId = await this.resolveStoreId(user, query.storeId);
    const items = await this.buildNotificationItems(storeId);
    const target = items.find((item) => item.id === notificationId);

    if (!target) {
      throw new NotFoundException('通知不存在或已失效');
    }

    const readAt = Date.now();
    await this.redisService.set(
      this.buildNotificationReadKey(storeId, notificationId),
      String(readAt),
    );
    const unreadMap = await this.getUnreadMap(storeId, items);
    unreadMap.set(notificationId, readAt);
    const unreadCount = items.filter(
      (item) => unreadMap.get(item.id) === undefined,
    ).length;

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
    const query: NotificationsStoreQueryInput = {
      storeId: queryDto.storeId,
    };
    const storeId = await this.resolveStoreId(user, query.storeId);
    const items = await this.buildNotificationItems(storeId);
    const readAt = Date.now();

    await Promise.all(
      items.map((item) =>
        this.redisService.set(
          this.buildNotificationReadKey(storeId, item.id),
          String(readAt),
        ),
      ),
    );

    return {
      success: true,
      readAt,
      unreadCount: 0,
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

  private async buildNotificationItems(
    storeId: number,
  ): Promise<NotificationDraft[]> {
    const now = Date.now();
    const upcomingWindowEnd = this.getDayEnd(now + DAY_MS * 7);

    const [
      productRows,
      overdueAccounts,
      subscription,
      activePromotions,
      pendingWithdrawals,
      upcomingLeaves,
    ] = await Promise.all([
      this.prisma.product.findMany({
        where: {
          storeId,
          isActive: true,
        },
        select: {
          id: true,
          name: true,
          stock: true,
          alertThreshold: true,
          updatedAt: true,
        },
        orderBy: [{ stock: 'asc' }, { updatedAt: 'desc' }],
        take: LOW_STOCK_SOURCE_LIMIT,
      }),
      this.prisma.financeAccountRecord.findMany({
        where: {
          storeId,
          status: FinanceAccountStatus.overdue,
        },
        select: {
          id: true,
          counterpart: true,
          remaining: true,
          dueDate: true,
          updatedAt: true,
        },
        orderBy: [{ dueDate: 'asc' }, { updatedAt: 'desc' }],
        take: SOURCE_LIMIT,
      }),
      this.prisma.storeSubscription.findUnique({
        where: { storeId },
        select: {
          id: true,
          planName: true,
          status: true,
          expiresAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.marketingPromotion.findMany({
        where: {
          storeId,
          enabled: true,
          endAt: {
            gte: new Date(now),
            lte: new Date(upcomingWindowEnd),
          },
        },
        select: {
          id: true,
          name: true,
          endAt: true,
          updatedAt: true,
        },
        orderBy: [{ endAt: 'asc' }, { updatedAt: 'desc' }],
        take: SOURCE_LIMIT,
      }),
      this.prisma.partnerWithdrawal.findMany({
        where: {
          storeId,
          status: PartnerWithdrawalStatus.pending,
        },
        select: {
          id: true,
          beanAmount: true,
          appliedAt: true,
        },
        orderBy: [{ appliedAt: 'desc' }, { id: 'desc' }],
        take: SOURCE_LIMIT,
      }),
      this.prisma.employeeLeave.findMany({
        where: {
          storeId,
          startDate: {
            gte: new Date(now),
            lte: new Date(upcomingWindowEnd),
          },
        },
        select: {
          id: true,
          employeeName: true,
          startDate: true,
          createdAt: true,
        },
        orderBy: [{ startDate: 'asc' }, { id: 'asc' }],
        take: SOURCE_LIMIT,
      }),
    ]);

    const lowStockProducts = (productRows as ProductAlertRow[])
      .filter((product) => product.stock <= product.alertThreshold)
      .slice(0, SOURCE_LIMIT);

    const drafts: NotificationDraft[] = [];

    for (const product of lowStockProducts) {
      drafts.push({
        id: `inventory:product:${product.id}`,
        type: 'inventory',
        title: `${product.name} 库存不足`,
        content: `当前库存 ${product.stock}，已低于预警阈值 ${product.alertThreshold}，请及时补货。`,
        bizType: 'inventory',
        bizId: String(product.id),
        actionUrl: '/stocktaking',
        createdAt: product.updatedAt.getTime(),
      });
    }

    for (const account of overdueAccounts as OverdueAccountRow[]) {
      const dueDateText = account.dueDate
        ? this.formatMonthDay(account.dueDate.getTime())
        : '已到期';
      drafts.push({
        id: `finance:account:${account.id}`,
        type: 'finance',
        title: `${account.counterpart} 账款已逾期`,
        content: `剩余应收应付款 ${this.formatMoney(toDecimalNumber(account.remaining))}，到期时间 ${dueDateText}。`,
        bizType: 'finance_account',
        bizId: String(account.id),
        actionUrl: '/accounts-management',
        createdAt: account.updatedAt.getTime(),
      });
    }

    const subscriptionRow = subscription as StoreSubscriptionRow | null;
    if (
      subscriptionRow?.expiresAt &&
      subscriptionRow.status === StoreSubscriptionStatus.ACTIVE &&
      subscriptionRow.expiresAt.getTime() >= now &&
      subscriptionRow.expiresAt.getTime() <= upcomingWindowEnd &&
      subscriptionRow.planName.trim() !== ''
    ) {
      drafts.push({
        id: `membership:subscription:${subscriptionRow.id}`,
        type: 'membership',
        title: `${subscriptionRow.planName} 即将到期`,
        content: `当前门店订阅将在 ${this.formatMonthDay(subscriptionRow.expiresAt.getTime())} 到期，请及时续费。`,
        bizType: 'store_subscription',
        bizId: String(subscriptionRow.id),
        actionUrl: '/member-center',
        createdAt: subscriptionRow.updatedAt.getTime(),
      });
    }

    for (const promotion of activePromotions as ActivePromotionRow[]) {
      drafts.push({
        id: `marketing:promotion:${promotion.id}`,
        type: 'marketing',
        title: `${promotion.name} 即将结束`,
        content: `营销活动将在 ${this.formatMonthDay(promotion.endAt.getTime())} 结束，注意安排延续或下架。`,
        bizType: 'marketing_promotion',
        bizId: String(promotion.id),
        actionUrl: '/marketing-center',
        createdAt: promotion.updatedAt.getTime(),
      });
    }

    for (const withdrawal of pendingWithdrawals as PendingWithdrawalRow[]) {
      drafts.push({
        id: `withdrawal:partner:${withdrawal.id}`,
        type: 'withdrawal',
        title: '有新的提现申请待处理',
        content: `申请提现 ${withdrawal.beanAmount} 纯利豆，请尽快完成审核。`,
        bizType: 'withdrawal',
        bizId: String(withdrawal.id),
        actionUrl: '/member-center',
        createdAt: withdrawal.appliedAt.getTime(),
      });
    }

    for (const leave of upcomingLeaves as UpcomingLeaveRow[]) {
      drafts.push({
        id: `employee:leave:${leave.id}`,
        type: 'employee',
        title: `${leave.employeeName} 请假即将开始`,
        content: `请假开始时间为 ${this.formatMonthDayTime(leave.startDate.getTime())}，请提前安排排班。`,
        bizType: 'employee_leave',
        bizId: String(leave.id),
        actionUrl: '/employee-management',
        createdAt: leave.createdAt.getTime(),
      });
    }

    return drafts.sort((left, right) => right.createdAt - left.createdAt);
  }

  private async filterUnreadItems(
    storeId: number,
    items: NotificationDraft[],
  ): Promise<NotificationDraft[]> {
    const unreadMap = await this.getUnreadMap(storeId, items);
    return items.filter((item) => unreadMap.get(item.id) === undefined);
  }

  private async getUnreadMap(
    storeId: number,
    items: NotificationDraft[],
  ): Promise<Map<string, number | undefined>> {
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

  private toNotificationItemDto(
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

  private buildNotificationReadKey(
    storeId: number,
    notificationId: string,
  ): string {
    return `${NOTIFICATIONS_READ_KEY_PREFIX}${storeId}:${notificationId}`;
  }

  private normalizePage(page: number | undefined): number {
    if (!page || page < 1) {
      return DEFAULT_PAGE;
    }

    return page;
  }

  private normalizePageSize(pageSize: number | undefined): number {
    if (!pageSize || pageSize < 1) {
      return DEFAULT_PAGE_SIZE;
    }

    return Math.min(pageSize, MAX_PAGE_SIZE);
  }

  private getDayEnd(timestamp: number): number {
    const date = new Date(timestamp);
    date.setHours(23, 59, 59, 999);
    return date.getTime();
  }

  private formatMonthDay(timestamp: number): string {
    const date = new Date(timestamp);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${month}/${day}`;
  }

  private formatMonthDayTime(timestamp: number): string {
    const date = new Date(timestamp);
    const monthDay = this.formatMonthDay(timestamp);
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${monthDay} ${hours}:${minutes}`;
  }

  private formatMoney(amount: number): string {
    return `¥${amount.toFixed(2)}`;
  }
}

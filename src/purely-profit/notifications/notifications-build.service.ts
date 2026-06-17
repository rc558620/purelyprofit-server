import { Injectable } from '@nestjs/common';
import {
  PartnerWithdrawalStatus,
  StoreSubscriptionStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { buildDerivedFinanceAccountStatusWhere } from '../finance/finance-account.query';
import { toDecimalNumber } from '../commerce/commerce.utils';
import {
  DAY_MS,
  LOW_STOCK_SOURCE_LIMIT,
  SOURCE_LIMIT,
} from './notifications.constants';
import type {
  ActivePromotionRow,
  NotificationDraft,
  OverdueAccountRow,
  PendingWithdrawalRow,
  ProductAlertRow,
  StoreSubscriptionRow,
  UpcomingLeaveRow,
} from './notifications.types';
import {
  formatMoney,
  formatMonthDay,
  formatMonthDayTime,
  getDayEnd,
} from './notifications.utils';

@Injectable()
export class NotificationsBuildService {
  constructor(private readonly prisma: PrismaService) {}

  async buildNotificationItems(storeId: number): Promise<NotificationDraft[]> {
    const now = Date.now();
    const upcomingWindowEnd = getDayEnd(now + DAY_MS * 7);

    const [
      productRows,
      overdueAccounts,
      subscription,
      activePromotions,
      pendingWithdrawals,
      upcomingLeaves,
    ]: [
      ProductAlertRow[],
      OverdueAccountRow[],
      StoreSubscriptionRow | null,
      ActivePromotionRow[],
      PendingWithdrawalRow[],
      UpcomingLeaveRow[],
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
        where: buildDerivedFinanceAccountStatusWhere({
          storeId,
          status: 'overdue',
          now,
        }),
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

    const lowStockProducts = productRows
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

    for (const account of overdueAccounts) {
      const dueDateText = account.dueDate
        ? formatMonthDay(account.dueDate.getTime())
        : '已到期';
      drafts.push({
        id: `finance:account:${account.id}`,
        type: 'finance',
        title: `${account.counterpart} 账款已逾期`,
        content: `剩余应收应付款 ${formatMoney(toDecimalNumber(account.remaining))}，到期时间 ${dueDateText}。`,
        bizType: 'finance_account',
        bizId: String(account.id),
        actionUrl: '/accounts-management',
        createdAt: account.updatedAt.getTime(),
      });
    }

    if (
      subscription?.expiresAt &&
      subscription.status === StoreSubscriptionStatus.ACTIVE &&
      subscription.expiresAt.getTime() >= now &&
      subscription.expiresAt.getTime() <= upcomingWindowEnd &&
      subscription.planName.trim() !== ''
    ) {
      drafts.push({
        id: `membership:subscription:${subscription.id}`,
        type: 'membership',
        title: `${subscription.planName} 即将到期`,
        content: `当前门店订阅将在 ${formatMonthDay(subscription.expiresAt.getTime())} 到期，请及时续费。`,
        bizType: 'store_subscription',
        bizId: String(subscription.id),
        actionUrl: '/member-center',
        createdAt: subscription.updatedAt.getTime(),
      });
    }

    for (const promotion of activePromotions) {
      drafts.push({
        id: `marketing:promotion:${promotion.id}`,
        type: 'marketing',
        title: `${promotion.name} 即将结束`,
        content: `营销活动将在 ${formatMonthDay(promotion.endAt.getTime())} 结束，注意安排延续或下架。`,
        bizType: 'marketing_promotion',
        bizId: String(promotion.id),
        actionUrl: '/marketing-center',
        createdAt: promotion.updatedAt.getTime(),
      });
    }

    for (const withdrawal of pendingWithdrawals) {
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

    for (const leave of upcomingLeaves) {
      drafts.push({
        id: `employee:leave:${leave.id}`,
        type: 'employee',
        title: `${leave.employeeName} 请假即将开始`,
        content: `请假开始时间为 ${formatMonthDayTime(leave.startDate.getTime())}，请提前安排排班。`,
        bizType: 'employee_leave',
        bizId: String(leave.id),
        actionUrl: '/employee-management',
        createdAt: leave.createdAt.getTime(),
      });
    }

    return drafts.sort((left, right) => right.createdAt - left.createdAt);
  }
}

import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { FinanceAccountStatus, Prisma, StoreSubscriptionStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../commerce/commerce-access.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { NotificationsBuildService } from './notifications-build.service';
import { NotificationsContextService } from './notifications-context.service';
import { NotificationsReadStateService } from './notifications-read-state.service';
import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  let service: NotificationsService;

  const prismaService = {
    product: {
      findMany: jest.fn(),
    },
    financeAccountRecord: {
      findMany: jest.fn(),
    },
    storeSubscription: {
      findUnique: jest.fn(),
    },
    marketingPromotion: {
      findMany: jest.fn(),
    },
    partnerWithdrawal: {
      findMany: jest.fn(),
    },
    employeeLeave: {
      findMany: jest.fn(),
    },
  };

  const commerceAccessService = {
    resolveSingleStoreId: jest.fn(),
  };

  const redisService = {
    get: jest.fn(),
    set: jest.fn(),
  };

  const user: AuthenticatedUser = {
    id: 1,
    email: 'boss@example.com',
    phone: '13800138000',
    name: '老板',
    createdAt: new Date(2026, 4, 12, 0, 0, 0, 0),
    updatedAt: new Date(2026, 4, 13, 0, 0, 0, 0),
    currentMembership: {
      staffId: 8,
      storeId: 18,
      role: 'OWNER',
      permissions: ['*'],
      isActive: true,
    },
  };

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 4, 14, 15, 0, 0, 0));
    jest.clearAllMocks();
    redisService.set.mockResolvedValue(undefined);
    redisService.get.mockResolvedValue(null);
    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsBuildService,
        NotificationsContextService,
        NotificationsReadStateService,
        NotificationsService,
        { provide: PrismaService, useValue: prismaService },
        { provide: CommerceAccessService, useValue: commerceAccessService },
        { provide: RedisService, useValue: redisService },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function mockNotificationSources() {
    prismaService.product.findMany.mockResolvedValue([
      {
        id: 5,
        name: '可乐',
        stock: 4,
        alertThreshold: 10,
        updatedAt: new Date(2026, 4, 14, 14, 0, 0, 0),
      },
      {
        id: 15,
        name: '雪碧',
        stock: 12,
        alertThreshold: 10,
        updatedAt: new Date(2026, 4, 14, 13, 0, 0, 0),
      },
    ]);
    prismaService.financeAccountRecord.findMany.mockResolvedValue([
      {
        id: 6,
        counterpart: '张三供应商',
        remaining: new Prisma.Decimal('200.00'),
        dueDate: new Date(2026, 4, 13, 0, 0, 0, 0),
        updatedAt: new Date(2026, 4, 14, 12, 0, 0, 0),
        status: FinanceAccountStatus.overdue,
      },
    ]);
    prismaService.storeSubscription.findUnique.mockResolvedValue({
      id: 3,
      planName: '专业版套餐',
      status: StoreSubscriptionStatus.ACTIVE,
      expiresAt: new Date(2026, 4, 18, 23, 59, 59, 999),
      updatedAt: new Date(2026, 4, 14, 11, 30, 0, 0),
    });
    prismaService.marketingPromotion.findMany.mockResolvedValue([
      {
        id: 7,
        name: '夏日活动',
        endAt: new Date(2026, 4, 16, 23, 59, 59, 999),
        updatedAt: new Date(2026, 4, 14, 11, 0, 0, 0),
      },
    ]);
    prismaService.partnerWithdrawal.findMany.mockResolvedValue([
      {
        id: 8,
        beanAmount: 300,
        appliedAt: new Date(2026, 4, 14, 10, 0, 0, 0),
      },
    ]);
    prismaService.employeeLeave.findMany.mockResolvedValue([
      {
        id: 9,
        employeeName: '小李',
        startDate: new Date(2026, 4, 15, 9, 0, 0, 0),
        createdAt: new Date(2026, 4, 14, 9, 0, 0, 0),
      },
    ]);
  }

  it('getUnreadSummary 返回未读数量和最新未读摘要', async () => {
    mockNotificationSources();

    await expect(service.getUnreadSummary(user, {})).resolves.toEqual({
      unreadCount: 6,
      latestItems: [
        {
          id: 'inventory:product:5',
          type: 'inventory',
          title: '可乐 库存不足',
          createdAt: new Date(2026, 4, 14, 14, 0, 0, 0).getTime(),
          actionUrl: '/stocktaking',
        },
        {
          id: 'finance:account:6',
          type: 'finance',
          title: '张三供应商 账款已逾期',
          createdAt: new Date(2026, 4, 14, 12, 0, 0, 0).getTime(),
          actionUrl: '/accounts-management',
        },
        {
          id: 'membership:subscription:3',
          type: 'membership',
          title: '专业版套餐 即将到期',
          createdAt: new Date(2026, 4, 14, 11, 30, 0, 0).getTime(),
          actionUrl: '/member-center',
        },
        {
          id: 'marketing:promotion:7',
          type: 'marketing',
          title: '夏日活动 即将结束',
          createdAt: new Date(2026, 4, 14, 11, 0, 0, 0).getTime(),
          actionUrl: '/marketing-center',
        },
        {
          id: 'withdrawal:partner:8',
          type: 'withdrawal',
          title: '有新的提现申请待处理',
          createdAt: new Date(2026, 4, 14, 10, 0, 0, 0).getTime(),
          actionUrl: '/member-center',
        },
      ],
    });
  });

  it('list 支持未读过滤并返回 readAt', async () => {
    mockNotificationSources();
    redisService.get.mockImplementation(async (key: string) => {
      if (key.endsWith('membership:subscription:3')) {
        return String(new Date(2026, 4, 14, 14, 30, 0, 0).getTime());
      }
      return null;
    });

    await expect(
      service.list(user, { unreadOnly: true, page: 1, pageSize: 10 }),
    ).resolves.toEqual({
      items: [
        {
          id: 'inventory:product:5',
          type: 'inventory',
          title: '可乐 库存不足',
          content: '当前库存 4，已低于预警阈值 10，请及时补货。',
          bizType: 'inventory',
          bizId: '5',
          actionUrl: '/stocktaking',
          createdAt: new Date(2026, 4, 14, 14, 0, 0, 0).getTime(),
        },
        {
          id: 'finance:account:6',
          type: 'finance',
          title: '张三供应商 账款已逾期',
          content: '剩余应收应付款 ¥200.00，到期时间 05/13。',
          bizType: 'finance_account',
          bizId: '6',
          actionUrl: '/accounts-management',
          createdAt: new Date(2026, 4, 14, 12, 0, 0, 0).getTime(),
        },
        {
          id: 'marketing:promotion:7',
          type: 'marketing',
          title: '夏日活动 即将结束',
          content: '营销活动将在 05/16 结束，注意安排延续或下架。',
          bizType: 'marketing_promotion',
          bizId: '7',
          actionUrl: '/marketing-center',
          createdAt: new Date(2026, 4, 14, 11, 0, 0, 0).getTime(),
        },
        {
          id: 'withdrawal:partner:8',
          type: 'withdrawal',
          title: '有新的提现申请待处理',
          content: '申请提现 300 纯利豆，请尽快完成审核。',
          bizType: 'withdrawal',
          bizId: '8',
          actionUrl: '/member-center',
          createdAt: new Date(2026, 4, 14, 10, 0, 0, 0).getTime(),
        },
        {
          id: 'employee:leave:9',
          type: 'employee',
          title: '小李 请假即将开始',
          content: '请假开始时间为 05/15 09:00，请提前安排排班。',
          bizType: 'employee_leave',
          bizId: '9',
          actionUrl: '/employee-management',
          createdAt: new Date(2026, 4, 14, 9, 0, 0, 0).getTime(),
        },
      ],
      unreadCount: 5,
      meta: {
        page: 1,
        pageSize: 10,
        total: 5,
        totalPages: 1,
      },
    });

    await expect(
      service.list(user, { type: 'membership', page: 1, pageSize: 10 }),
    ).resolves.toEqual({
      items: [
        {
          id: 'membership:subscription:3',
          type: 'membership',
          title: '专业版套餐 即将到期',
          content: '当前门店订阅将在 05/18 到期，请及时续费。',
          bizType: 'store_subscription',
          bizId: '3',
          actionUrl: '/member-center',
          createdAt: new Date(2026, 4, 14, 11, 30, 0, 0).getTime(),
          readAt: new Date(2026, 4, 14, 14, 30, 0, 0).getTime(),
        },
      ],
      unreadCount: 5,
      meta: {
        page: 1,
        pageSize: 10,
        total: 1,
        totalPages: 1,
      },
    });
  });

  it('markRead 标记指定通知已读并返回最新未读数', async () => {
    mockNotificationSources();

    await expect(
      service.markRead(user, 'inventory:product:5', {}),
    ).resolves.toEqual({
      success: true,
      id: 'inventory:product:5',
      readAt: new Date(2026, 4, 14, 15, 0, 0, 0).getTime(),
      unreadCount: 5,
    });

    expect(redisService.set).toHaveBeenCalledWith(
      'notifications:read:18:inventory:product:5',
      String(new Date(2026, 4, 14, 15, 0, 0, 0).getTime()),
    );
  });

  it('markRead 在通知不存在时抛 NotFoundException', async () => {
    mockNotificationSources();

    await expect(service.markRead(user, 'missing', {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('markAllRead 标记当前门店全部通知已读', async () => {
    mockNotificationSources();

    await expect(service.markAllRead(user, {})).resolves.toEqual({
      success: true,
      readAt: new Date(2026, 4, 14, 15, 0, 0, 0).getTime(),
      unreadCount: 0,
    });
    expect(redisService.set).toHaveBeenCalledTimes(6);
  });
});

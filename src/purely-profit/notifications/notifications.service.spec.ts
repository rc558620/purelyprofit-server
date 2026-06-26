import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  FinanceAccountStatus,
  Prisma,
  StoreSubscriptionStatus,
} from '@prisma/client';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../commerce/commerce-access.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { NotificationsBuildService } from './notifications-build.service';
import { NotificationsContextService } from './notifications-context.service';
import { NotificationsReadStateService } from './notifications-read-state.service';
import { NotificationsService } from './notifications.service';
import { NOTIFICATIONS_READ_TTL_SECONDS } from './notifications.constants';

describe('NotificationsService', () => {
  let service: NotificationsService;

  const pipelineExec = jest.fn();
  const pipelineGet = jest.fn().mockReturnThis();
  const pipelineSet = jest.fn().mockReturnThis();

  const mockPipeline = {
    get: pipelineGet,
    set: pipelineSet,
    exec: pipelineExec,
  };

  const mockRedisClient = {
    pipeline: jest.fn().mockReturnValue(mockPipeline),
  };

  const prismaService = {
    $queryRaw: jest.fn(),
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
    getClient: jest.fn().mockReturnValue(mockRedisClient),
  };

  const user: AuthenticatedUser = {
    id: 1,
    email: 'boss@example.com',
    phone: '13800138000',
    name: '老板',
    createdAt: new Date(2026, 4, 12, 0, 0, 0, 0),
    updatedAt: new Date(2026, 4, 13, 0, 0, 0, 0),
    lastActiveAt: null,
    currentMembership: {
      staffId: 8,
      storeId: 18,
      role: 'owner',
      permissions: ['*'],
      isActive: true,
      subjectType: 'owner',
      linkedEmployeeId: null,
      subAccountId: null,
      subAccountRole: null,
      subAccountStatus: null,
      subAccountAssigned: false,
      canAccessHome: true,
      canUseHandover: true,
    },
  };

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 4, 14, 15, 0, 0, 0));
    jest.clearAllMocks();
    redisService.set.mockResolvedValue(undefined);
    redisService.get.mockResolvedValue(null);
    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    pipelineExec.mockResolvedValue([]);

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
    // 低库存商品 - 使用 $queryRaw 返回 snake_case 字段
    prismaService.$queryRaw.mockResolvedValue([
      {
        id: 5,
        name: '可乐',
        stock: 4,
        alert_threshold: 10,
        updated_at: new Date(2026, 4, 14, 14, 0, 0, 0),
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
      status: StoreSubscriptionStatus.active,
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

  /**
   * 模拟 Redis Pipeline 返回已读状态的 exec 结果
   * 每个元素为 [error, value] 元组
   */
  function mockPipelineExecWithReadState(
    readState: Record<string, string | null>,
  ) {
    pipelineExec.mockImplementation(() => {
      // 收集 pipeline.get 调用过的 key
      const keys: string[] = [];
      for (const call of pipelineGet.mock.calls) {
        // calls 中存储的是传给 pipeline.get(key) 的参数
        keys.push(call[0] as string);
      }

      const results = keys.map((key) => {
        // 从 key 中提取 notificationId: notifications:read:18:inventory:product:5
        const parts = key.split(':');
        const notificationId = parts.slice(3).join(':');
        const value = readState[notificationId] ?? null;
        return [null, value];
      });

      return Promise.resolve(results);
    });
  }

  it('getUnreadSummary 返回未读数量和最新未读摘要', async () => {
    mockNotificationSources();
    // 模拟全部未读
    mockPipelineExecWithReadState({});

    const result = await service.getUnreadSummary(user, {});

    expect(result.unreadCount).toBe(6);
    expect(result.latestItems).toHaveLength(5);
    expect(result.latestItems[0]).toEqual({
      id: 'inventory:product:5',
      type: 'inventory',
      title: '可乐 库存不足',
      createdAt: new Date(2026, 4, 14, 14, 0, 0, 0).getTime(),
      actionUrl: '/stocktaking',
    });

    expect(prismaService.financeAccountRecord.findMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        storeId: 18,
        dueDate: { lt: new Date(2026, 4, 14, 15, 0, 0, 0) },
        paidAmount: 0,
        remaining: { gt: 0 },
      }),
      select: {
        id: true,
        counterpart: true,
        remaining: true,
        dueDate: true,
        updatedAt: true,
      },
      orderBy: [{ dueDate: 'asc' }, { updatedAt: 'desc' }],
      take: 20,
    });
  });

  it('list 支持未读过滤并返回 readAt', async () => {
    mockNotificationSources();
    const membershipReadAt = String(
      new Date(2026, 4, 14, 14, 30, 0, 0).getTime(),
    );
    mockPipelineExecWithReadState({
      'membership:subscription:3': membershipReadAt,
    });

    const unreadResult = await service.list(user, {
      unreadOnly: true,
      page: 1,
      pageSize: 10,
    });

    expect(unreadResult.items).toHaveLength(5);
    expect(unreadResult.unreadCount).toBe(5);

    // membership 通知不出现（已读）
    expect(
      unreadResult.items.find((i) => i.id === 'membership:subscription:3'),
    ).toBeUndefined();

    // 列出所有通知（包含已读的）
    mockPipelineExecWithReadState({
      'membership:subscription:3': membershipReadAt,
    });
    const allResult = await service.list(user, {
      type: 'membership',
      page: 1,
      pageSize: 10,
    });

    expect(allResult.items).toHaveLength(1);
    expect(allResult.items[0].readAt).toBe(Number(membershipReadAt));
    expect(allResult.unreadCount).toBe(5);
  });

  it('markRead 标记指定通知已读并返回最新未读数', async () => {
    mockNotificationSources();
    const readAt = new Date(2026, 4, 14, 15, 0, 0, 0).getTime();
    // markRead 后重新读取 unreadMap 时，inventory:product:5 已标记为已读
    mockPipelineExecWithReadState({
      'inventory:product:5': String(readAt),
    });

    const result = await service.markRead(user, 'inventory:product:5', {});

    expect(result.success).toBe(true);
    expect(result.id).toBe('inventory:product:5');
    expect(result.readAt).toBe(readAt);
    expect(result.unreadCount).toBe(5);

    // 验证 redisService.set 被调用且带 TTL（markRead 使用单条 set）
    expect(redisService.set).toHaveBeenCalledWith(
      'notifications:read:18:inventory:product:5',
      String(readAt),
      NOTIFICATIONS_READ_TTL_SECONDS,
    );
  });

  it('markRead 在通知不存在时抛 NotFoundException', async () => {
    mockNotificationSources();
    mockPipelineExecWithReadState({});

    await expect(service.markRead(user, 'missing', {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('markAllRead 标记当前门店全部通知已读', async () => {
    mockNotificationSources();
    mockPipelineExecWithReadState({});

    const result = await service.markAllRead(user, {});

    expect(result.success).toBe(true);
    expect(result.readAt).toBe(new Date(2026, 4, 14, 15, 0, 0, 0).getTime());
    expect(result.unreadCount).toBe(0);

    // 验证 pipeline.set 被调用 6 次（6 条通知）且带 EX + TTL
    expect(pipelineSet).toHaveBeenCalledTimes(6);
    for (const call of pipelineSet.mock.calls) {
      expect(call[2]).toBe('EX');
      expect(call[3]).toBe(NOTIFICATIONS_READ_TTL_SECONDS);
    }
  });

  it('缓存层命中时跳过数据库查询', async () => {
    const cachedItems = [
      {
        id: 'inventory:product:5',
        type: 'inventory' as const,
        title: '可乐 库存不足',
        content: '当前库存 4，已低于预警阈值 10，请及时补货。',
        bizType: 'inventory',
        bizId: '5',
        actionUrl: '/stocktaking',
        createdAt: new Date(2026, 4, 14, 14, 0, 0, 0).getTime(),
      },
    ];
    redisService.get.mockResolvedValue(JSON.stringify(cachedItems));
    mockPipelineExecWithReadState({});

    const result = await service.getUnreadSummary(user, {});

    expect(result.unreadCount).toBe(1);
    // 不应调用数据库
    expect(prismaService.$queryRaw).not.toHaveBeenCalled();
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { PermissionsGuard } from '../access-control/guards/permissions.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

const ALLOW_GUARD = { canActivate: jest.fn(() => true) };

describe('NotificationsController', () => {
  let controller: NotificationsController;

  const notificationsService = {
    getUnreadSummary: jest.fn(),
    list: jest.fn(),
    markRead: jest.fn(),
    markAllRead: jest.fn(),
  };

  const user: AuthenticatedUser = {
    id: 1,
    email: 'boss@example.com',
    phone: '13800138000',
    name: '老板',
    createdAt: new Date('2026-05-12T00:00:00.000Z'),
    updatedAt: new Date('2026-05-13T00:00:00.000Z'),
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
    jest.clearAllMocks();
    const moduleBuilder = Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [
        { provide: NotificationsService, useValue: notificationsService },
      ],
    });
    moduleBuilder.overrideGuard(JwtAuthGuard).useValue(ALLOW_GUARD);
    moduleBuilder.overrideGuard(PermissionsGuard).useValue(ALLOW_GUARD);
    const module: TestingModule = await moduleBuilder.compile();

    controller = module.get<NotificationsController>(NotificationsController);
  });

  it('getUnreadSummary 透传用户和 query', async () => {
    const query = { storeId: 18 };
    const response = {
      unreadCount: 2,
      latestItems: [
        {
          id: 'inventory:product:5',
          type: 'inventory' as const,
          title: '可乐 库存不足',
          createdAt: 1747212600000,
          actionUrl: '/stocktaking',
        },
      ],
    };
    notificationsService.getUnreadSummary.mockResolvedValue(response);

    await expect(controller.getUnreadSummary(user, query)).resolves.toEqual(
      response,
    );
    expect(notificationsService.getUnreadSummary).toHaveBeenCalledWith(
      user,
      query,
    );
  });

  it('list 透传用户和 query', async () => {
    const query = { storeId: 18, page: 1, pageSize: 20, unreadOnly: true };
    const response = {
      items: [],
      unreadCount: 0,
      meta: {
        page: 1,
        pageSize: 20,
        total: 0,
        totalPages: 0,
      },
    };
    notificationsService.list.mockResolvedValue(response);

    await expect(controller.list(user, query)).resolves.toEqual(response);
    expect(notificationsService.list).toHaveBeenCalledWith(user, query);
  });

  it('markRead 透传用户、通知 id 和 query', async () => {
    const query = { storeId: 18 };
    const response = {
      success: true,
      id: 'inventory:product:5',
      readAt: 1747216200000,
      unreadCount: 1,
    };
    notificationsService.markRead.mockResolvedValue(response);

    await expect(
      controller.markRead(user, 'inventory:product:5', query),
    ).resolves.toEqual(response);
    expect(notificationsService.markRead).toHaveBeenCalledWith(
      user,
      'inventory:product:5',
      query,
    );
  });

  it('markAllRead 透传用户和 query', async () => {
    const query = { storeId: 18 };
    const response = {
      success: true,
      readAt: 1747216200000,
      unreadCount: 0,
    };
    notificationsService.markAllRead.mockResolvedValue(response);

    await expect(controller.markAllRead(user, query)).resolves.toEqual(
      response,
    );
    expect(notificationsService.markAllRead).toHaveBeenCalledWith(user, query);
  });
});

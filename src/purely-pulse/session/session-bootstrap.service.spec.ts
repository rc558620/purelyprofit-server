import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { PulseStoreContextService } from '../pulse-store-context.service';
import { SessionBootstrapService } from './session-bootstrap.service';
import { SessionNotificationService } from './session-notification.service';

describe('SessionBootstrapService', () => {
  let service: SessionBootstrapService;

  const prismaService = {
    user: {
      findUnique: jest.fn(),
    },
    storeMembershipProfile: {
      findUnique: jest.fn(),
    },
  };

  const pulseStoreContextService = {
    resolveTargetStore: jest.fn(),
  };

  const sessionNotificationService = {
    countUnreadNotifications: jest.fn(),
  };

  const redisService = {
    getJson: jest.fn().mockResolvedValue(null),
    setJson: jest.fn().mockResolvedValue(undefined),
  };

  const user: AuthenticatedUser = {
    id: 101,
    email: 'dev@example.com',
    phone: '13800138000',
    name: '开发者',
    createdAt: new Date('2026-05-12T00:00:00.000Z'),
    updatedAt: new Date('2026-05-13T00:00:00.000Z'),
    pulseMode: 'normal',
    isPulseDeveloper: true,
    currentMembership: null,
  };

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-21T12:00:00.000Z'));
    jest.clearAllMocks();
    redisService.getJson.mockResolvedValue(null);
    redisService.setJson.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionBootstrapService,
        { provide: PrismaService, useValue: prismaService },
        { provide: RedisService, useValue: redisService },
        {
          provide: PulseStoreContextService,
          useValue: pulseStoreContextService,
        },
        {
          provide: SessionNotificationService,
          useValue: sessionNotificationService,
        },
      ],
    }).compile();

    service = module.get<SessionBootstrapService>(SessionBootstrapService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('bootstrap 命中缓存时直接返回缓存结果并跳过数据库查询', async () => {
    const cachedResponse = {
      mode: 'normal' as const,
      user: {
        id: 101,
        phone: '13800138000',
        name: '开发者',
        avatar: 'https://example.com/avatar.png',
        verified: false,
      },
      store: {
        id: 18,
        name: '纯利宝南山店',
        address: '深圳市南山区',
      },
      membership: {
        isActive: true,
        planId: 'quarterly',
        planName: '季度会员',
        remainingDays: 4,
        expiresAt: new Date('2026-05-25T00:00:00.000Z'),
      },
      unreadNotificationCount: 9,
      targetStoreSelected: true,
      hasOnboarded: true,
    };
    pulseStoreContextService.resolveTargetStore.mockResolvedValue({
      store: {
        id: 18,
        name: '纯利宝南山店',
        address: '深圳市南山区',
        contactPhone: '0755-12345678',
        ownerId: 301,
        ownerName: '张三',
      },
      source: 'selected',
    });
    redisService.getJson.mockResolvedValue(cachedResponse);

    await expect(service.bootstrap(user)).resolves.toEqual(cachedResponse);
    expect(prismaService.user.findUnique).not.toHaveBeenCalled();
    expect(
      prismaService.storeMembershipProfile.findUnique,
    ).not.toHaveBeenCalled();
    expect(
      sessionNotificationService.countUnreadNotifications,
    ).not.toHaveBeenCalled();
  });

  it('bootstrap 按目标门店返回观察态摘要并聚合会员与提醒信息', async () => {
    prismaService.user.findUnique.mockResolvedValue({
      id: 101,
      name: '开发者',
      avatar: 'https://example.com/avatar.png',
      realName: null,
      idNumber: null,
    });
    pulseStoreContextService.resolveTargetStore.mockResolvedValue({
      store: {
        id: 18,
        name: '纯利宝南山店',
        address: '深圳市南山区',
        contactPhone: '0755-12345678',
        ownerId: 301,
        ownerName: '张三',
      },
      source: 'selected',
    });
    prismaService.storeMembershipProfile.findUnique.mockResolvedValue({
      currentPlanId: 'quarterly',
      expiresAt: new Date('2026-05-25T00:00:00.000Z'),
      orders: [{ planName: '季度会员' }],
    });
    sessionNotificationService.countUnreadNotifications.mockResolvedValue(9);

    await expect(service.bootstrap(user)).resolves.toEqual({
      mode: 'normal',
      user: {
        id: 101,
        phone: '13800138000',
        name: '开发者',
        avatar: 'https://example.com/avatar.png',
        verified: false,
      },
      store: {
        id: 18,
        name: '纯利宝南山店',
        address: '深圳市南山区',
      },
      membership: {
        isActive: true,
        planId: 'quarterly',
        planName: '季度会员',
        remainingDays: 4,
        expiresAt: new Date('2026-05-25T00:00:00.000Z'),
      },
      unreadNotificationCount: 9,
      targetStoreSelected: true,
      hasOnboarded: true,
    });
    expect(pulseStoreContextService.resolveTargetStore).toHaveBeenCalledWith(
      user,
    );
    expect(
      prismaService.storeMembershipProfile.findUnique,
    ).toHaveBeenCalledWith({
      where: { storeId: 18 },
      select: {
        currentPlanId: true,
        expiresAt: true,
        orders: {
          where: { status: 'paid' },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 1,
          select: { planName: true },
        },
      },
    });
    expect(
      sessionNotificationService.countUnreadNotifications,
    ).toHaveBeenCalledWith(18);
  });

  it('bootstrap 未选中目标门店时返回空门店态且跳过聚合查询', async () => {
    prismaService.user.findUnique.mockResolvedValue({
      id: 101,
      name: '开发者',
      avatar: null,
      realName: '研发同学',
      idNumber: '440301199001011234',
    });
    pulseStoreContextService.resolveTargetStore.mockResolvedValue({
      store: null,
      source: null,
    });

    await expect(service.bootstrap(user)).resolves.toEqual({
      mode: 'normal',
      user: {
        id: 101,
        phone: '13800138000',
        name: '开发者',
        avatar: '',
        verified: true,
      },
      store: null,
      membership: {
        isActive: false,
        planId: null,
        planName: null,
        remainingDays: 0,
        expiresAt: null,
      },
      unreadNotificationCount: 0,
      targetStoreSelected: false,
      hasOnboarded: false,
    });
    expect(
      prismaService.storeMembershipProfile.findUnique,
    ).not.toHaveBeenCalled();
    expect(
      sessionNotificationService.countUnreadNotifications,
    ).not.toHaveBeenCalled();
  });

  it('bootstrap 当前用户不存在时抛错', async () => {
    prismaService.user.findUnique.mockResolvedValue(null);

    await expect(service.bootstrap(user)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

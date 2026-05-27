import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { SessionBootstrapService } from './session-bootstrap.service';
import { SessionService } from './session.service';
import { SessionStoreService } from './session-store.service';

describe('SessionService', () => {
  let service: SessionService;

  const sessionBootstrapService = {
    bootstrap: jest.fn(),
  };

  const sessionStoreService = {
    switchCurrentStore: jest.fn(),
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
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionService,
        {
          provide: SessionBootstrapService,
          useValue: sessionBootstrapService,
        },
        {
          provide: SessionStoreService,
          useValue: sessionStoreService,
        },
      ],
    }).compile();

    service = module.get<SessionService>(SessionService);
  });

  it('bootstrap 透传给 SessionBootstrapService', async () => {
    const bootstrapResponse = {
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
    sessionBootstrapService.bootstrap.mockResolvedValue(bootstrapResponse);

    await expect(service.bootstrap(user)).resolves.toEqual(bootstrapResponse);
    expect(sessionBootstrapService.bootstrap).toHaveBeenCalledWith(user);
  });

  it('bootstrap 保留子 service 抛错语义', async () => {
    const error = new NotFoundException('用户不存在');
    sessionBootstrapService.bootstrap.mockRejectedValue(error);

    await expect(service.bootstrap(user)).rejects.toBe(error);
    expect(sessionBootstrapService.bootstrap).toHaveBeenCalledWith(user);
  });

  it('switchCurrentStore 透传给 SessionStoreService', async () => {
    const switchResponse = {
      success: true,
      store: {
        id: 66,
        name: '纯利宝福田店',
        address: '深圳市福田区',
      },
    };
    sessionStoreService.switchCurrentStore.mockResolvedValue(switchResponse);

    await expect(service.switchCurrentStore(user, 66)).resolves.toEqual(
      switchResponse,
    );
    expect(sessionStoreService.switchCurrentStore).toHaveBeenCalledWith(
      user,
      66,
    );
  });
});

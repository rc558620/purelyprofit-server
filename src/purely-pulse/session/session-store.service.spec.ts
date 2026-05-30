import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { CacheInvalidatorService } from '../../redis/cache-invalidator.service';
import { PulseStoreContextService } from '../pulse-store-context.service';
import { SessionStoreService } from './session-store.service';

describe('SessionStoreService', () => {
  let service: SessionStoreService;

  const pulseStoreContextService = {
    switchTargetStore: jest.fn(),
  };

  const cacheInvalidatorService = {
    invalidatePulseSessionBootstrapByUser: jest.fn(),
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
        SessionStoreService,
        {
          provide: PulseStoreContextService,
          useValue: pulseStoreContextService,
        },
        {
          provide: CacheInvalidatorService,
          useValue: cacheInvalidatorService,
        },
      ],
    }).compile();

    service = module.get<SessionStoreService>(SessionStoreService);
  });

  it('switchCurrentStore 返回切换后的目标门店摘要', async () => {
    pulseStoreContextService.switchTargetStore.mockResolvedValue({
      id: 66,
      name: '纯利宝福田店',
      address: '深圳市福田区',
      contactPhone: null,
      ownerId: 302,
      ownerName: '李四',
    });

    await expect(service.switchCurrentStore(user, 66)).resolves.toEqual({
      success: true,
      store: {
        id: 66,
        name: '纯利宝福田店',
        address: '深圳市福田区',
      },
    });
    expect(pulseStoreContextService.switchTargetStore).toHaveBeenCalledWith(
      user,
      66,
    );
    expect(
      cacheInvalidatorService.invalidatePulseSessionBootstrapByUser,
    ).toHaveBeenCalledWith(101);
  });

  it('switchCurrentStore 保留子上下文 service 抛错语义', async () => {
    const error = new ForbiddenException('无权查看该门店，或门店不存在');
    pulseStoreContextService.switchTargetStore.mockRejectedValue(error);

    await expect(service.switchCurrentStore(user, 77)).rejects.toBe(error);
    expect(pulseStoreContextService.switchTargetStore).toHaveBeenCalledWith(
      user,
      77,
    );
    expect(
      cacheInvalidatorService.invalidatePulseSessionBootstrapByUser,
    ).not.toHaveBeenCalled();
  });
});

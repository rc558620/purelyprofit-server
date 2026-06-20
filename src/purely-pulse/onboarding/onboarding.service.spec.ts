import { Test, TestingModule } from '@nestjs/testing';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { PulseDevModeService } from '../dev-mode/pulse-dev-mode.service';
import { PulseStoreContextService } from '../pulse-store-context.service';
import { OnboardingStatusService } from './onboarding-status.service';
import { OnboardingService } from './onboarding.service';

describe('OnboardingService', () => {
  let service: OnboardingService;

  const devModeService = {
    isEnabled: jest.fn(),
    buildOnboardingStatus: jest.fn(),
  };

  const statusService = {
    getStatus: jest.fn(),
  };

  const developerUser: AuthenticatedUser = {
    id: 101,
    email: 'dev@example.com',
    phone: '13800138000',
    name: '开发者',
    createdAt: new Date('2026-05-12T00:00:00.000Z'),
    updatedAt: new Date('2026-05-13T00:00:00.000Z'),
    pulseMode: 'developer',
    isPulseDeveloper: true,
    currentMembership: null,
  };

  const normalUser: AuthenticatedUser = {
    id: 102,
    email: 'merchant@example.com',
    phone: '13900139000',
    name: '老板',
    createdAt: new Date('2026-05-12T00:00:00.000Z'),
    updatedAt: new Date('2026-05-13T00:00:00.000Z'),
    pulseMode: 'normal',
    isPulseDeveloper: false,
    currentMembership: {
      storeId: 18,
      subjectType: 'owner',
      role: 'OWNER',
      staffId: 88,
      linkedEmployeeId: null,
      subAccountId: null,
      subAccountRole: null,
      subAccountStatus: null,
      subAccountAssigned: false,
      canAccessHome: true,
      canUseHandover: true,
      permissions: ['*'],
      isActive: true,
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OnboardingService,
        { provide: OnboardingStatusService, useValue: statusService },
        { provide: PulseDevModeService, useValue: devModeService },
      ],
    }).compile();

    service = module.get<OnboardingService>(OnboardingService);
  });

  it('getStatus 在开发者模式下返回 dev-mode mock 数据', async () => {
    const mockResponse = {
      isCompleted: true,
      steps: {
        hasRegistered: true,
        hasVerifiedRealName: true,
        hasCreatedStore: true,
        hasMembership: true,
      },
      targetStatus: {
        isReady: true,
        storeSelected: false,
        merchantVerified: true,
        membershipActive: true,
        storeId: null,
        storeName: 'Pulse 开发者模式',
      },
      storeId: null,
      storeName: 'Pulse 开发者模式',
    };
    devModeService.isEnabled.mockReturnValue(true);
    devModeService.buildOnboardingStatus.mockReturnValue(mockResponse);

    const result = await service.getStatus(developerUser);

    expect(result).toEqual(mockResponse);
    expect(devModeService.isEnabled).toHaveBeenCalledWith(developerUser);
    expect(devModeService.buildOnboardingStatus).toHaveBeenCalled();
    expect(statusService.getStatus).not.toHaveBeenCalled();
  });

  it('getStatus 在非开发者模式下走正常数据库查询路径', async () => {
    const mockResponse = {
      isCompleted: false,
      steps: {
        hasRegistered: true,
        hasVerifiedRealName: true,
        hasCreatedStore: true,
        hasMembership: false,
      },
      targetStatus: {
        isReady: false,
        storeSelected: true,
        merchantVerified: true,
        membershipActive: false,
        storeId: 18,
        storeName: '纯利宝南山店',
      },
      storeId: 18,
      storeName: '纯利宝南山店',
    };
    devModeService.isEnabled.mockReturnValue(false);
    statusService.getStatus.mockResolvedValue(mockResponse);

    const result = await service.getStatus(normalUser);

    expect(result).toEqual(mockResponse);
    expect(devModeService.isEnabled).toHaveBeenCalledWith(normalUser);
    expect(devModeService.buildOnboardingStatus).not.toHaveBeenCalled();
    expect(statusService.getStatus).toHaveBeenCalledWith(normalUser);
  });
});

describe('OnboardingStatusService', () => {
  let service: OnboardingStatusService;

  const prismaService = {
    user: {
      findUnique: jest.fn(),
    },
    storeMembershipProfile: {
      findUnique: jest.fn(),
    },
  };

  const redisService = {
    getOrLoadRefreshableJson: jest.fn(),
  };

  const pulseStoreContextService = {
    resolveTargetStore: jest.fn(),
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
    redisService.getOrLoadRefreshableJson.mockImplementation(
      async ({ loadValue }: { loadValue: () => Promise<unknown> }) =>
        loadValue(),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OnboardingStatusService,
        { provide: PrismaService, useValue: prismaService },
        { provide: RedisService, useValue: redisService },
        {
          provide: PulseStoreContextService,
          useValue: pulseStoreContextService,
        },
      ],
    }).compile();

    service = module.get<OnboardingStatusService>(OnboardingStatusService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('getStatus 使用目标商家 ownerId 判断实名状态并返回新旧并行字段', async () => {
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
    prismaService.user.findUnique.mockResolvedValue({
      realName: '张老板',
      idNumber: '440301199001011234',
    });
    prismaService.storeMembershipProfile.findUnique.mockResolvedValue({
      currentPlanId: 'quarterly',
      startsAt: new Date('2026-05-01T00:00:00.000Z'),
      expiresAt: new Date('2026-05-30T00:00:00.000Z'),
    });

    await expect(service.getStatus(user)).resolves.toEqual({
      isCompleted: true,
      steps: {
        hasRegistered: true,
        hasVerifiedRealName: true,
        hasCreatedStore: true,
        hasMembership: true,
      },
      targetStatus: {
        isReady: true,
        storeSelected: true,
        merchantVerified: true,
        membershipActive: true,
        storeId: 18,
        storeName: '纯利宝南山店',
      },
      storeId: 18,
      storeName: '纯利宝南山店',
    });
    expect(prismaService.user.findUnique).toHaveBeenCalledWith({
      where: { id: 301 },
      select: { realName: true, idNumber: true },
    });
    expect(redisService.getOrLoadRefreshableJson).toHaveBeenCalledWith(
      expect.objectContaining({
        cacheKey: 'pulse:onboarding:status:user:101:mode:normal:store:18',
        ttlSeconds: 20,
      }),
    );
  });

  it('getStatus 未选中目标商家时返回未完成态', async () => {
    pulseStoreContextService.resolveTargetStore.mockResolvedValue({
      store: null,
      source: null,
    });

    await expect(service.getStatus(user)).resolves.toEqual({
      isCompleted: false,
      steps: {
        hasRegistered: true,
        hasVerifiedRealName: false,
        hasCreatedStore: false,
        hasMembership: false,
      },
      targetStatus: {
        isReady: false,
        storeSelected: false,
        merchantVerified: false,
        membershipActive: false,
        storeId: null,
        storeName: null,
      },
      storeId: null,
      storeName: null,
    });
    expect(prismaService.user.findUnique).not.toHaveBeenCalled();
    expect(
      prismaService.storeMembershipProfile.findUnique,
    ).not.toHaveBeenCalled();
    expect(redisService.getOrLoadRefreshableJson).toHaveBeenCalledWith(
      expect.objectContaining({
        cacheKey: 'pulse:onboarding:status:user:101:mode:normal:store:none',
        ttlSeconds: 20,
      }),
    );
  });

  it('getStatus 目标商家会员过期时 membershipActive 为 false', async () => {
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
    prismaService.user.findUnique.mockResolvedValue({
      realName: '张老板',
      idNumber: '440301199001011234',
    });
    prismaService.storeMembershipProfile.findUnique.mockResolvedValue({
      currentPlanId: 'quarterly',
      startsAt: new Date('2026-02-01T00:00:00.000Z'),
      expiresAt: new Date('2026-05-20T23:59:59.999Z'),
    });

    const result = await service.getStatus(user);

    expect(result.isCompleted).toBe(false);
    expect(result.steps.hasMembership).toBe(false);
    expect(result.targetStatus.membershipActive).toBe(false);
  });

  it('getStatus lifetime 会员即使 expiresAt 已过期也视为有效', async () => {
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
    prismaService.user.findUnique.mockResolvedValue({
      realName: '张老板',
      idNumber: '440301199001011234',
    });
    prismaService.storeMembershipProfile.findUnique.mockResolvedValue({
      currentPlanId: 'lifetime',
      startsAt: new Date('2024-01-01T00:00:00.000Z'),
      expiresAt: new Date('2025-12-31T23:59:59.999Z'),
    });

    const result = await service.getStatus(user);

    expect(result.steps.hasMembership).toBe(true);
    expect(result.targetStatus.membershipActive).toBe(true);
    expect(result.isCompleted).toBe(true);
  });

  it('getStatus legacy yearly + null expiresAt + startsAt 存在时视为 lifetime', async () => {
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
    prismaService.user.findUnique.mockResolvedValue({
      realName: '张老板',
      idNumber: '440301199001011234',
    });
    prismaService.storeMembershipProfile.findUnique.mockResolvedValue({
      currentPlanId: 'yearly',
      startsAt: new Date('2024-01-01T00:00:00.000Z'),
      expiresAt: null,
    });

    const result = await service.getStatus(user);

    expect(result.steps.hasMembership).toBe(true);
    expect(result.targetStatus.membershipActive).toBe(true);
    expect(result.isCompleted).toBe(true);
  });

  it('getStatus yearly + null expiresAt + null startsAt 不视为 lifetime（数据异常）', async () => {
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
    prismaService.user.findUnique.mockResolvedValue({
      realName: '张老板',
      idNumber: '440301199001011234',
    });
    prismaService.storeMembershipProfile.findUnique.mockResolvedValue({
      currentPlanId: 'yearly',
      startsAt: null,
      expiresAt: null,
    });

    const result = await service.getStatus(user);

    expect(result.steps.hasMembership).toBe(false);
    expect(result.targetStatus.membershipActive).toBe(false);
  });
});

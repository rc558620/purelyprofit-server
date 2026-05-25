import { Test, TestingModule } from '@nestjs/testing';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { PulseStoreContextService } from '../pulse-store-context.service';
import { OnboardingStatusService } from './onboarding-status.service';

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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OnboardingStatusService,
        { provide: PrismaService, useValue: prismaService },
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
    expect(prismaService.storeMembershipProfile.findUnique).not.toHaveBeenCalled();
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
      expiresAt: new Date('2026-05-20T23:59:59.999Z'),
    });

    const result = await service.getStatus(user);

    expect(result.isCompleted).toBe(false);
    expect(result.steps.hasMembership).toBe(false);
    expect(result.targetStatus.membershipActive).toBe(false);
  });
});

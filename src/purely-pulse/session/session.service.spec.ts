import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { PulseStoreContextService } from '../pulse-store-context.service';
import { SessionService } from './session.service';

describe('SessionService', () => {
  let service: SessionService;

  const prismaService = {
    user: {
      findUnique: jest.fn(),
    },
    storeMembershipProfile: {
      findUnique: jest.fn(),
    },
    product: {
      findMany: jest.fn(),
    },
    financeAccountRecord: {
      count: jest.fn(),
    },
    partnerWithdrawal: {
      count: jest.fn(),
    },
    employeeLeave: {
      count: jest.fn(),
    },
  };

  const pulseStoreContextService = {
    resolveTargetStore: jest.fn(),
    switchTargetStore: jest.fn(),
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
        SessionService,
        { provide: PrismaService, useValue: prismaService },
        {
          provide: PulseStoreContextService,
          useValue: pulseStoreContextService,
        },
      ],
    }).compile();

    service = module.get<SessionService>(SessionService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('bootstrap 按目标门店返回观察态摘要并保留兼容字段', async () => {
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
    prismaService.product.findMany.mockResolvedValue([
      { stock: 1, alertThreshold: 2 },
      { stock: 5, alertThreshold: 2 },
      { stock: 2, alertThreshold: 2 },
    ]);
    prismaService.financeAccountRecord.count.mockResolvedValue(2);
    prismaService.partnerWithdrawal.count.mockResolvedValue(1);
    prismaService.employeeLeave.count.mockResolvedValue(3);

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
  });

  it('bootstrap 未选中目标门店时返回空门店态且不查询商家聚合数据', async () => {
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
    expect(prismaService.storeMembershipProfile.findUnique).not.toHaveBeenCalled();
    expect(prismaService.product.findMany).not.toHaveBeenCalled();
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
  });

  it('bootstrap 当前用户不存在时抛错', async () => {
    prismaService.user.findUnique.mockResolvedValue(null);

    await expect(service.bootstrap(user)).rejects.toBeInstanceOf(NotFoundException);
  });
});

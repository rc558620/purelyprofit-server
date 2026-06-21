import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  StaffRole,
  StoreSubscriptionStatus,
  SubscriptionPlanCode,
} from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessControlService } from '../access-control/access-control.service';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { SubscriptionsAccessService } from './subscriptions-access.service';
import { SubscriptionsProfileService } from './subscriptions-profile.service';
import { SubscriptionsService } from './subscriptions.service';

describe('SubscriptionsService', () => {
  let service: SubscriptionsService;

  const mockSubscriptionRecord = {
    id: 1,
    storeId: 10,
    planCode: SubscriptionPlanCode.STARTER,
    planName: '基础版',
    status: StoreSubscriptionStatus.ACTIVE,
    maxAccountSeats: 1,
    startsAt: new Date('2026-05-13T10:00:00.000Z'),
    expiresAt: null,
    createdAt: new Date('2026-05-13T10:00:00.000Z'),
    updatedAt: new Date('2026-05-13T10:00:00.000Z'),
  };

  const mockGrowthSubscriptionRecord = {
    ...mockSubscriptionRecord,
    planCode: SubscriptionPlanCode.GROWTH,
    planName: '成长版',
    maxAccountSeats: 2,
  };

  const prismaService = {
    store: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    storeSubscription: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    staff: {
      count: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const accessControlService = {
    resolveCurrentStoreIdByPermission: jest.fn(),
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
      storeId: 10,
      staffId: 100,
      role: StaffRole.OWNER,
      isActive: true,
      permissions: ['*'],
      subjectType: 'owner' as const,
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

    prismaService.$transaction.mockImplementation(
      (callback: (tx: typeof prismaService) => unknown) =>
        callback(prismaService),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionsService,
        SubscriptionsAccessService,
        SubscriptionsProfileService,
        { provide: PrismaService, useValue: prismaService },
        { provide: AccessControlService, useValue: accessControlService },
      ],
    }).compile();

    service = module.get<SubscriptionsService>(SubscriptionsService);
  });

  /* ───── getStoreSubscription ───── */

  describe('getStoreSubscription', () => {
    it('有权限时返回订阅概览', async () => {
      accessControlService.resolveCurrentStoreIdByPermission.mockReturnValue(10);
      prismaService.store.findUnique.mockResolvedValue({ id: 10, maxAccountSeats: 1 });
      prismaService.storeSubscription.findUnique.mockResolvedValue(mockSubscriptionRecord);
      prismaService.staff.count.mockResolvedValue(0);

      const result = await service.getStoreSubscription(user, 10);

      expect(result.planCode).toBe(SubscriptionPlanCode.STARTER);
      expect(result.storeId).toBe(10);
      expect(result.seatSummary.maxAccountSeats).toBe(1);
    });

    it('无权限时抛出 ForbiddenException', async () => {
      accessControlService.resolveCurrentStoreIdByPermission.mockReturnValue(null);

      await expect(service.getStoreSubscription(user, 10)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  /* ───── updateStoreSubscription ───── */

  describe('updateStoreSubscription', () => {
    it('老板升级套餐到 GROWTH 成功', async () => {
      prismaService.store.findFirst.mockResolvedValue({ id: 10 });
      // 事务内：第一次 findUnique 返回当前 STARTER 订阅，第二次返回 upsert 后的 GROWTH 订阅
      prismaService.storeSubscription.findUnique
        .mockResolvedValueOnce(mockSubscriptionRecord)
        .mockResolvedValueOnce(mockGrowthSubscriptionRecord);
      prismaService.store.findUnique.mockResolvedValue({ id: 10, maxAccountSeats: 2 });
      prismaService.staff.count.mockResolvedValue(1);
      prismaService.storeSubscription.upsert.mockResolvedValue({});
      prismaService.store.update.mockResolvedValue({});

      const result = await service.updateStoreSubscription(user, 10, {
        planCode: SubscriptionPlanCode.GROWTH,
      });

      expect(result.planCode).toBe(SubscriptionPlanCode.GROWTH);
      expect(result.seatSummary.maxAccountSeats).toBe(2);
    });

    it('CANCELLED 状态的订阅不允许直接变更套餐', async () => {
      prismaService.store.findFirst.mockResolvedValue({ id: 10 });
      prismaService.storeSubscription.findUnique.mockResolvedValue({
        ...mockSubscriptionRecord,
        status: StoreSubscriptionStatus.CANCELLED,
      });

      await expect(
        service.updateStoreSubscription(user, 10, {
          planCode: SubscriptionPlanCode.GROWTH,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('EXPIRED 状态的订阅允许续费升级', async () => {
      prismaService.store.findFirst.mockResolvedValue({ id: 10 });
      prismaService.storeSubscription.findUnique
        .mockResolvedValueOnce({
          ...mockSubscriptionRecord,
          status: StoreSubscriptionStatus.EXPIRED,
        })
        .mockResolvedValueOnce(mockGrowthSubscriptionRecord);
      prismaService.store.findUnique.mockResolvedValue({ id: 10, maxAccountSeats: 2 });
      prismaService.staff.count.mockResolvedValue(0);
      prismaService.storeSubscription.upsert.mockResolvedValue({});
      prismaService.store.update.mockResolvedValue({});

      const result = await service.updateStoreSubscription(user, 10, {
        planCode: SubscriptionPlanCode.GROWTH,
      });

      expect(result.planCode).toBe(SubscriptionPlanCode.GROWTH);
    });

    it('缩容到低于已激活席位数时抛出 ConflictException', async () => {
      prismaService.store.findFirst.mockResolvedValue({ id: 10 });
      prismaService.storeSubscription.findUnique.mockResolvedValue({
        ...mockSubscriptionRecord,
        planCode: SubscriptionPlanCode.GROWTH,
        maxAccountSeats: 2,
      });
      prismaService.store.findUnique.mockResolvedValue({ id: 10, maxAccountSeats: 2 });
      prismaService.staff.count.mockResolvedValue(2);

      await expect(
        service.updateStoreSubscription(user, 10, {
          planCode: SubscriptionPlanCode.STARTER,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('订阅记录不存在时抛出 BadRequestException', async () => {
      prismaService.store.findFirst.mockResolvedValue({ id: 10 });
      prismaService.storeSubscription.findUnique.mockResolvedValue(null);

      await expect(
        service.updateStoreSubscription(user, 10, {
          planCode: SubscriptionPlanCode.GROWTH,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  /* ───── initializeStoreSubscription ───── */

  describe('initializeStoreSubscription', () => {
    it('创建 STARTER 套餐并同步门店席位数', async () => {
      prismaService.storeSubscription.upsert.mockResolvedValue({});
      prismaService.store.update.mockResolvedValue({});

      const tx = prismaService as unknown as import('@prisma/client').PrismaClient;
      await service.initializeStoreSubscription(
        tx as never,
        10,
      );

      expect(prismaService.storeSubscription.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            planCode: SubscriptionPlanCode.STARTER,
            maxAccountSeats: 1,
          }),
        }),
      );
      expect(prismaService.store.update).toHaveBeenCalledWith({
        where: { id: 10 },
        data: { maxAccountSeats: 1 },
      });
    });
  });

  /* ───── getSeatSummary ───── */

  describe('getSeatSummary', () => {
    it('门店不存在时抛出 NotFoundException', async () => {
      prismaService.store.findUnique.mockResolvedValue(null);

      await expect(service.getSeatSummary(999)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('返回正确的席位概览', async () => {
      prismaService.store.findUnique.mockResolvedValue({
        id: 10,
        maxAccountSeats: 3,
      });
      prismaService.staff.count.mockResolvedValue(2);

      const result = await service.getSeatSummary(10);

      expect(result).toEqual({
        maxAccountSeats: 3,
        activeSeatCount: 2,
        availableSeatCount: 1,
      });
    });

    it('已激活席位数超过上限时可用席位为 0', async () => {
      prismaService.store.findUnique.mockResolvedValue({
        id: 10,
        maxAccountSeats: 2,
      });
      prismaService.staff.count.mockResolvedValue(3);

      const result = await service.getSeatSummary(10);

      expect(result.availableSeatCount).toBe(0);
    });
  });
});

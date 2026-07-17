import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { SpaceReservationStatus as PrismaSpaceReservationStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../../redis/invalidator';
import { SpaceReservationsWriteService } from './space-reservations-write.service';

describe('SpaceReservationsWriteService', () => {
  let service: SpaceReservationsWriteService;

  const transaction = {
    $queryRaw: jest.fn(),
    space: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    spaceReservation: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  const prismaService = {
    space: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
    spaceReservation: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const commerceAccessService = {
    ensureCanAccessStore: jest.fn(),
    resolveViewStoreId: jest.fn(),
  };

  const cacheInvalidatorService = {
    invalidateProfitDashboardHome: jest.fn().mockResolvedValue(undefined),
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

    commerceAccessService.ensureCanAccessStore.mockResolvedValue(undefined);
    prismaService.$transaction.mockImplementation((callback) =>
      Promise.resolve(callback(transaction)),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SpaceReservationsWriteService,
        { provide: PrismaService, useValue: prismaService },
        { provide: CommerceAccessService, useValue: commerceAccessService },
        {
          provide: CacheInvalidatorService,
          useValue: cacheInvalidatorService,
        },
      ],
    }).compile();

    service = module.get<SpaceReservationsWriteService>(
      SpaceReservationsWriteService,
    );
  });

  it('createSpaceReservation 会在锁内重算时间冲突后再创建', async () => {
    const now = Date.now();
    prismaService.space.findFirst.mockResolvedValue({
      id: 11,
      storeId: 18,
      capacity: 4,
    });
    prismaService.spaceReservation.findFirst.mockResolvedValue(null);
    transaction.space.findUnique.mockResolvedValue({
      id: 11,
      storeId: 18,
      capacity: 4,
    });
    transaction.spaceReservation.findFirst.mockResolvedValue({
      id: 31,
      spaceId: 11,
      guestName: '李四',
      phone: '13800138001',
      reservedAt: new Date(now + 45 * 60 * 1000),
      reservedEndAt: new Date(now + 105 * 60 * 1000),
      guestCount: 2,
      note: null,
      status: PrismaSpaceReservationStatus.pending,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    });

    await expect(
      service.createSpaceReservation(user, 11, {
        guestName: '张三',
        phone: '13800138000',
        reservedAt: now + 30 * 60 * 1000,
        reservedEndAt: now + 90 * 60 * 1000,
        guestCount: 2,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(transaction.$queryRaw).toHaveBeenCalledTimes(1);
    expect(transaction.spaceReservation.create).not.toHaveBeenCalled();
  });

  it('createSpaceReservation 允许在已过时预约的时间段内创建新预约（BUG-4 修复）', async () => {
    const now = Date.now();
    const reservedAtB = now + 29 * 60 * 1000;
    const reservedEndAtB = now + 89 * 60 * 1000;

    prismaService.space.findFirst.mockResolvedValue({
      id: 11,
      storeId: 18,
      capacity: 4,
    });
    prismaService.spaceReservation.findFirst.mockResolvedValue(null);
    transaction.space.findUnique.mockResolvedValue({
      id: 11,
      storeId: 18,
      capacity: 4,
    });
    transaction.spaceReservation.findFirst.mockResolvedValue(null);
    transaction.spaceReservation.create.mockResolvedValue({
      id: 41,
      spaceId: 11,
      guestName: '张三',
      phone: '13800138000',
      reservedAt: new Date(reservedAtB),
      reservedEndAt: new Date(reservedEndAtB),
      guestCount: 2,
      note: null,
      status: PrismaSpaceReservationStatus.pending,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    });

    const result = await service.createSpaceReservation(user, 11, {
      guestName: '张三',
      phone: '13800138000',
      reservedAt: reservedAtB,
      reservedEndAt: reservedEndAtB,
      guestCount: 2,
    });

    expect(transaction.$queryRaw).toHaveBeenCalledTimes(1);
    expect(transaction.spaceReservation.create).toHaveBeenCalled();
    expect(result.status).toBe('pending');
    expect(result.guestName).toBe('张三');
  });

  it('updateSpaceReservation 若锁内发现预约已处理则阻止修改', async () => {
    const now = Date.now();
    prismaService.spaceReservation.findUnique.mockResolvedValue({
      id: 21,
      storeId: 18,
      spaceId: 11,
      status: PrismaSpaceReservationStatus.pending,
      space: { capacity: 4 },
    });
    prismaService.spaceReservation.findFirst.mockResolvedValue(null);
    transaction.space.findUnique.mockResolvedValue({
      id: 11,
      capacity: 4,
    });
    transaction.spaceReservation.findUnique.mockResolvedValue({
      id: 21,
      spaceId: 11,
      status: PrismaSpaceReservationStatus.fulfilled,
    });

    await expect(
      service.updateSpaceReservation(user, 21, {
        guestName: '张三',
        phone: '13800138000',
        reservedAt: now + 30 * 60 * 1000,
        reservedEndAt: now + 90 * 60 * 1000,
        guestCount: 2,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(transaction.$queryRaw).toHaveBeenCalledTimes(2);
    expect(transaction.spaceReservation.update).not.toHaveBeenCalled();
  });

  it('updateSpaceReservation 会在锁内重算时间冲突后再修改', async () => {
    const now = Date.now();
    prismaService.spaceReservation.findUnique.mockResolvedValue({
      id: 21,
      storeId: 18,
      spaceId: 11,
      status: PrismaSpaceReservationStatus.pending,
      space: { capacity: 4 },
    });
    prismaService.spaceReservation.findFirst.mockResolvedValue(null);
    transaction.space.findUnique.mockResolvedValue({
      id: 11,
      capacity: 4,
    });
    transaction.spaceReservation.findUnique.mockResolvedValue({
      id: 21,
      spaceId: 11,
      status: PrismaSpaceReservationStatus.pending,
    });
    transaction.spaceReservation.findFirst.mockResolvedValue({
      id: 32,
      spaceId: 11,
      guestName: '李四',
      phone: '13800138001',
      reservedAt: new Date(now + 45 * 60 * 1000),
      reservedEndAt: new Date(now + 105 * 60 * 1000),
      guestCount: 2,
      note: null,
      status: PrismaSpaceReservationStatus.pending,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    });

    await expect(
      service.updateSpaceReservation(user, 21, {
        guestName: '张三',
        phone: '13800138000',
        reservedAt: now + 30 * 60 * 1000,
        reservedEndAt: now + 90 * 60 * 1000,
        guestCount: 2,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(transaction.$queryRaw).toHaveBeenCalledTimes(2);
    expect(transaction.spaceReservation.update).not.toHaveBeenCalled();
  });

  it('cancelSpaceReservation 会在锁内校验最新预约状态后再取消', async () => {
    prismaService.spaceReservation.findUnique.mockResolvedValue({
      id: 21,
      storeId: 18,
      spaceId: 11,
      status: PrismaSpaceReservationStatus.pending,
    });
    transaction.spaceReservation.findUnique.mockResolvedValue({
      id: 21,
      spaceId: 11,
      status: PrismaSpaceReservationStatus.pending,
    });
    transaction.spaceReservation.update.mockResolvedValue({
      id: 21,
      spaceId: 11,
      guestName: '张三',
      phone: '13800138000',
      reservedAt: new Date('2026-06-12T14:00:00.000Z'),
      reservedEndAt: new Date('2026-06-12T16:00:00.000Z'),
      guestCount: 2,
      note: null,
      status: PrismaSpaceReservationStatus.cancelled,
      createdAt: new Date('2026-06-12T10:00:00.000Z'),
      updatedAt: new Date('2026-06-12T10:10:00.000Z'),
    });

    const result = await service.cancelSpaceReservation(user, 21);

    expect(transaction.$queryRaw).toHaveBeenCalledTimes(2);
    expect(transaction.spaceReservation.update).toHaveBeenCalledWith({
      where: { id: 21 },
      data: { status: PrismaSpaceReservationStatus.cancelled },
    });
    expect(result.status).toBe('cancelled');
  });

  it('cancelSpaceReservation 若锁内发现预约已处理则阻止取消', async () => {
    prismaService.spaceReservation.findUnique.mockResolvedValue({
      id: 21,
      storeId: 18,
      spaceId: 11,
      status: PrismaSpaceReservationStatus.pending,
    });
    transaction.spaceReservation.findUnique.mockResolvedValue({
      id: 21,
      spaceId: 11,
      status: PrismaSpaceReservationStatus.fulfilled,
    });

    await expect(
      service.cancelSpaceReservation(user, 21),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(transaction.$queryRaw).toHaveBeenCalledTimes(2);
    expect(transaction.spaceReservation.update).not.toHaveBeenCalled();
  });
});

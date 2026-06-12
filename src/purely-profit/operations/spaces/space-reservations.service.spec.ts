import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  SpaceReservationStatus as PrismaSpaceReservationStatus,
  SpaceSessionStatus as PrismaSpaceSessionStatus,
  SpaceStatus as PrismaSpaceStatus,
} from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { SpaceReservationsStateService } from './space-reservations-state.service';
import { SpaceReservationsService } from './space-reservations.service';

describe('SpaceReservationsService', () => {
  let service: SpaceReservationsService;

  const transaction = {
    $queryRaw: jest.fn(),
    space: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    spaceReservation: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  const prismaService = {
    space: {
      findUnique: jest.fn(),
    },
    spaceReservation: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const commerceAccessService = {
    ensureCanAccessStore: jest.fn(),
    resolveViewStoreId: jest.fn(),
  };

  const stateService = {
    ensureReservationCanBeFulfilled: jest.fn(),
    resolveReservationBackStatus: jest.fn(),
    syncNonOccupiedSpaceStatus: jest.fn(),
    cancelMatchedReservationAfterCheckout: jest.fn(),
  };

  const user: AuthenticatedUser = {
    id: 1,
    email: 'boss@example.com',
    phone: '13800138000',
    name: '老板',
    createdAt: new Date('2026-05-12T00:00:00.000Z'),
    updatedAt: new Date('2026-05-13T00:00:00.000Z'),
    currentMembership: {
      staffId: 8,
      storeId: 18,
      role: 'OWNER',
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
    commerceAccessService.resolveViewStoreId.mockResolvedValue(18);
    stateService.syncNonOccupiedSpaceStatus.mockResolvedValue(undefined);
    prismaService.$transaction.mockImplementation((callback) =>
      Promise.resolve(callback(transaction)),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SpaceReservationsService,
        { provide: PrismaService, useValue: prismaService },
        { provide: CommerceAccessService, useValue: commerceAccessService },
        {
          provide: SpaceReservationsStateService,
          useValue: stateService,
        },
      ],
    }).compile();

    service = module.get<SpaceReservationsService>(SpaceReservationsService);
  });

  it('listStoreSpaceReservations 在未传 status 时默认只返回 pending 预约', async () => {
    prismaService.spaceReservation.findMany.mockResolvedValue([]);

    await service.listStoreSpaceReservations(user, {});

    expect(commerceAccessService.resolveViewStoreId).toHaveBeenCalledWith(
      user,
      undefined,
      'space:view',
      '无权查看该门店空间预约',
    );
    expect(prismaService.spaceReservation.findMany).toHaveBeenCalledWith({
      where: {
        storeId: 18,
        status: PrismaSpaceReservationStatus.pending,
      },
      orderBy: [{ reservedAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
  });

  it('listStoreSpaceReservations 在显式传 status 时保留调用方筛选条件', async () => {
    prismaService.spaceReservation.findMany.mockResolvedValue([]);

    await service.listStoreSpaceReservations(user, {
      status: 'cancelled',
    });

    expect(prismaService.spaceReservation.findMany).toHaveBeenCalledWith({
      where: {
        storeId: 18,
        status: PrismaSpaceReservationStatus.cancelled,
      },
      orderBy: [{ reservedAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
  });

  it('listStoreSpaceReservations 在开始时间晚于结束时间时抛出异常', async () => {
    await expect(
      service.listStoreSpaceReservations(user, {
        dateFrom: 200,
        dateTo: 100,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prismaService.spaceReservation.findMany).not.toHaveBeenCalled();
  });

  it('listSpaceReservations 在未传 status 时默认只返回某空间的 pending 预约', async () => {
    prismaService.space.findUnique.mockResolvedValue({
      id: 11,
      storeId: 18,
    });
    prismaService.spaceReservation.findMany.mockResolvedValue([]);

    await service.listSpaceReservations(user, 11, {});

    expect(commerceAccessService.ensureCanAccessStore).toHaveBeenCalledWith(
      user,
      18,
      'space:view',
      '无权查看该门店空间预约',
    );
    expect(prismaService.spaceReservation.findMany).toHaveBeenCalledWith({
      where: {
        spaceId: 11,
        status: PrismaSpaceReservationStatus.pending,
      },
      orderBy: [{ reservedAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
  });

  it('createSpaceReservation 会在锁内重算时间冲突后再创建', async () => {
    const now = Date.now();
    prismaService.space.findUnique.mockResolvedValue({
      id: 11,
      storeId: 18,
      capacity: 4,
    });
    prismaService.spaceReservation.findMany.mockResolvedValue([]);
    transaction.space.findUnique.mockResolvedValue({
      id: 11,
      storeId: 18,
      capacity: 4,
    });
    transaction.spaceReservation.findMany.mockResolvedValue([
      {
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
      },
    ]);

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

  it('updateSpaceReservation 若锁内发现预约已处理则阻止修改', async () => {
    const now = Date.now();
    prismaService.spaceReservation.findUnique.mockResolvedValue({
      id: 21,
      storeId: 18,
      spaceId: 11,
      status: PrismaSpaceReservationStatus.pending,
      space: {
        capacity: 4,
      },
    });
    prismaService.spaceReservation.findMany.mockResolvedValue([]);
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
      space: {
        capacity: 4,
      },
    });
    prismaService.spaceReservation.findMany.mockResolvedValue([]);
    transaction.space.findUnique.mockResolvedValue({
      id: 11,
      capacity: 4,
    });
    transaction.spaceReservation.findUnique.mockResolvedValue({
      id: 21,
      spaceId: 11,
      status: PrismaSpaceReservationStatus.pending,
    });
    transaction.spaceReservation.findMany.mockResolvedValue([
      {
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
      },
    ]);

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
      data: {
        status: PrismaSpaceReservationStatus.cancelled,
      },
    });
    expect(stateService.syncNonOccupiedSpaceStatus).toHaveBeenCalledWith(
      transaction,
      11,
    );
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
    expect(stateService.syncNonOccupiedSpaceStatus).not.toHaveBeenCalled();
  });

  it('toSpaceReservationResponse 会标记已过时预约', () => {
    const result = service.toSpaceReservationResponse({
      id: 9,
      spaceId: 11,
      guestName: '张先生',
      phone: '13800138000',
      reservedAt: new Date(Date.now() - 60_000),
      reservedEndAt: new Date(Date.now() + 60_000),
      guestCount: 4,
      note: '生日聚会',
      status: PrismaSpaceReservationStatus.pending,
      createdAt: new Date('2026-05-18T10:00:00.000Z'),
      updatedAt: new Date('2026-05-18T10:10:00.000Z'),
    });

    expect(result).toEqual(
      expect.objectContaining({
        id: '9',
        spaceId: '11',
        status: 'pending',
        isOverdue: true,
      }),
    );
  });
});

describe('SpaceReservationsStateService', () => {
  let service: SpaceReservationsStateService;

  const transaction = {
    $queryRaw: jest.fn(),
    space: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    spaceSession: {
      findFirst: jest.fn(),
    },
    spaceReservation: {
      findFirst: jest.fn(),
    },
  };

  const prismaService = {
    $transaction: jest.fn(),
    spaceReservation: {
      findUnique: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    prismaService.$transaction.mockImplementation((callback) =>
      Promise.resolve(callback(transaction)),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SpaceReservationsStateService,
        { provide: PrismaService, useValue: prismaService },
      ],
    }).compile();

    service = module.get<SpaceReservationsStateService>(
      SpaceReservationsStateService,
    );
  });

  it('syncNonOccupiedSpaceStatus 会先锁空间再按预约回退状态更新', async () => {
    transaction.space.findUnique.mockResolvedValue({
      id: 11,
      status: PrismaSpaceStatus.idle,
    });
    transaction.spaceReservation.findFirst.mockResolvedValue({ id: 21 });
    transaction.space.update.mockResolvedValue(undefined);

    await service.syncNonOccupiedSpaceStatus(transaction as never, 11);

    expect(transaction.$queryRaw).toHaveBeenCalledTimes(1);
    expect(transaction.space.update).toHaveBeenCalledWith({
      where: { id: 11 },
      data: { status: PrismaSpaceStatus.reserved },
    });
  });

  it('syncNonOccupiedSpaceStatus 在空间已 occupied 时不回写状态', async () => {
    transaction.space.findUnique.mockResolvedValue({
      id: 11,
      status: PrismaSpaceStatus.occupied,
    });

    await service.syncNonOccupiedSpaceStatus(transaction as never, 11);

    expect(transaction.$queryRaw).toHaveBeenCalledTimes(1);
    expect(transaction.spaceReservation.findFirst).not.toHaveBeenCalled();
    expect(transaction.space.update).not.toHaveBeenCalled();
  });

  it('repairInconsistentOccupiedSpace 若锁内发现 active session 已恢复则不再修复', async () => {
    transaction.space.findUnique.mockResolvedValue({
      id: 11,
      status: PrismaSpaceStatus.occupied,
    });
    transaction.spaceSession.findFirst.mockResolvedValue({ id: 99 });

    await service.repairInconsistentOccupiedSpace(11);

    expect(transaction.$queryRaw).toHaveBeenCalledTimes(1);
    expect(transaction.space.update).not.toHaveBeenCalled();
  });

  it('repairInconsistentOccupiedSpace 仅在锁内确认无 active session 时回退状态', async () => {
    transaction.space.findUnique.mockResolvedValue({
      id: 11,
      status: PrismaSpaceStatus.occupied,
    });
    transaction.spaceSession.findFirst.mockResolvedValue(null);
    transaction.spaceReservation.findFirst.mockResolvedValue({ id: 21 });
    transaction.space.update.mockResolvedValue(undefined);

    await service.repairInconsistentOccupiedSpace(11);

    expect(transaction.$queryRaw).toHaveBeenCalledTimes(1);
    expect(transaction.space.update).toHaveBeenCalledWith({
      where: { id: 11 },
      data: { status: PrismaSpaceStatus.reserved },
    });
  });

  it('ensureReservationCanBeFulfilled 在预约非 pending 时抛出冲突', async () => {
    prismaService.spaceReservation.findUnique.mockResolvedValue({
      id: 21,
      storeId: 18,
      spaceId: 11,
      status: PrismaSpaceReservationStatus.fulfilled,
    });

    await expect(
      service.ensureReservationCanBeFulfilled(18, 11, 21),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('resolveReservationBackStatus 在存在今日 pending 预约时返回 reserved', async () => {
    transaction.spaceReservation.findFirst.mockResolvedValue({ id: 21 });

    await expect(
      service.resolveReservationBackStatus(transaction as never, 11),
    ).resolves.toBe(PrismaSpaceStatus.reserved);
  });

  it('resolveReservationBackStatus 在不存在今日 pending 预约时返回 idle', async () => {
    transaction.spaceReservation.findFirst.mockResolvedValue(null);

    await expect(
      service.resolveReservationBackStatus(transaction as never, 11),
    ).resolves.toBe(PrismaSpaceStatus.idle);
  });

  it('repairInconsistentOccupiedSpace 在锁内状态已非 occupied 时直接返回', async () => {
    transaction.space.findUnique.mockResolvedValue({
      id: 11,
      status: PrismaSpaceStatus.idle,
    });

    await service.repairInconsistentOccupiedSpace(11);

    expect(transaction.spaceSession.findFirst).not.toHaveBeenCalled();
    expect(transaction.space.update).not.toHaveBeenCalled();
  });
});

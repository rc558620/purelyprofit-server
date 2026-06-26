import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { SpaceReservationStatus as PrismaSpaceReservationStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../../redis/invalidator';
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
      findFirst: jest.fn(),
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

  const stateService = {
    ensureReservationCanBeFulfilled: jest.fn(),
    resolveReservationBackStatus: jest.fn(),
    syncNonOccupiedSpaceStatus: jest.fn(),
    cancelMatchedReservationAfterCheckout: jest.fn(),
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
        {
          provide: CacheInvalidatorService,
          useValue: cacheInvalidatorService,
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
      take: 200,
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
      take: 200,
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
      take: 200,
    });
  });

  it('createSpaceReservation 会在锁内重算时间冲突后再创建', async () => {
    const now = Date.now();
    prismaService.space.findUnique.mockResolvedValue({
      id: 11,
      storeId: 18,
      capacity: 4,
    });
    // 事务外第一次冲突检测：无冲突
    prismaService.spaceReservation.findFirst.mockResolvedValue(null);
    transaction.space.findUnique.mockResolvedValue({
      id: 11,
      storeId: 18,
      capacity: 4,
    });
    // 事务内第二次冲突检测：发现冲突
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
    // 场景：现在 08:01，旧预约 A (08:00-09:00) 已过时，新增预约 B (08:30-09:30) 应该成功
    const now = Date.now();
    // 旧预约 A 时间：08:00 ~ 09:00（now - 1min ~ now + 59min）
    const reservedAtB = now + 29 * 60 * 1000; // 08:30
    const reservedEndAtB = now + 89 * 60 * 1000; // 09:30

    prismaService.space.findUnique.mockResolvedValue({
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
    // 锁内返回已过时的预约 A，但应该被忽略
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
      space: {
        capacity: 4,
      },
    });
    prismaService.spaceReservation.findFirst.mockResolvedValue(null);
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
    // 预约已处理，不会进入冲突检测，findFirst 不会被调用

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
    prismaService.spaceReservation.findFirst.mockResolvedValue(null);
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
    // findReservationConflict 使用 findFirst 查询冲突
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

  // syncNonOccupiedSpaceStatus 和 repairInconsistentOccupiedSpace 已废弃为 no-op
  // Space.status 字段已移除，状态从运行态推导，无需同步和修复

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
    ).resolves.toBe('reserved');
  });

  it('resolveReservationBackStatus 在不存在今日 pending 预约时返回 idle', async () => {
    transaction.spaceReservation.findFirst.mockResolvedValue(null);

    await expect(
      service.resolveReservationBackStatus(transaction as never, 11),
    ).resolves.toBe('idle');
  });

  // repairInconsistentOccupiedSpace 已废弃为 no-op
});

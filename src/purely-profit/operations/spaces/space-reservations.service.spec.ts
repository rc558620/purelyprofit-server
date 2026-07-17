import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { SpaceReservationStatus as PrismaSpaceReservationStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../../redis/invalidator';
import { SpaceReservationsStateService } from './space-reservations-state.service';
import { SpaceReservationsService } from './space-reservations.service';
import { SpaceReservationsWriteService } from './space-reservations-write.service';

describe('SpaceReservationsService', () => {
  let service: SpaceReservationsService;

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

  const stateService = {
    ensureReservationCanBeFulfilled: jest.fn(),
    resolveReservationBackStatus: jest.fn(),
    cancelMatchedReservationAfterCheckout: jest.fn(),
  };

  const writeService = {
    createSpaceReservation: jest.fn(),
    updateSpaceReservation: jest.fn(),
    cancelSpaceReservation: jest.fn(),
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
          useValue: { invalidateProfitDashboardHome: jest.fn() },
        },
        {
          provide: SpaceReservationsWriteService,
          useValue: writeService,
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
        // P1 fix: 排除已软删除空间的预约
        space: { deletedAt: null },
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
        // P1 fix: 排除已软删除空间的预约
        space: { deletedAt: null },
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
    // B1: listSpaceReservations 改用 findFirst
    prismaService.space.findFirst.mockResolvedValue({
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

  it('createSpaceReservation 委托给 writeService', async () => {
    const dto = {
      guestName: '张三',
      phone: '13800138000',
      reservedAt: Date.now() + 30 * 60 * 1000,
      reservedEndAt: Date.now() + 90 * 60 * 1000,
      guestCount: 2,
    };
    writeService.createSpaceReservation.mockResolvedValue({
      id: '41',
      status: 'pending',
    });

    const result = await service.createSpaceReservation(user, 11, dto);

    expect(writeService.createSpaceReservation).toHaveBeenCalledWith(
      user,
      11,
      dto,
    );
    expect(result.status).toBe('pending');
  });

  it('updateSpaceReservation 委托给 writeService', async () => {
    const dto = {
      guestName: '张三',
      phone: '13800138000',
      reservedAt: Date.now() + 30 * 60 * 1000,
      reservedEndAt: Date.now() + 90 * 60 * 1000,
      guestCount: 2,
    };
    writeService.updateSpaceReservation.mockResolvedValue({
      id: '21',
      status: 'pending',
    });

    const result = await service.updateSpaceReservation(user, 21, dto);

    expect(writeService.updateSpaceReservation).toHaveBeenCalledWith(
      user,
      21,
      dto,
    );
    expect(result.status).toBe('pending');
  });

  it('cancelSpaceReservation 委托给 writeService', async () => {
    writeService.cancelSpaceReservation.mockResolvedValue({
      id: '21',
      status: 'cancelled',
    });

    const result = await service.cancelSpaceReservation(user, 21);

    expect(writeService.cancelSpaceReservation).toHaveBeenCalledWith(user, 21);
    expect(result.status).toBe('cancelled');
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
    // 无活跃会话才会继续检查预约
    transaction.spaceSession.findFirst.mockResolvedValue(null);
    transaction.spaceReservation.findFirst.mockResolvedValue({ id: 21 });

    await expect(
      service.resolveReservationBackStatus(transaction as never, 11),
    ).resolves.toBe('reserved');
  });

  it('resolveReservationBackStatus 在不存在今日 pending 预约时返回 idle', async () => {
    // 无活跃会话才会继续检查预约
    transaction.spaceSession.findFirst.mockResolvedValue(null);
    transaction.spaceReservation.findFirst.mockResolvedValue(null);

    await expect(
      service.resolveReservationBackStatus(transaction as never, 11),
    ).resolves.toBe('idle');
  });

  // repairInconsistentOccupiedSpace 已废弃为 no-op
});

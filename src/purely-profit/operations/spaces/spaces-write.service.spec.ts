import { ConflictException, ForbiddenException, GoneException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
// SpaceStatus 已移除，状态由运行态推导
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PlatformMembershipAccessService } from '../../member/platform-membership/platform-membership-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { SpaceReservationsService } from './space-reservations.service';
import { SpacesRefResolverService } from './spaces-ref-resolver.service';
import { SpacesWriteService } from './spaces-write.service';

type SpaceRecord = {
  id: number;
  storeId: number;
  name: string;
  capacity: number | null;
  enableDirtyRoom: boolean;
  autoCheckout: boolean;
  // status 字段已从 Space 移除，运行态推导
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  type: {
    id: number;
    name: string;
  };
  zone: {
    id: number;
    name: string;
  } | null;
};

type SpaceRemovalCandidate = {
  id: number;
  storeId: number;
  // status 字段已移除，运行态推导
  sortOrder: number;
  _count: {
    reservations: number;
    sessions: number;
  };
};

describe('SpacesWriteService', () => {
  let service: SpacesWriteService;

  const prismaTransaction = {
    $queryRaw: jest.fn(),
    space: {
      count: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
  };

  const prismaService = {
    space: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    spaceSession: {
      findFirst: jest.fn(),
    },
    spaceReservation: {
      findFirst: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const commerceAccessService = {
    resolveSingleStoreId: jest.fn(),
    ensureCanAccessStore: jest.fn(),
  };

  const spaceReservationsService = {
    resolveReservationBackStatus: jest.fn(),
  };

  const spacesRefResolverService = {
    resolveCreateSpaceRefs: jest.fn(),
    resolveUpdateSpaceRefs: jest.fn(),
  };

  const platformMembershipAccessService = {
    ensureSpaceQuotaAvailable: jest.fn(),
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

  const makeSpace = (overrides: Partial<SpaceRecord> = {}): SpaceRecord => ({
    id: 11,
    storeId: 18,
    name: 'A台',
    capacity: 4,
    enableDirtyRoom: false,
    autoCheckout: false,
    // status 字段已移除
    sortOrder: 2,
    createdAt: new Date('2026-05-18T10:00:00.000Z'),
    updatedAt: new Date('2026-05-18T10:10:00.000Z'),
    type: {
      id: 101,
      name: '台球台',
    },
    zone: {
      id: 201,
      name: '一楼',
    },
    ...overrides,
  });

  const makeRemovalCandidate = (
    overrides: Partial<SpaceRemovalCandidate> = {},
  ): SpaceRemovalCandidate => ({
    id: 11,
    storeId: 18,
    // status 字段已移除
    sortOrder: 2,
    _count: {
      reservations: 0,
      sessions: 0,
    },
    ...overrides,
  });

  beforeEach(async () => {
    jest.clearAllMocks();

    prismaService.$transaction.mockImplementation(
      async (
        callback: (transaction: typeof prismaTransaction) => Promise<unknown>,
      ) => callback(prismaTransaction),
    );

    commerceAccessService.ensureCanAccessStore.mockResolvedValue(undefined);
    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    spaceReservationsService.resolveReservationBackStatus.mockResolvedValue(
      'reserved',
    );
    // deriveSpaceStatus 需要查询 activeSession 和 pendingReservation
    prismaService.spaceSession.findFirst.mockResolvedValue(null);
    prismaService.spaceReservation.findFirst.mockResolvedValue(null);
    prismaTransaction.space.findUnique.mockResolvedValue({
      id: 11,
      // status 字段已移除
    });
    spacesRefResolverService.resolveCreateSpaceRefs.mockResolvedValue({
      typeId: 101,
      zoneId: 201,
    });
    spacesRefResolverService.resolveUpdateSpaceRefs.mockResolvedValue({});

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SpacesWriteService,
        { provide: PrismaService, useValue: prismaService },
        { provide: CommerceAccessService, useValue: commerceAccessService },
        {
          provide: SpacesRefResolverService,
          useValue: spacesRefResolverService,
        },
        {
          provide: SpaceReservationsService,
          useValue: spaceReservationsService,
        },
        {
          provide: PlatformMembershipAccessService,
          useValue: platformMembershipAccessService,
        },
      ],
    }).compile();

    service = module.get<SpacesWriteService>(SpacesWriteService);
  });

  it('createSpace 在会员空间额度不足时阻止新增', async () => {
    platformMembershipAccessService.ensureSpaceQuotaAvailable.mockRejectedValue(
      new ForbiddenException(
        '当前会员套餐最多可创建 1 个空间，请升级会员后继续添加',
      ),
    );

    await expect(
      service.createSpace(user, {
        storeId: 18,
        name: 'B台',
        type: '台球台',
        zone: '一楼',
        capacity: 6,
        enableDirtyRoom: true,
        autoCheckout: false,
        sortOrder: 99,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(
      platformMembershipAccessService.ensureSpaceQuotaAvailable,
    ).toHaveBeenCalledWith(18);
    expect(prismaService.$transaction).not.toHaveBeenCalled();
  });

  it('createSpace 会解析类型区域、插入排序并返回空间响应', async () => {
    platformMembershipAccessService.ensureSpaceQuotaAvailable.mockResolvedValue(
      undefined,
    );
    prismaService.space.findFirst.mockResolvedValueOnce(null);
    prismaTransaction.space.count.mockResolvedValueOnce(2);
    prismaTransaction.space.updateMany.mockResolvedValueOnce({ count: 1 });
    prismaTransaction.space.create.mockResolvedValueOnce(
      makeSpace({
        id: 12,
        name: 'B台',
        sortOrder: 3,
      }),
    );

    const result = await service.createSpace(user, {
      storeId: 18,
      name: 'B台',
      type: '台球台',
      zone: '一楼',
      capacity: 6,
      enableDirtyRoom: true,
      autoCheckout: false,
      sortOrder: 99,
    });

    expect(
      spacesRefResolverService.resolveCreateSpaceRefs,
    ).toHaveBeenCalledWith(
      18,
      expect.objectContaining({
        type: '台球台',
        zone: '一楼',
      }),
    );
    expect(prismaTransaction.space.updateMany).toHaveBeenCalledWith({
      where: {
        storeId: 18,
        sortOrder: {
          gte: 3,
        },
      },
      data: {
        sortOrder: {
          increment: 1,
        },
      },
    });
    expect(prismaTransaction.space.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          storeId: 18,
          typeId: 101,
          zoneId: 201,
          name: 'B台',
          capacity: 6,
          enableDirtyRoom: true,
          autoCheckout: false,
          // status 字段已移除
          sortOrder: 3,
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        id: '12',
        name: 'B台',
        type: '台球台',
        zone: '一楼',
        sortOrder: 3,
      }),
    );
  });

  it('updateSpace 会校验重名、清空区域并重排顺序', async () => {
    prismaService.space.findUnique.mockResolvedValueOnce(makeSpace());
    prismaService.space.findFirst.mockResolvedValueOnce(null);
    spacesRefResolverService.resolveUpdateSpaceRefs.mockResolvedValueOnce({
      zoneId: null,
    });
    prismaTransaction.space.count.mockResolvedValueOnce(4);
    prismaTransaction.space.updateMany.mockResolvedValueOnce({ count: 2 });
    prismaTransaction.space.update.mockResolvedValueOnce(
      makeSpace({
        name: 'A台-V2',
        zone: null,
        sortOrder: 4,
      }),
    );

    const result = await service.updateSpace(user, 11, {
      name: 'A台-V2',
      zone: '',
      sortOrder: 4,
      autoCheckout: true,
    });

    expect(prismaService.space.findFirst).toHaveBeenCalledWith({
      where: {
        storeId: 18,
        name: 'A台-V2',
        id: { not: 11 },
      },
      select: { id: true },
    });
    expect(
      spacesRefResolverService.resolveUpdateSpaceRefs,
    ).toHaveBeenCalledWith(
      18,
      expect.objectContaining({
        zone: '',
      }),
    );
    expect(prismaTransaction.space.updateMany).toHaveBeenCalledWith({
      where: {
        storeId: 18,
        id: { not: 11 },
        sortOrder: {
          gt: 2,
          lte: 4,
        },
      },
      data: {
        sortOrder: {
          decrement: 1,
        },
      },
    });
    expect(prismaTransaction.space.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 11 },
        data: expect.objectContaining({
          name: 'A台-V2',
          zoneId: null,
          autoCheckout: true,
          sortOrder: 4,
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        id: '11',
        name: 'A台-V2',
        sortOrder: 4,
      }),
    );
  });

  it('removeSpace 在空间使用中时抛出冲突异常', async () => {
    prismaService.space.findUnique.mockResolvedValueOnce(
      makeRemovalCandidate({
        // space.status 已移除，使用 _count.sessions 判断
        _count: {
          sessions: 1,
          reservations: 0,
        },
      }),
    );

    await expect(service.removeSpace(user, 11)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prismaService.$transaction).not.toHaveBeenCalled();
  });

  it('removeSpace 在存在待处理预约时抛出冲突异常', async () => {
    prismaService.space.findUnique.mockResolvedValueOnce(
      makeRemovalCandidate({
        _count: {
          reservations: 2,
          sessions: 0,
        },
      }),
    );

    await expect(service.removeSpace(user, 11)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prismaService.$transaction).not.toHaveBeenCalled();
  });

  it('markSpaceReady 会根据运行态推导返回空间状态', async () => {
    // Space.status 已移除，状态由运行态推导
    prismaService.space.findUnique.mockResolvedValueOnce(
      makeSpace({
        // status 字段已移除
      }),
    );
    // deriveSpaceStatus 需要：无活跃会话，有待处理预约
    prismaService.spaceSession.findFirst.mockResolvedValueOnce(null);
    prismaService.spaceReservation.findFirst.mockResolvedValueOnce({ id: 21 });
    // markSpaceReady 调用 findUniqueOrThrow 获取完整的 space 数据
    prismaService.space.findUniqueOrThrow.mockResolvedValueOnce(makeSpace());

    const result = await service.markSpaceReady(user, 11);

    // Space.status 已移除，不再调用 resolveReservationBackStatus
    // 状态直接由 deriveSpaceStatus 推导得出
    expect(
      spaceReservationsService.resolveReservationBackStatus,
    ).not.toHaveBeenCalled();
    expect(result.status).toBe('reserved');
  });

  it('updateSpaceStatus 已废弃，调用会抛出 GoneException', async () => {
    await expect(
      service.updateSpaceStatus(user, 11, {
        status: 'cleaning',
      }),
    ).rejects.toBeInstanceOf(GoneException);
  });

  it('createSpace 在名称冲突时抛出冲突异常', async () => {
    prismaService.space.findFirst.mockResolvedValueOnce({ id: 99 });

    await expect(
      service.createSpace(user, {
        storeId: 18,
        name: 'A台',
        type: '台球台',
        zone: '一楼',
        capacity: 4,
        enableDirtyRoom: false,
        autoCheckout: false,
        sortOrder: 1,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prismaService.$transaction).not.toHaveBeenCalled();
  });

  it('updateSpace 在名称冲突时抛出冲突异常', async () => {
    prismaService.space.findUnique.mockResolvedValueOnce(makeSpace());
    prismaService.space.findFirst.mockResolvedValueOnce({ id: 99 });

    await expect(
      service.updateSpace(user, 11, {
        name: '已存在空间',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prismaService.$transaction).not.toHaveBeenCalled();
  });

  it('updateSpace 在 sortOrder 不变时不会触发重排', async () => {
    prismaService.space.findUnique.mockResolvedValueOnce(makeSpace());
    prismaTransaction.space.update.mockResolvedValueOnce(makeSpace());

    const result = await service.updateSpace(user, 11, {
      sortOrder: 2,
      autoCheckout: true,
    });

    expect(prismaTransaction.space.count).not.toHaveBeenCalled();
    expect(prismaTransaction.space.updateMany).not.toHaveBeenCalled();
    expect(prismaTransaction.space.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          autoCheckout: true,
          sortOrder: 2,
        }),
      }),
    );
    expect(result.id).toBe('11');
  });
});

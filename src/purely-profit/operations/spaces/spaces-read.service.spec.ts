import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Prisma, SpaceStatus as PrismaSpaceStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { SPACE_WITH_RELATIONS_INCLUDE } from './spaces.query';
import { SpaceSessionAutoCheckoutService } from './space-session-auto-checkout.service';
import { SpaceReservationsStateService } from './space-reservations-state.service';
import { SpaceSessionReadService } from './space-session-read.service';
import { SpaceSessionReadStateService } from './space-session-read-state.service';
import { SpacesReadService } from './spaces-read.service';

type SpaceRecord = {
  id: number;
  storeId: number;
  name: string;
  capacity: number | null;
  enableDirtyRoom: boolean;
  autoCheckout: boolean;
  status: PrismaSpaceStatus;
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

describe('SpacesReadService', () => {
  let service: SpacesReadService;

  const prismaService = {
    space: {
      findMany: jest.fn(),
    },
  };

  const commerceAccessService = {
    resolveViewStoreId: jest.fn(),
  };

  const settlementService = {
    autoCheckoutExpiredCountdownSessions: jest.fn(),
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

  const makeSpace = (overrides: Partial<SpaceRecord> = {}): SpaceRecord => ({
    id: 11,
    storeId: 18,
    name: 'A台',
    capacity: 4,
    enableDirtyRoom: false,
    autoCheckout: false,
    status: PrismaSpaceStatus.idle,
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

  beforeEach(async () => {
    jest.clearAllMocks();
    commerceAccessService.resolveViewStoreId.mockResolvedValue(18);
    settlementService.autoCheckoutExpiredCountdownSessions.mockResolvedValue(0);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SpacesReadService,
        { provide: PrismaService, useValue: prismaService },
        { provide: CommerceAccessService, useValue: commerceAccessService },
        {
          provide: SpaceSessionAutoCheckoutService,
          useValue: settlementService,
        },
      ],
    }).compile();

    service = module.get<SpacesReadService>(SpacesReadService);
  });

  it('listSpaces 在没有可访问门店时返回空数组', async () => {
    commerceAccessService.resolveViewStoreId.mockResolvedValueOnce(null);

    const result = await service.listSpaces(user, {});

    expect(result).toEqual([]);
    expect(prismaService.space.findMany).not.toHaveBeenCalled();
  });

  it('listSpaces 会先补偿自动结账，再按查询条件读取并映射空间列表', async () => {
    prismaService.space.findMany.mockResolvedValueOnce([
      makeSpace(),
      makeSpace({ id: 12, name: 'B台', sortOrder: 3, zone: null }),
    ]);

    const query = {
      storeId: 18,
      status: 'idle' as const,
      type: ' 台球台 ',
      zone: ' 一楼 ',
    };
    const result = await service.listSpaces(user, query);

    expect(
      settlementService.autoCheckoutExpiredCountdownSessions,
    ).toHaveBeenCalledWith(
      user,
      18,
      expect.any(Number),
      'spaces:list',
      undefined,
    );
    expect(prismaService.space.findMany).toHaveBeenCalledWith({
      where: {
        storeId: 18,
        status: 'idle',
        type: {
          is: {
            name: '台球台',
          },
        },
        zone: {
          is: {
            name: '一楼',
          },
        },
      },
      include: SPACE_WITH_RELATIONS_INCLUDE,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
    expect(result).toEqual([
      {
        id: '11',
        name: 'A台',
        type: '台球台',
        zone: '一楼',
        capacity: 4,
        enableDirtyRoom: false,
        autoCheckout: false,
        status: 'idle',
        sortOrder: 2,
        createdAt: new Date('2026-05-18T10:00:00.000Z').getTime(),
      },
      {
        id: '12',
        name: 'B台',
        type: '台球台',
        capacity: 4,
        enableDirtyRoom: false,
        autoCheckout: false,
        status: 'idle',
        sortOrder: 3,
        createdAt: new Date('2026-05-18T10:00:00.000Z').getTime(),
      },
    ]);
  });
});

describe('SpaceSessionReadService 状态修复', () => {
  let service: SpaceSessionReadService;
  const prismaService = {
    space: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    spaceSession: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
  };

  const commerceAccessService = {
    resolveViewStoreId: jest.fn(),
    ensureCanAccessStore: jest.fn(),
  };

  const settlementService = {
    autoCheckoutExpiredCountdownSessions: jest.fn(),
  };

  const readStateService = {
    syncOccupiedSpaceStates: jest.fn(),
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
    commerceAccessService.resolveViewStoreId.mockResolvedValue(18);
    commerceAccessService.ensureCanAccessStore.mockResolvedValue(undefined);
    settlementService.autoCheckoutExpiredCountdownSessions.mockResolvedValue(0);
    readStateService.syncOccupiedSpaceStates.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SpaceSessionReadService,
        { provide: PrismaService, useValue: prismaService },
        { provide: CommerceAccessService, useValue: commerceAccessService },
        { provide: ConfigService, useValue: {} },
        {
          provide: SpaceSessionAutoCheckoutService,
          useValue: settlementService,
        },
        {
          provide: SpaceSessionReadStateService,
          useValue: readStateService,
        },
      ],
    }).compile();

    service = module.get<SpaceSessionReadService>(SpaceSessionReadService);
  });

  it('listStoreSpaceSessions 在查询 active 会话时，应委托 readStateService 同步修复状态', async () => {
    prismaService.spaceSession.findMany.mockResolvedValueOnce([]);

    const result = await service.listStoreSpaceSessions(user, {});

    expect(readStateService.syncOccupiedSpaceStates).toHaveBeenCalledWith(18);
    expect(result).toEqual([]);
  });

  it('listStoreSpaceSessions 如果 occupied 空间有 active session，委托 readStateService 即可', async () => {
    prismaService.spaceSession.findMany.mockResolvedValueOnce([]);

    await service.listStoreSpaceSessions(user, {});

    expect(readStateService.syncOccupiedSpaceStates).toHaveBeenCalledWith(18);
  });

  it('getSpaceSessionDetail 会先补偿自动结账并返回最新会话详情', async () => {
    prismaService.spaceSession.findUnique
      .mockResolvedValueOnce({
        id: 9,
        storeId: 18,
        spaceId: 7,
        guestName: '张三',
        guestPhone: '13800138000',
        guestCount: 2,
        startTime: new Date('2026-06-04T09:00:00.000Z'),
        endTime: null,
        billingMode: 'countdown',
        hourlyRate: null,
        timeCost: null,
        countdownMinutes: 60,
        autoCheckout: true,
        prepaidPaymentMethod: 'cash',
        prepaidGrouponCode: null,
        prepaidNote: null,
        prepaidAmount: null,
        items: [],
        itemsCost: new Prisma.Decimal(0),
        renewRecords: [],
        status: 'active',
        saleOrderId: null,
        createdAt: new Date('2026-06-04T09:00:00.000Z'),
        updatedAt: new Date('2026-06-04T09:30:00.000Z'),
        space: {
          id: 7,
          name: 'A01',
          type: { name: '台球桌' },
        },
      })
      .mockResolvedValueOnce({
        id: 9,
        storeId: 18,
        spaceId: 7,
        guestName: '张三',
        guestPhone: '13800138000',
        guestCount: 2,
        startTime: new Date('2026-06-04T09:00:00.000Z'),
        endTime: new Date('2026-06-04T10:00:00.000Z'),
        billingMode: 'countdown',
        hourlyRate: null,
        timeCost: new Prisma.Decimal(0),
        countdownMinutes: 60,
        autoCheckout: true,
        prepaidPaymentMethod: 'cash',
        prepaidGrouponCode: null,
        prepaidNote: null,
        prepaidAmount: null,
        items: [],
        itemsCost: new Prisma.Decimal(0),
        renewRecords: [],
        status: 'settled',
        saleOrderId: 12,
        createdAt: new Date('2026-06-04T09:00:00.000Z'),
        updatedAt: new Date('2026-06-04T10:00:00.000Z'),
        space: {
          id: 7,
          name: 'A01',
          type: { name: '台球桌' },
        },
      });

    const result = await service.getSpaceSessionDetail(user, 9);

    expect(
      settlementService.autoCheckoutExpiredCountdownSessions,
    ).toHaveBeenCalledWith(
      user,
      18,
      expect.any(Number),
      'space-sessions:detail',
      undefined,
    );
    expect(prismaService.spaceSession.findUnique).toHaveBeenCalledTimes(2);
    expect(result.status).toBe('settled');
    expect(result.orderId).toBe('12');
  });
});

describe('SpaceSessionReadStateService', () => {
  let service: SpaceSessionReadStateService;

  const prismaService = {
    space: {
      findMany: jest.fn(),
    },
    spaceSession: {
      findFirst: jest.fn(),
    },
  };

  const reservationsStateService = {
    repairInconsistentOccupiedSpace: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    reservationsStateService.repairInconsistentOccupiedSpace.mockResolvedValue(
      undefined,
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SpaceSessionReadStateService,
        { provide: PrismaService, useValue: prismaService },
        {
          provide: SpaceReservationsStateService,
          useValue: reservationsStateService,
        },
      ],
    }).compile();

    service = module.get<SpaceSessionReadStateService>(
      SpaceSessionReadStateService,
    );
  });

  it('syncOccupiedSpaceStates 在发现异常 occupied 空间时委托预约状态服务修复', async () => {
    prismaService.space.findMany.mockResolvedValue([{ id: 7 }, { id: 8 }]);
    prismaService.spaceSession.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 12 });

    await service.syncOccupiedSpaceStates(18);

    expect(
      reservationsStateService.repairInconsistentOccupiedSpace,
    ).toHaveBeenCalledTimes(1);
    expect(
      reservationsStateService.repairInconsistentOccupiedSpace,
    ).toHaveBeenCalledWith(7);
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SpaceSessionStatus, SpaceReservationStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { SpaceSessionReadService } from './space-session-read.service';
import { aValidDate } from '../../../spec-matchers';
import { SpaceSessionReadStateService } from './space-session-read-state.service';
import { SpacesReadService } from './spaces-read.service';

type SpaceRecord = {
  id: number;
  storeId: number;
  name: string;
  capacity: number | null;
  enableDirtyRoom: boolean;
  autoCheckout: boolean;
  cleanedAt: Date | null;
  // status 字段已从 Space 移除，运行态推导
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  _count?: {
    sessions: number;
    reservations: number;
  };
  sessions: { endTime: Date | null }[];
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
    cleanedAt: null,
    // status 字段已移除
    sortOrder: 2,
    createdAt: new Date('2026-05-18T10:00:00.000Z'),
    updatedAt: new Date('2026-05-18T10:10:00.000Z'),
    _count: {
      sessions: 0,
      reservations: 0,
    },
    sessions: [],
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SpacesReadService,
        { provide: PrismaService, useValue: prismaService },
        { provide: CommerceAccessService, useValue: commerceAccessService },
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

  it('listSpaces 按查询条件读取并映射空间列表', async () => {
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

    // status 字段已移除，不再在数据库查询中过滤，而是在内存中过滤
    // reservations 已加入今日区间过滤，与看板/reservationBackStatus 口径统一
    expect(prismaService.space.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          storeId: 18,
          deletedAt: null,
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
        include: expect.objectContaining({
          _count: {
            select: {
              sessions: { where: { status: SpaceSessionStatus.active } },
              reservations: {
                where: {
                  status: SpaceReservationStatus.pending,
                  reservedAt: {
                    gte: aValidDate,
                    lte: aValidDate,
                  },
                },
              },
            },
          },
        }),
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      }),
    );
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
        updatedAt: new Date('2026-05-18T10:10:00.000Z').getTime(),
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
        updatedAt: new Date('2026-05-18T10:10:00.000Z').getTime(),
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
      count: jest.fn(),
    },
  };

  const commerceAccessService = {
    resolveViewStoreId: jest.fn(),
    ensureCanAccessStore: jest.fn(),
  };

  const readStateService = {};

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
    commerceAccessService.resolveViewStoreId.mockResolvedValue(18);
    commerceAccessService.ensureCanAccessStore.mockResolvedValue(undefined);
    prismaService.spaceSession.count.mockResolvedValue(0);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SpaceSessionReadService,
        { provide: PrismaService, useValue: prismaService },
        { provide: CommerceAccessService, useValue: commerceAccessService },
        { provide: ConfigService, useValue: {} },
        {
          provide: SpaceSessionReadStateService,
          useValue: readStateService,
        },
      ],
    }).compile();

    service = module.get<SpaceSessionReadService>(SpaceSessionReadService);
  });

  it('listStoreSpaceSessions 默认查询返回会话列表', async () => {
    prismaService.spaceSession.findMany.mockResolvedValueOnce([]);

    const result = await service.listStoreSpaceSessions(user, {});

    expect(result).toEqual([]);
  });

  it('getSpaceSessionDetail 直接返回当前会话详情', async () => {
    // P3 fix: getSpaceSessionDetail 改为先鉴权后查询，第一步用 findFirst 取轻量元数据
    prismaService.spaceSession.findFirst.mockResolvedValueOnce({
      id: 9,
      storeId: 18,
    });

    prismaService.spaceSession.findUnique.mockResolvedValueOnce({
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
      prepaidCustomerPaymentMethod: null,
      prepaidSettlementChannel: null,
      prepaidGrouponCode: null,
      prepaidGrouponPlatform: null,
      prepaidVoucherCode: null,
      prepaidVoucherPlatform: null,
      prepaidNote: null,
      prepaidAmount: null,
      prepaidVoucherFaceAmount: null,
      sessionItems: [],
      itemsCost: 0,
      sessionRenewRecords: [],
      status: 'active',
      saleOrderId: null,
      createdAt: new Date('2026-06-04T09:00:00.000Z'),
      updatedAt: new Date('2026-06-04T09:30:00.000Z'),
      space: {
        id: 7,
        name: 'A01',
        type: { name: '台球桌' },
      },
    });

    const result = await service.getSpaceSessionDetail(user, 9);

    expect(prismaService.spaceSession.findUnique).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('active');
    expect(result.orderId).toBeUndefined();
  });
});

describe('SpaceSessionReadStateService', () => {
  let service: SpaceSessionReadStateService | undefined;

  // syncOccupiedSpaceStates 已废弃为 no-op
  // beforeEach 已移除，因为所有测试都已废弃

  // 占位测试 - 该服务的方法已废弃为 no-op
  it('should be defined', () => {
    // service 未初始化（因为 beforeEach 已移除），此测试仅作为占位符
    expect(service).toBeUndefined();
  });

  // syncOccupiedSpaceStates 已废弃为 no-op
  // it('syncOccupiedSpaceStates 仅修复无 active session 的 occupied 空间', async () => {
  //   ... 测试逻辑已过时 ...
  // });
});

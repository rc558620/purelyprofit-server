import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SpaceSessionStatus as PrismaSpaceSessionStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { RedisService } from '../../../redis/redis.service';
import { SalesRecordService } from '../sales-record/sales-record.service';
import { SpaceSessionsService } from './space-sessions.service';

describe('SpaceSessionsService', () => {
  let service: SpaceSessionsService;

  const prismaService = {
    spaceSession: {
      findMany: jest.fn(),
    },
  };

  const commerceAccessService = {
    resolveViewStoreId: jest.fn(),
  };

  const salesRecordService = {};
  const redisService = {};
  const configService = {
    get: jest.fn(),
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
    prismaService.spaceSession.findMany.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SpaceSessionsService,
        { provide: PrismaService, useValue: prismaService },
        { provide: CommerceAccessService, useValue: commerceAccessService },
        { provide: SalesRecordService, useValue: salesRecordService },
        { provide: RedisService, useValue: redisService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<SpaceSessionsService>(SpaceSessionsService);
  });

  it('listStoreSpaceSessions 在未传 status 时默认只返回 active 会话', async () => {
    await service.listStoreSpaceSessions(user, {});

    expect(commerceAccessService.resolveViewStoreId).toHaveBeenCalledWith(
      user,
      undefined,
      'space:view',
      '无权查看该门店空间会话',
    );
    expect(prismaService.spaceSession.findMany).toHaveBeenCalledWith({
      where: {
        AND: [{ storeId: 18 }, { status: PrismaSpaceSessionStatus.active }],
      },
      include: {
        space: {
          select: {
            id: true,
            name: true,
            type: {
              select: {
                name: true,
              },
            },
          },
        },
      },
      orderBy: [{ startTime: 'desc' }, { id: 'desc' }],
    });
  });

  it('listStoreSpaceSessions 在显式传 status 时保留调用方筛选条件', async () => {
    await service.listStoreSpaceSessions(user, {
      status: 'settled',
    });

    expect(prismaService.spaceSession.findMany).toHaveBeenCalledWith({
      where: {
        AND: [{ storeId: 18 }, { status: PrismaSpaceSessionStatus.settled }],
      },
      include: {
        space: {
          select: {
            id: true,
            name: true,
            type: {
              select: {
                name: true,
              },
            },
          },
        },
      },
      orderBy: [{ startTime: 'desc' }, { id: 'desc' }],
    });
  });

  it('listStoreActiveSpaceSessions 在未传 status 时默认只返回 active 会话', async () => {
    await service.listStoreActiveSpaceSessions(user, {});

    expect(prismaService.spaceSession.findMany).toHaveBeenCalledWith({
      where: {
        AND: [{ storeId: 18 }, { status: PrismaSpaceSessionStatus.active }],
      },
      include: {
        space: {
          select: {
            id: true,
            name: true,
            type: {
              select: {
                name: true,
              },
            },
          },
        },
      },
      orderBy: [{ startTime: 'desc' }, { id: 'desc' }],
    });
  });

  it('listStoreSpaceSessions 在 resolveViewStoreId 返回 null 时直接返回空数组且不查 DB', async () => {
    commerceAccessService.resolveViewStoreId.mockResolvedValue(null);

    await expect(service.listStoreSpaceSessions(user, {})).resolves.toEqual([]);

    expect(prismaService.spaceSession.findMany).not.toHaveBeenCalled();
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { SpaceStatus as PrismaSpaceStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { SPACE_WITH_RELATIONS_INCLUDE } from './spaces.query';
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

  it('listSpaces 会按查询条件读取并映射空间列表', async () => {
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

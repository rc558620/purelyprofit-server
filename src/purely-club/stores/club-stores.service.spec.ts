import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { StoresProfileService } from '../../purely-profit/stores/stores-profile.service';
import { ClubStoresService } from './club-stores.service';

describe('ClubStoresService', () => {
  let service: ClubStoresService;

  const prismaService = {
    store: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
  };

  const redisService = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  };

  const storesProfileService = {
    readStoreProfileMetadata: jest.fn(),
  };

  const user: AuthenticatedUser = {
    id: 201,
    email: 'club_phone_13800138000@purelyprofit.local',
    phone: '13800138000',
    name: '俱乐部用户',
    createdAt: new Date('2026-05-12T00:00:00.000Z'),
    updatedAt: new Date('2026-05-13T00:00:00.000Z'),
    accountScope: 'purely_club',
    currentMembership: null,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    storesProfileService.readStoreProfileMetadata.mockResolvedValue({
      storeType: '',
      region: [],
      storeLogo: 'https://cdn.example.com/store-cover.png',
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClubStoresService,
        { provide: PrismaService, useValue: prismaService },
        { provide: RedisService, useValue: redisService },
        { provide: StoresProfileService, useValue: storesProfileService },
      ],
    }).compile();

    service = module.get<ClubStoresService>(ClubStoresService);
  });

  it('list 在无历史选择时回落到第一个可访问门店并持久化', async () => {
    prismaService.store.findMany.mockResolvedValue([
      createStore({ id: 11, name: '望京旗舰店' }),
      createStore({ id: 12, name: '三里屯店' }),
    ]);
    redisService.get.mockResolvedValue(null);

    await expect(service.list(user)).resolves.toEqual({
      items: [
        {
          id: 11,
          name: '望京旗舰店',
          address: '北京市朝阳区望京 SOHO T3 B1',
          coverImage: 'https://cdn.example.com/store-cover.png',
        },
        {
          id: 12,
          name: '三里屯店',
          address: '北京市朝阳区望京 SOHO T3 B1',
          coverImage: 'https://cdn.example.com/store-cover.png',
        },
      ],
      currentStoreId: 11,
    });
    expect(redisService.set).toHaveBeenCalledWith(
      'club:selected-store:201',
      '11',
    );
  });

  it('list 会优先返回已保存且仍可访问的当前门店', async () => {
    prismaService.store.findMany.mockResolvedValue([
      createStore({ id: 11, name: '望京旗舰店' }),
      createStore({ id: 12, name: '三里屯店' }),
    ]);
    redisService.get.mockResolvedValue('12');

    await expect(service.list(user)).resolves.toMatchObject({
      currentStoreId: 12,
    });
    expect(redisService.set).not.toHaveBeenCalled();
  });

  it('getCurrent 在没有可访问门店时抛出 NotFoundException', async () => {
    prismaService.store.findMany.mockResolvedValue([]);

    await expect(service.getCurrent(user)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(redisService.del).toHaveBeenCalledWith('club:selected-store:201');
  });

  it('switchCurrent 只允许切换到本人可访问的门店', async () => {
    prismaService.store.findFirst.mockResolvedValue(
      createStore({ id: 18, name: '中关村店' }),
    );

    await expect(service.switchCurrent(user, 18)).resolves.toEqual({
      success: true,
      store: {
        id: 18,
        name: '中关村店',
        address: '北京市朝阳区望京 SOHO T3 B1',
        coverImage: 'https://cdn.example.com/store-cover.png',
      },
    });
    expect(prismaService.store.findFirst).toHaveBeenCalledWith({
      where: {
        id: 18,
        members: {
          some: {
            phone: '13800138000',
            status: { not: 'BANNED' },
          },
        },
      },
      select: {
        id: true,
        name: true,
        address: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    expect(redisService.set).toHaveBeenCalledWith(
      'club:selected-store:201',
      '18',
    );

    prismaService.store.findFirst.mockResolvedValue(null);

    await expect(service.switchCurrent(user, 19)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

function createStore(
  overrides?: Partial<{
    id: number;
    name: string;
    address: string | null;
    createdAt: Date;
    updatedAt: Date;
  }>,
): {
  id: number;
  name: string;
  address: string | null;
  createdAt: Date;
  updatedAt: Date;
} {
  return {
    id: 1,
    name: '门店',
    address: '北京市朝阳区望京 SOHO T3 B1',
    createdAt: new Date('2026-05-12T00:00:00.000Z'),
    updatedAt: new Date('2026-05-13T00:00:00.000Z'),
    ...overrides,
  };
}

import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { StoresProfileService } from '../../purely-profit/stores/stores-profile.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { ClubCurrentStoreContextService } from './club-current-store-context.service';
import { ClubStoreAccessService } from './club-store-access.service';
import { ClubStoreViewService } from './club-store-view.service';
import { ClubStoresService } from './club-stores.service';

describe('ClubStoresService', () => {
  let service: ClubStoresService;

  const prismaService = {
    store: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    member: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    marketingCustomer: {
      upsert: jest.fn(),
    },
    $transaction: jest.fn(),
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
    prismaService.$transaction.mockImplementation(async (operations) =>
      Promise.all(operations),
    );
    storesProfileService.readStoreProfileMetadata.mockResolvedValue({
      storeType: '',
      region: [],
      storeLogo: 'https://cdn.example.com/store-cover.png',
      latitude: 39.984104,
      longitude: 116.307503,
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClubStoreAccessService,
        ClubCurrentStoreContextService,
        ClubStoreViewService,
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
          latitude: 39.984104,
          longitude: 116.307503,
        },
        {
          id: 12,
          name: '三里屯店',
          address: '北京市朝阳区望京 SOHO T3 B1',
          coverImage: 'https://cdn.example.com/store-cover.png',
          latitude: 39.984104,
          longitude: 116.307503,
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

  it('getCurrent 返回当前上下文中的门店信息', async () => {
    await expect(
      service.getCurrent({
        user,
        store: createStore({ id: 11, name: '望京旗舰店' }),
      }),
    ).resolves.toEqual({
      id: 11,
      name: '望京旗舰店',
      address: '北京市朝阳区望京 SOHO T3 B1',
      coverImage: 'https://cdn.example.com/store-cover.png',
      latitude: 39.984104,
      longitude: 116.307503,
    });
    expect(redisService.del).not.toHaveBeenCalled();
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
        latitude: 39.984104,
        longitude: 116.307503,
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

  it('joinByScanCode 会识别二维码 URL 中的邀请码并切换门店', async () => {
    prismaService.store.findMany.mockResolvedValue([
      createStore({ id: 18, name: '中关村店' }),
      createStore({ id: 11, name: '望京旗舰店' }),
    ]);
    prismaService.member.findUnique.mockResolvedValue(null);
    prismaService.member.upsert.mockResolvedValue({ id: 2801 });
    prismaService.marketingCustomer.upsert.mockResolvedValue({ id: 3801 });
    prismaService.store.findFirst.mockResolvedValue(
      createStore({ id: 18, name: '中关村店' }),
    );

    await expect(
      service.joinByScanCode(
        user,
        `https://club.purelyprofit.local/pages/storeSelect/index?inviteCode=${buildExpectedInviteCode(18)}`,
      ),
    ).resolves.toEqual({
      success: true,
      store: {
        id: 18,
        name: '中关村店',
        address: '北京市朝阳区望京 SOHO T3 B1',
        coverImage: 'https://cdn.example.com/store-cover.png',
        latitude: 39.984104,
        longitude: 116.307503,
      },
    });
    expect(prismaService.member.findUnique).toHaveBeenCalledWith({
      where: {
        storeId_phone: {
          storeId: 18,
          phone: '13800138000',
        },
      },
      select: {
        status: true,
      },
    });
    expect(prismaService.member.upsert).toHaveBeenCalledWith({
      where: {
        storeId_phone: {
          storeId: 18,
          phone: '13800138000',
        },
      },
      create: {
        storeId: 18,
        name: '俱乐部用户',
        phone: '13800138000',
      },
      update: {},
    });
    expect(prismaService.marketingCustomer.upsert).toHaveBeenCalledWith({
      where: {
        storeId_phone: {
          storeId: 18,
          phone: '13800138000',
        },
      },
      create: {
        storeId: 18,
        name: '俱乐部用户',
        phone: '13800138000',
      },
      update: {},
    });
    expect(prismaService.$transaction).toHaveBeenCalledTimes(1);
    expect(redisService.set).toHaveBeenCalledWith(
      'club:selected-store:201',
      '18',
    );
  });

  it('joinByInviteCode 会自动入会并切换到邀请码对应门店', async () => {
    prismaService.store.findMany.mockResolvedValue([
      createStore({ id: 18, name: '中关村店' }),
      createStore({ id: 11, name: '望京旗舰店' }),
    ]);
    prismaService.member.findUnique.mockResolvedValue(null);
    prismaService.member.upsert.mockResolvedValue({ id: 2801 });
    prismaService.marketingCustomer.upsert.mockResolvedValue({ id: 3801 });
    prismaService.store.findFirst.mockResolvedValue(
      createStore({ id: 18, name: '中关村店' }),
    );

    await expect(
      service.joinByInviteCode(user, buildExpectedInviteCode(18)),
    ).resolves.toEqual({
      success: true,
      store: {
        id: 18,
        name: '中关村店',
        address: '北京市朝阳区望京 SOHO T3 B1',
        coverImage: 'https://cdn.example.com/store-cover.png',
        latitude: 39.984104,
        longitude: 116.307503,
      },
    });
    expect(prismaService.member.findUnique).toHaveBeenCalledWith({
      where: {
        storeId_phone: {
          storeId: 18,
          phone: '13800138000',
        },
      },
      select: {
        status: true,
      },
    });
    expect(prismaService.member.upsert).toHaveBeenCalledWith({
      where: {
        storeId_phone: {
          storeId: 18,
          phone: '13800138000',
        },
      },
      create: {
        storeId: 18,
        name: '俱乐部用户',
        phone: '13800138000',
      },
      update: {},
    });
    expect(prismaService.marketingCustomer.upsert).toHaveBeenCalledWith({
      where: {
        storeId_phone: {
          storeId: 18,
          phone: '13800138000',
        },
      },
      create: {
        storeId: 18,
        name: '俱乐部用户',
        phone: '13800138000',
      },
      update: {},
    });
    expect(prismaService.$transaction).toHaveBeenCalledTimes(1);
    expect(redisService.set).toHaveBeenCalledWith(
      'club:selected-store:201',
      '18',
    );
  });

  it('joinByScanCode 在扫码内容无法识别时拒绝加入', async () => {
    await expect(service.joinByScanCode(user, 'not-a-store-code')).rejects.toThrow(
      '扫码结果无效，未识别到门店邀请码',
    );
    expect(prismaService.store.findMany).not.toHaveBeenCalled();
  });

  it('joinByInviteCode 在邀请码无效时拒绝加入', async () => {
    prismaService.store.findMany.mockResolvedValue([
      createStore({ id: 11, name: '望京旗舰店' }),
      createStore({ id: 12, name: '三里屯店' }),
    ]);

    await expect(service.joinByInviteCode(user, 'INVALID')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prismaService.member.upsert).not.toHaveBeenCalled();
    expect(prismaService.marketingCustomer.upsert).not.toHaveBeenCalled();
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

function buildExpectedInviteCode(storeId: number): string {
  const alphabet = '0123456789';
  let seed = storeId * 1103515245 + 12345;
  let inviteCode = '';

  for (let index = 0; index < 6; index += 1) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    inviteCode += alphabet[seed % alphabet.length];
  }

  return inviteCode;
}

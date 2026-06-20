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

/** ClubCurrentStoreContextService 中 CLUB_SELECTED_STORE_TTL_SECONDS 的值 */
const CLUB_SELECTED_STORE_TTL = 30 * 24 * 60 * 60;

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
    getJson: jest.fn(),
    setJson: jest.fn(),
  };

  const storesProfileService = {
    readStoreProfileMetadata: jest.fn(),
    batchReadStoreProfileMetadata: jest.fn(),
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

  const wechatUser: AuthenticatedUser = {
    id: 301,
    email: 'club_wechat_oOPENID123@purelyprofit.local',
    phone: 'club_wechat:oOPENID123',
    name: '微信昵称',
    createdAt: new Date('2026-05-12T00:00:00.000Z'),
    updatedAt: new Date('2026-05-13T00:00:00.000Z'),
    accountScope: 'purely_club',
    currentMembership: null,
  };

  const mockMetadata = {
    storeType: '',
    region: [],
    storeLogo: 'https://cdn.example.com/store-cover.png',
    latitude: 39.984104,
    longitude: 116.307503,
  };

  /** 期望的门店摘要结构（不含 isOpen，当前阶段不返回该字段） */
  const expectedStoreSummary = {
    address: '北京市朝阳区望京 SOHO T3 B1',
    coverImage: 'https://cdn.example.com/store-cover.png',
    latitude: 39.984104,
    longitude: 116.307503,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    prismaService.$transaction.mockImplementation(async (operations) =>
      Promise.all(operations),
    );
    storesProfileService.readStoreProfileMetadata.mockResolvedValue(
      mockMetadata,
    );
    storesProfileService.batchReadStoreProfileMetadata.mockResolvedValue([]);
    // 默认邀请码映射缓存未命中
    redisService.getJson.mockResolvedValue(null);

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
    const store11 = createStore({ id: 11, name: '望京旗舰店' });
    const store12 = createStore({ id: 12, name: '三里屯店' });

    prismaService.store.findMany.mockResolvedValueOnce([store11, store12]);
    redisService.get.mockResolvedValue(null);
    storesProfileService.batchReadStoreProfileMetadata.mockResolvedValue([
      mockMetadata,
      mockMetadata,
    ]);

    await expect(service.list(user)).resolves.toEqual({
      items: [
        { id: 11, name: '望京旗舰店', ...expectedStoreSummary },
        { id: 12, name: '三里屯店', ...expectedStoreSummary },
      ],
      currentStoreId: 11,
    });
    expect(redisService.set).toHaveBeenCalledWith(
      'club:selected-store:201',
      '11',
      CLUB_SELECTED_STORE_TTL,
    );
  });

  it('list 会优先返回已保存且仍可访问的当前门店', async () => {
    const store11 = createStore({ id: 11, name: '望京旗舰店' });
    const store12 = createStore({ id: 12, name: '三里屯店' });

    prismaService.store.findMany.mockResolvedValueOnce([store11, store12]);
    redisService.get.mockResolvedValue('12');
    storesProfileService.batchReadStoreProfileMetadata.mockResolvedValue([
      mockMetadata,
      mockMetadata,
    ]);

    await expect(service.list(user)).resolves.toMatchObject({
      currentStoreId: 12,
    });
    expect(redisService.set).not.toHaveBeenCalled();
  });

  it('getCurrent 返回当前上下文中的门店信息', async () => {
    storesProfileService.readStoreProfileMetadata.mockResolvedValue(
      mockMetadata,
    );

    await expect(
      service.getCurrent({
        user,
        store: createStore({ id: 11, name: '望京旗舰店' }),
      }),
    ).resolves.toEqual({
      id: 11,
      name: '望京旗舰店',
      ...expectedStoreSummary,
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
        ...expectedStoreSummary,
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
      CLUB_SELECTED_STORE_TTL,
    );

    prismaService.store.findFirst.mockResolvedValue(null);

    await expect(service.switchCurrent(user, 19)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('joinByScanCode 会识别二维码 URL 中的邀请码并切换门店', async () => {
    const inviteCode = buildExpectedInviteCode(18);

    // 设置邀请码映射缓存命中
    redisService.getJson.mockResolvedValue({ [inviteCode]: 18 });
    prismaService.store.findFirst.mockResolvedValue(
      createStore({ id: 18, name: '中关村店' }),
    );
    prismaService.member.findUnique.mockResolvedValue(null);
    prismaService.member.upsert.mockResolvedValue({ id: 2801 });
    prismaService.marketingCustomer.upsert.mockResolvedValue({ id: 3801 });

    await expect(
      service.joinByScanCode(
        user,
        `https://club.purelyprofit.local/pages/storeSelect/index?inviteCode=${inviteCode}`,
      ),
    ).resolves.toEqual({
      success: true,
      store: {
        id: 18,
        name: '中关村店',
        ...expectedStoreSummary,
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
      update: {
        name: '俱乐部用户',
      },
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
      update: {
        name: '俱乐部用户',
      },
    });
    expect(prismaService.$transaction).toHaveBeenCalledTimes(1);
    expect(redisService.set).toHaveBeenCalledWith(
      'club:selected-store:201',
      '18',
      CLUB_SELECTED_STORE_TTL,
    );
  });

  it('joinByInviteCode 会自动入会并切换到邀请码对应门店', async () => {
    const inviteCode = buildExpectedInviteCode(18);

    redisService.getJson.mockResolvedValue({ [inviteCode]: 18 });
    prismaService.store.findFirst.mockResolvedValue(
      createStore({ id: 18, name: '中关村店' }),
    );
    prismaService.member.findUnique.mockResolvedValue(null);
    prismaService.member.upsert.mockResolvedValue({ id: 2801 });
    prismaService.marketingCustomer.upsert.mockResolvedValue({ id: 3801 });

    await expect(service.joinByInviteCode(user, inviteCode)).resolves.toEqual({
      success: true,
      store: {
        id: 18,
        name: '中关村店',
        ...expectedStoreSummary,
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
      update: {
        name: '俱乐部用户',
      },
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
      update: {
        name: '俱乐部用户',
      },
    });
    expect(prismaService.$transaction).toHaveBeenCalledTimes(1);
    expect(redisService.set).toHaveBeenCalledWith(
      'club:selected-store:201',
      '18',
      CLUB_SELECTED_STORE_TTL,
    );
  });

  it('joinByInviteCode 对微信登录用户使用稳定标识建档', async () => {
    const inviteCode = buildExpectedInviteCode(18);

    redisService.getJson.mockResolvedValue({ [inviteCode]: 18 });
    prismaService.store.findFirst.mockResolvedValue(
      createStore({ id: 18, name: '中关村店' }),
    );
    prismaService.member.findUnique.mockResolvedValue(null);
    prismaService.member.upsert.mockResolvedValue({ id: 4801 });
    prismaService.marketingCustomer.upsert.mockResolvedValue({ id: 5801 });

    await expect(
      service.joinByInviteCode(wechatUser, inviteCode),
    ).resolves.toEqual({
      success: true,
      store: {
        id: 18,
        name: '中关村店',
        ...expectedStoreSummary,
      },
    });
    expect(prismaService.member.upsert).toHaveBeenCalledWith({
      where: {
        storeId_phone: {
          storeId: 18,
          phone: 'club_wechat:oOPENID123',
        },
      },
      create: {
        storeId: 18,
        name: '微信昵称',
        phone: 'club_wechat:oOPENID123',
      },
      update: {
        name: '微信昵称',
      },
    });
    expect(prismaService.marketingCustomer.upsert).toHaveBeenCalledWith({
      where: {
        storeId_phone: {
          storeId: 18,
          phone: 'club_wechat:oOPENID123',
        },
      },
      create: {
        storeId: 18,
        name: '微信昵称',
        phone: 'club_wechat:oOPENID123',
      },
      update: {
        name: '微信昵称',
      },
    });
    expect(redisService.set).toHaveBeenCalledWith(
      'club:selected-store:301',
      '18',
      CLUB_SELECTED_STORE_TTL,
    );
  });

  it('joinByInviteCode 缓存未命中时从数据库构建邀请码映射', async () => {
    const inviteCode = buildExpectedInviteCode(18);

    // 缓存未命中：getJson 返回 null
    redisService.getJson.mockResolvedValue(null);
    // loadInviteCodeMap 内部会调用 findMany 加载全量门店
    prismaService.store.findMany.mockResolvedValue([{ id: 11 }, { id: 18 }]);
    prismaService.store.findFirst.mockResolvedValue(
      createStore({ id: 18, name: '中关村店' }),
    );
    prismaService.member.findUnique.mockResolvedValue(null);
    prismaService.member.upsert.mockResolvedValue({ id: 2801 });
    prismaService.marketingCustomer.upsert.mockResolvedValue({ id: 3801 });

    const result = await service.joinByInviteCode(user, inviteCode);
    expect(result.success).toBe(true);
    expect(result.store.id).toBe(18);

    // 验证映射已写入缓存
    expect(redisService.setJson).toHaveBeenCalledWith(
      'club:invite-code-map',
      expect.any(Object),
      3600,
    );
  });

  it('joinByScanCode 在扫码内容无法识别时拒绝加入', async () => {
    await expect(
      service.joinByScanCode(user, 'not-a-store-code'),
    ).rejects.toThrow('扫码结果无效，未识别到门店邀请码');
    expect(prismaService.store.findMany).not.toHaveBeenCalled();
  });

  it('joinByInviteCode 在邀请码无效时拒绝加入', async () => {
    redisService.getJson.mockResolvedValue({});

    await expect(
      service.joinByInviteCode(user, 'INVALID'),
    ).rejects.toBeInstanceOf(NotFoundException);
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
